import { Game, garbageSeed, type GameConfig, type GameEvent, type KeyEvent } from './game';
import type { ReplayInput } from './replay';

export type PlayerIndex = 0 | 1;

export interface MatchConfig {
  /** Shared seed: both players get the same pieces. */
  seed: number;
  /** Per-player settings such as handling; the seed always comes from the match. */
  players?: [Partial<GameConfig>, Partial<GameConfig>];
  /** Both boards get the same garbage holes, as before replay version 2. */
  sharedGarbage?: boolean;
}

/**
 * A deterministic 1v1 round: two games stepped on the same tick, with each
 * player's attacks routed into the other's garbage queue.
 */
export class Match {
  readonly players: [Game, Game];
  tick = 0;
  /** Set when the round ends: the winner, or 'draw' if both topped out on one tick. */
  result: PlayerIndex | 'draw' | null = null;

  private events: [GameEvent[], GameEvent[]] = [[], []];

  constructor(readonly config: MatchConfig) {
    const [a, b] = config.players ?? [{}, {}];
    const holes = (p: PlayerIndex) => garbageSeed(config.seed, config.sharedGarbage ? null : p);
    this.players = [
      new Game({ ...a, seed: config.seed, garbageSeed: holes(0) }),
      new Game({ ...b, seed: config.seed, garbageSeed: holes(1) }),
    ];
  }

  get over(): boolean {
    return this.result !== null;
  }

  step(inputs: [readonly KeyEvent[], readonly KeyEvent[]] = [[], []]): void {
    if (this.over) return;
    this.players[0].step(inputs[0]);
    this.players[1].step(inputs[1]);
    // Route attacks only after both have stepped, so neither player gets a head start.
    const drained = [this.players[0].drainEvents(), this.players[1].drainEvents()];
    for (const i of [0, 1] as const) {
      for (const e of drained[i]) {
        if (e.type === 'attack' && e.info.sent > 0) this.players[1 - i].receiveGarbage(e.info.sent);
      }
      this.events[i].push(...drained[i]);
    }
    this.tick++;
    const [a, b] = this.players;
    if (a.toppedOut && b.toppedOut) this.result = 'draw';
    else if (a.toppedOut) this.result = 1;
    else if (b.toppedOut) this.result = 0;
  }

  /** Returns and clears each player's events since the last call. */
  drainEvents(): [GameEvent[], GameEvent[]] {
    const out = this.events;
    this.events = [[], []];
    return out;
  }
}

export interface MatchReplay {
  /** 2 since each player got their own garbage holes. */
  version: 1 | 2;
  kind: 'match';
  config: MatchConfig;
  inputs: [ReplayInput[], ReplayInput[]];
  ticks: number;
}

/** Records both players' inputs so a round can be replayed exactly. */
export class MatchRecorder {
  readonly inputs: [ReplayInput[], ReplayInput[]] = [[], []];

  constructor(readonly config: MatchConfig) {}

  record(player: PlayerIndex, tick: number, e: KeyEvent): void {
    this.inputs[player].push({ tick, key: e.key, down: e.down });
  }

  finish(ticks: number): MatchReplay {
    return { version: 2, kind: 'match', config: this.config, inputs: [[...this.inputs[0]], [...this.inputs[1]]], ticks };
  }
}

/** Re-runs a recorded round from scratch and returns the finished match. */
export function playMatchReplay(replay: MatchReplay): Match {
  const match = new Match(replay.version === 1 ? { ...replay.config, sharedGarbage: true } : replay.config);
  const next = [0, 0];
  while (match.tick < replay.ticks && !match.over) {
    const batch = ([0, 1] as const).map((p) => {
      const out: KeyEvent[] = [];
      const list = replay.inputs[p];
      while (next[p] < list.length && list[next[p]].tick === match.tick) out.push(list[next[p]++]);
      return out;
    });
    match.step([batch[0], batch[1]]);
  }
  return match;
}
