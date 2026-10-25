import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import {
  isRegion,
  sanitizeHandling,
  sanitizeLook,
  TICK_RATE,
  type EndReason,
  type Handling,
  type Look,
  type MatchMode,
  type OnlineRoundReplay,
  type PlayerIndex,
  type Region,
  type ServerMessages,
} from '@line-battle/engine';
import { cleanName } from './names';
import { RoundReferee } from './referee';
import { getStore } from './services';
import { publicRating, type User } from './store';

export const ROUNDS_TO_WIN = 2;
/** Matches the client's 3-2-1 countdown. */
export const COUNTDOWN_MS = 1500;
/** Pause between rounds, while the end banner shows. */
export const ROUND_BREAK_MS = 3000;
/** A dropped player has this long to come back before they forfeit. */
export const RECONNECT_SECONDS = 10;
/** A player whose inputs stop arriving for this long forfeits (the plan's 10 s rule). */
export const STALL_MS = 10_000;

// No 0/O or 1/I, so a code read out loud can't be misheard.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function roomCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return s;
}

/** What a client's `auth` holds in this room. */
interface SeatAuth {
  user: User | null;
  /** Set on seats the queue reserved. */
  queued?: boolean;
}

interface Seat {
  sessionId: string;
  client: Client;
  user: User | null;
  name: string;
  handling: Handling;
  look: Look;
  connected: boolean;
  wantsRematch: boolean;
}

type Phase = 'waiting' | 'countdown' | 'playing' | 'break' | 'over';

/** Server-side options; tests shorten the timings. */
export interface BattleRoomOptions {
  /** 'private' rooms are joined by code; the others are made by the queue. */
  mode?: MatchMode;
  region?: Region;
  countdownMs?: number;
  roundBreakMs?: number;
}

/**
 * One online 1v1 match: first to 2 rounds. The room replays both players'
 * inputs through a RoundReferee, routes attacks between them and decides
 * every round.
 */
export class BattleRoom extends Room {
  maxClients = 2;
  /** Clients send a batch every ~50 ms; leave room for bursts. */
  maxMessagesPerSecond = 60;

  private seats: Seat[] = [];
  private phase: Phase = 'waiting';
  private score: [number, number] = [0, 0];
  private round = 0;
  private referee: RoundReferee | null = null;
  /** Date.now() at tick 0 of the current round. */
  private roundStart = 0;
  private code: string | null = null;
  private mode: MatchMode = 'quick';
  private region: Region = 'asia';
  /** Rounds of this match so far, for its replay. */
  private rounds: OnlineRoundReplay[] = [];
  private countdownMs = COUNTDOWN_MS;
  private roundBreakMs = ROUND_BREAK_MS;

  onCreate(options: BattleRoomOptions = {}): void {
    this.countdownMs = options.countdownMs ?? COUNTDOWN_MS;
    this.roundBreakMs = options.roundBreakMs ?? ROUND_BREAK_MS;
    this.mode = options.mode ?? 'quick';
    this.region = isRegion(options.region) ? options.region : 'asia';
    if (this.mode === 'private') {
      this.code = roomCode();
      this.roomId = this.code;
    }
    // Private rooms are found by code, queued ones only through their reserved seats.
    void this.setPrivate(true);
    this.onMessage('inputs', (client, batch) => this.onInputs(client, batch));
    this.onMessage('rematch', (client) => this.onRematch(client));
    this.clock.setInterval(() => this.checkStalls(), 500);
  }

  onAuth(client: Client, _options: unknown, context: AuthContext): SeatAuth | true {
    // The queue already checked who this is when it held the seat.
    if ((client.auth as SeatAuth | undefined)?.queued) return true;
    if (this.mode !== 'private') throw new ServerError(403, 'Join this match through the queue.');
    return { user: getStore()?.userForToken(context.token) ?? null };
  }

  onJoin(client: Client, options: { name?: unknown; handling?: unknown; look?: unknown } = {}): void {
    const user = (client.auth as SeatAuth | undefined)?.user ?? null;
    this.seats.push({
      sessionId: client.sessionId,
      client,
      user,
      name: user ? user.name : cleanName(options.name),
      handling: sanitizeHandling(options.handling),
      look: sanitizeLook(options.look),
      connected: true,
      wantsRematch: false,
    });
    if (this.seats.length < 2) {
      this.sendTo(0, 'waiting', { code: this.code });
      return;
    }
    this.seats.forEach((_, i) => this.sendMatch(i as PlayerIndex));
    this.startRound();
  }

  async onDrop(client: Client): Promise<void> {
    const p = this.seatOf(client);
    if (p === null || this.phase === 'over' || this.seats.length < 2) return;
    this.seats[p].connected = false;
    this.sendTo((1 - p) as PlayerIndex, 'oppStatus', { connected: false });
    // If the reconnection times out, onLeave runs and the player forfeits.
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: Client): void {
    const p = this.seatOf(client);
    if (p === null) return;
    const seat = this.seats[p];
    seat.client = client;
    seat.connected = true;
    this.sendTo((1 - p) as PlayerIndex, 'oppStatus', { connected: true });
    this.sendMatch(p);
    const ref = this.referee;
    if (ref && (this.phase === 'countdown' || this.phase === 'playing')) {
      ref.restartAckWindow(p, this.clockTick());
      this.sendTo(p, 'resync', {
        round: this.round,
        seed: ref.seed,
        elapsedMs: Date.now() - this.roundStart,
        logs: [ref.log(0), ref.log(1)],
        pending: ref.pending(p),
      });
    }
  }

  onLeave(client: Client): void {
    const p = this.seatOf(client);
    if (p === null) return;
    if (this.seats.length < 2) {
      this.seats.splice(p, 1);
      return;
    }
    this.seats[p].connected = false;
    this.endMatch((1 - p) as PlayerIndex, 'left');
    // Also after the match: it tells the other player a rematch is off.
    this.sendTo((1 - p) as PlayerIndex, 'oppStatus', { connected: false });
  }

  // ---- rounds ---------------------------------------------------------------

  private startRound(): void {
    this.round++;
    this.referee = new RoundReferee(Math.floor(Math.random() * 2 ** 32) >>> 0, [this.seats[0].handling, this.seats[1].handling]);
    this.roundStart = Date.now() + this.countdownMs;
    this.phase = 'countdown';
    this.broadcastAll('round', { round: this.round, seed: this.referee.seed, countdownMs: this.countdownMs });
    this.clock.setTimeout(() => {
      if (this.phase === 'countdown') this.phase = 'playing';
    }, this.countdownMs);
  }

  /** Server clock in ticks since tick 0 of this round. */
  private clockTick(): number {
    return Math.floor(((Date.now() - this.roundStart) * TICK_RATE) / 1000);
  }

  private onInputs(client: Client, batch: unknown): void {
    const p = this.seatOf(client);
    const ref = this.referee;
    // Inputs can arrive a moment before the server's own countdown ends.
    if (p === null || !ref || (this.phase !== 'playing' && this.phase !== 'countdown')) return;
    const result = ref.applyBatch(p, batch, this.clockTick());
    if (!result.ok) {
      console.warn(`room ${this.roomId}: rejected inputs from ${this.seats[p].name}: ${result.reason}`);
      return this.endMatch((1 - p) as PlayerIndex, 'invalid');
    }
    const opp = (1 - p) as PlayerIndex;
    this.sendTo(opp, 'opp', result.relay);
    for (const g of result.sent) this.sendTo(opp, 'garbage', g);
    if (result.toppedOut) this.endRound(opp, 'topOut');
  }

  /** Keeps the round that just ended for the replay. */
  private saveRound(winner: PlayerIndex | null): void {
    const ref = this.referee;
    if (!ref || this.rounds.length >= this.round) return;
    this.rounds.push({ seed: ref.seed, logs: [structuredClone(ref.log(0)), structuredClone(ref.log(1))], winner });
  }

  private endRound(winner: PlayerIndex, reason: EndReason): void {
    this.saveRound(winner);
    this.score[winner]++;
    if (this.score[winner] >= ROUNDS_TO_WIN) return this.endMatch(winner, reason);
    this.phase = 'break';
    this.broadcastAll('roundEnd', { winner, score: [...this.score], reason });
    const round = this.round;
    this.clock.setTimeout(() => {
      if (this.phase === 'break' && this.round === round) this.startRound();
    }, this.roundBreakMs);
  }

  private endMatch(winner: PlayerIndex, reason: EndReason): void {
    if (this.phase === 'over') return;
    // A forfeit gives the winner the match, whatever the score was.
    if (reason !== 'topOut') this.score[winner] = Math.max(this.score[winner], ROUNDS_TO_WIN);
    this.saveRound(winner);
    this.phase = 'over';
    this.referee = null;
    for (const s of this.seats) s.wantsRematch = false;
    this.broadcastAll('matchEnd', { winner, score: [...this.score], reason });
    this.record(winner, reason);
  }

  /** Saves the match for anyone with an account, and moves ratings in a ranked match. */
  private record(winner: PlayerIndex, reason: EndReason): void {
    const store = getStore();
    const [a, b] = this.seats;
    if (!store || (!a.user && !b.user)) return;
    try {
      const names: [string, string] = [a.name, b.name];
      const score: [number, number] = [...this.score];
      const { matchId, changes } = store.recordMatch({
        mode: this.mode,
        region: this.region,
        users: [a.user?.id ?? null, b.user?.id ?? null],
        names,
        score,
        winner,
        reason,
        // Rejected inputs void the match (the plan's anti-cheat rule); a forfeit still counts.
        rated: reason !== 'invalid',
        replay: { version: 1, kind: 'online', mode: this.mode, names, handling: [a.handling, b.handling], rounds: this.rounds, score, winner, reason },
      });
      this.broadcastAll('saved', { matchId });
      if (changes) {
        for (const p of [0, 1] as const) {
          this.sendTo(p, 'rating', changes[p]);
          // Later reads of this seat (a reconnect) show the new rating.
          const u = this.seats[p].user;
          if (u) this.seats[p].user = store.userById(u.id);
        }
      }
    } catch (e) {
      console.error(`room ${this.roomId}: could not save the match`, e);
    }
  }

  private onRematch(client: Client): void {
    const p = this.seatOf(client);
    if (p === null || this.phase !== 'over' || this.seats.length < 2 || this.mode === 'ranked') return;
    if (!this.seats[1 - p].connected) return;
    this.seats[p].wantsRematch = true;
    const requested: [boolean, boolean] = [this.seats[0].wantsRematch, this.seats[1].wantsRematch];
    this.broadcastAll('rematch', { requested });
    if (requested[0] && requested[1]) {
      this.score = [0, 0];
      this.round = 0;
      this.rounds = [];
      this.seats.forEach((_, i) => this.sendMatch(i as PlayerIndex));
      this.startRound();
    }
  }

  /** Forfeits a player whose inputs stopped coming (a frozen tab, a dead connection). */
  private checkStalls(): void {
    const ref = this.referee;
    if (!ref || this.phase !== 'playing') return;
    const now = this.clockTick();
    const stall = (STALL_MS * TICK_RATE) / 1000;
    for (const p of [0, 1] as const) {
      if (now - ref.game(p).tick > stall) return this.endMatch((1 - p) as PlayerIndex, 'timeout');
    }
  }

  // ---- helpers --------------------------------------------------------------

  private seatOf(client: Client): PlayerIndex | null {
    const i = this.seats.findIndex((s) => s.sessionId === client.sessionId);
    return i < 0 ? null : (i as PlayerIndex);
  }

  private sendMatch(p: PlayerIndex): void {
    const [a, b] = this.seats;
    this.sendTo(p, 'match', {
      you: p,
      names: [a.name, b.name],
      handling: [a.handling, b.handling],
      looks: [a.look, b.look],
      roundsToWin: ROUNDS_TO_WIN,
      score: [...this.score],
      mode: this.mode,
      ratings: a.user && b.user ? [publicRating(a.user.rating), publicRating(b.user.rating)] : null,
      canRematch: this.mode !== 'ranked',
    });
  }

  private sendTo<K extends keyof ServerMessages>(p: PlayerIndex, type: K, msg: ServerMessages[K]): void {
    const seat = this.seats[p];
    if (seat?.connected) seat.client.send(type, msg);
  }

  private broadcastAll<K extends keyof ServerMessages>(type: K, msg: ServerMessages[K]): void {
    for (const p of [0, 1] as const) this.sendTo(p, type, msg);
  }
}
