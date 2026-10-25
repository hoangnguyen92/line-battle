import { Client, type Room } from '@colyseus/sdk';
import {
  BATTLE_ROOM,
  OnlinePlayer,
  StreamPlayer,
  TICK_RATE,
  type EndReason,
  type Game,
  type GameEvent,
  type Handling,
  type JoinOptions,
  type KeyEvent,
  type ServerMessages,
} from '@line-battle/engine';

/** Where the match server is. Set VITE_SERVER_URL for a real deployment. */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`;

const TICK_MS = 1000 / TICK_RATE;
/** Send a batch at least this often (3 ticks = 50 ms). */
const SEND_EVERY_TICKS = 3;
/** Catch up quickly after a hitch or a reconnect, but not in one giant frame. */
const MAX_STEPS_PER_FRAME = 30;

export type OnlinePhase = 'connecting' | 'waiting' | 'countdown' | 'playing' | 'roundEnd' | 'matchEnd' | 'closed';

/** What the screen code needs to hear about. */
export interface OnlineEvents {
  phase(phase: OnlinePhase): void;
  /** Game events from your board (0) or the opponent's (1), for popups and hits. */
  gameEvents(side: 0 | 1, events: GameEvent[]): void;
  error(message: string): void;
}

export type JoinKind = { kind: 'quick' } | { kind: 'create' } | { kind: 'join'; code: string };

export function describeEnd(reason: EndReason, youWon: boolean): string {
  switch (reason) {
    case 'left': return youWon ? 'Your opponent left the match.' : 'You left the match.';
    case 'timeout': return youWon ? 'Your opponent stopped responding.' : 'Your game stopped reaching the server.';
    case 'invalid': return youWon ? "The server rejected your opponent's inputs." : 'The server rejected your inputs.';
    default: return '';
  }
}

/**
 * One online match from this browser's side. Your board runs locally with no
 * input delay; the opponent's board is rebuilt from the inputs the server
 * relays, a little behind real time. Boards are always [you, opponent].
 */
export class OnlineMatch {
  phase: OnlinePhase = 'connecting';
  room: Room | null = null;
  code: string | null = null;
  you: 0 | 1 = 0;
  names: [string, string] = ['YOU', 'OPPONENT'];
  /** [you, opponent] rounds won. */
  score: [number, number] = [0, 0];
  roundsToWin = 2;
  local: OnlinePlayer | null = null;
  mirror: StreamPlayer | null = null;
  /** performance.now() at tick 0 of this round. */
  playStart = 0;
  countdownMs = 1500;
  round = 0;
  /** Last round or match result, from your side. */
  lastWinner: 'you' | 'opponent' | null = null;
  endReason: EndReason | null = null;
  rematch: [boolean, boolean] = [false, false];
  connected = true;
  opponentConnected = true;

  private handling: [Handling, Handling] | null = null;
  private left = false;

  constructor(private events: OnlineEvents) {}

  async join(how: JoinKind, name: string, handling: Handling): Promise<void> {
    const client = new Client(SERVER_URL);
    const opts = (mode: JoinOptions['mode']): JoinOptions => ({ mode, name, handling });
    try {
      const room =
        how.kind === 'quick' ? await client.joinOrCreate(BATTLE_ROOM, opts('quick'))
        : how.kind === 'create' ? await client.create(BATTLE_ROOM, opts('private'))
        : await client.joinById(how.code.trim().toUpperCase(), opts('private'));
      if (this.left) return void room.leave(true);
      this.attach(room);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setPhase('closed');
      if (how.kind === 'join' && /not found|locked|full/i.test(msg)) this.events.error(`No open room with code ${how.code.toUpperCase()}.`);
      else this.events.error(`Can't reach the match server (${SERVER_URL}). Is it running?`);
    }
  }

  /** Leaves the room; mid-match this forfeits. */
  leave(): void {
    this.left = true;
    void this.room?.leave(true);
    this.room = null;
  }

  askRematch(): void {
    this.room?.send('rematch');
  }

  /** Both boards, [you, opponent]. */
  get games(): [Game, Game] | null {
    return this.local && this.mirror ? [this.local.game, this.mirror.game] : null;
  }

  /**
   * Called every frame: steps your board up to real time, feeding `keys` into
   * the first tick, and sends what's new to the server.
   */
  update(now: number, keys: () => KeyEvent[]): void {
    const local = this.local;
    if (!local) return;
    if (this.phase === 'countdown' && now >= this.playStart) this.setPhase('playing');
    if (this.phase === 'playing') {
      const target = Math.floor((now - this.playStart) / TICK_MS);
      for (let n = 0; local.game.tick < target && !local.game.over && n < MAX_STEPS_PER_FRAME; n++) {
        local.step(keys());
        this.events.gameEvents(0, local.game.drainEvents());
      }
    }
    // A topped-out board still sends its last batch.
    if (this.connected && this.room && local.unsentTicks > 0 && (local.unsentTicks >= SEND_EVERY_TICKS || local.game.over)) {
      this.room.send('inputs', local.takeBatch());
    }
  }

  // ---- messages ---------------------------------------------------------

  private attach(room: Room): void {
    this.room = room;
    // Reconnect even right after joining, and keep retrying inside the server's 10 s window.
    room.reconnection.minUptime = 0;
    room.reconnection.maxDelay = 2000;
    const on = <K extends keyof ServerMessages>(type: K, fn: (msg: ServerMessages[K]) => void) =>
      room.onMessage(type, (msg: ServerMessages[K]) => fn(msg));

    on('waiting', ({ code }) => {
      this.code = code;
      this.setPhase('waiting');
    });
    on('match', (m) => {
      this.you = m.you;
      const other = (1 - m.you) as 0 | 1;
      this.names = [m.names[m.you], m.names[other]];
      this.handling = [m.handling[m.you], m.handling[other]];
      this.score = [m.score[m.you], m.score[other]];
      this.roundsToWin = m.roundsToWin;
    });
    on('round', (r) => this.startRound(r.round, r.seed, r.countdownMs));
    on('garbage', (g) => this.local?.receive(g));
    on('opp', (batch) => {
      if (!this.mirror) return;
      this.mirror.push(batch);
      this.events.gameEvents(1, this.mirror.game.drainEvents());
    });
    on('resync', (r) => this.resync(r));
    on('oppStatus', ({ connected }) => (this.opponentConnected = connected));
    on('roundEnd', (e) => this.onEnd(e, 'roundEnd'));
    on('matchEnd', (e) => this.onEnd(e, 'matchEnd'));
    on('rematch', ({ requested }) => (this.rematch = [requested[this.you], requested[1 - this.you]]));

    room.onDrop(() => (this.connected = false));
    room.onReconnect(() => (this.connected = true));
    room.onLeave(() => {
      this.room = null;
      if (this.left || this.phase === 'matchEnd') return;
      this.setPhase('closed');
      this.events.error('Lost the connection to the match server.');
    });
  }

  private startRound(round: number, seed: number, countdownMs: number): void {
    const [mine, theirs] = this.handling!;
    this.round = round;
    this.local = new OnlinePlayer(seed, mine);
    this.mirror = new StreamPlayer(seed, theirs);
    this.countdownMs = countdownMs;
    this.playStart = performance.now() + countdownMs;
    this.lastWinner = null;
    this.endReason = null;
    this.rematch = [false, false];
    this.setPhase('countdown');
  }

  private resync(r: ServerMessages['resync']): void {
    const [mine, theirs] = this.handling!;
    const other = (1 - this.you) as 0 | 1;
    if (this.local && this.round === r.round) {
      // Same page, same round: carry on, resending whatever the server missed.
      this.local.resendFrom(r.logs[this.you].upTo);
    } else {
      this.round = r.round;
      this.local = new OnlinePlayer(r.seed, mine, r.logs[this.you]);
      this.playStart = performance.now() - r.elapsedMs;
      this.setPhase(r.elapsedMs < 0 ? 'countdown' : 'playing');
    }
    for (const g of r.pending) this.local.receive(g);
    // The opponent's view is simply rebuilt from their whole stream.
    this.mirror = new StreamPlayer(r.seed, theirs);
    this.mirror.push(r.logs[other]);
    this.mirror.game.drainEvents();
  }

  private onEnd(e: ServerMessages['roundEnd'], phase: 'roundEnd' | 'matchEnd'): void {
    this.score = [e.score[this.you], e.score[1 - this.you]];
    this.lastWinner = e.winner === null ? null : e.winner === this.you ? 'you' : 'opponent';
    this.endReason = e.reason;
    this.setPhase(phase);
  }

  private setPhase(phase: OnlinePhase): void {
    this.phase = phase;
    this.events.phase(phase);
  }
}
