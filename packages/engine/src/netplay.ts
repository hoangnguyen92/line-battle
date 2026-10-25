import { DEFAULT_HANDLING, Game, garbageSeed, KEYS, SDF_INSTANT, type Handling, type Key, type KeyEvent } from './game';
import type { Look } from './cosmetics';
import type { PlayerIndex } from './match';
import type { PublicRating, RatingChange } from './lobby';

/**
 * Online play: each client simulates only its own board and streams what it
 * did to the server in batches. A batch covers the ticks from the end of the
 * previous one up to (not including) `upTo`, so the server can replay it with
 * the same engine and get exactly the same board.
 */
export interface InputBatch {
  /** The sender's tick count after this batch. */
  upTo: number;
  /** Key changes as [tick, key index in KEYS, 1 = down / 0 = up]. */
  keys: [number, number, number][];
  /**
   * Garbage the sender let in, as [tick, garbage id]. It is queued just before
   * that tick is stepped, which is what keeps the server's copy in sync.
   */
  acks: [number, number][];
}

/**
 * The same batch as relayed to the opponent, with each garbage id swapped for
 * its line count. A whole stream so far has this shape too (sent after a reconnect).
 */
export interface RelayBatch {
  upTo: number;
  keys: [number, number, number][];
  acks: [number, number][];
}

export function encodeKey(tick: number, e: KeyEvent): [number, number, number] {
  return [tick, KEYS.indexOf(e.key), e.down ? 1 : 0];
}

export function decodeKey(k: readonly number[]): KeyEvent {
  return { key: KEYS[k[1]] as Key, down: k[2] === 1 };
}

/** Clamps handling a client sent to the ranges the settings screen offers. */
export function sanitizeHandling(h: unknown): Handling {
  const src = (h ?? {}) as Partial<Record<keyof Handling, unknown>>;
  const pick = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  return {
    das: pick(src.das, 0, 20, DEFAULT_HANDLING.das),
    arr: pick(src.arr, 0, 5, DEFAULT_HANDLING.arr),
    sdf: pick(src.sdf, 5, SDF_INSTANT, DEFAULT_HANDLING.sdf),
  };
}

/**
 * Drives a Game from a relayed stream: used for the opponent's board on the
 * client, and to rebuild a board after a reconnect. Garbage is given as line
 * counts here; the server, which knows the ids, does its own lookup.
 */
export class StreamPlayer {
  readonly game: Game;
  private keys: [number, number, number][] = [];
  private acks: [number, number][] = [];

  /** `player` is whose board this is (it picks the garbage holes); null for the old shared holes. */
  constructor(seed: number, handling: Handling, player: PlayerIndex | null) {
    this.game = new Game({ seed, handling, garbageSeed: garbageSeed(seed, player) });
  }

  /** Queues a batch and steps the game up to its end. */
  push(batch: RelayBatch): void {
    this.keys.push(...batch.keys);
    this.acks.push(...batch.acks);
    this.advance(batch.upTo);
  }

  advance(upTo: number): void {
    const g = this.game;
    while (g.tick < upTo && !g.over) {
      while (this.acks.length > 0 && this.acks[0][0] <= g.tick) g.receiveGarbage(this.acks.shift()![1]);
      const events: KeyEvent[] = [];
      while (this.keys.length > 0 && this.keys[0][0] <= g.tick) events.push(decodeKey(this.keys.shift()!));
      g.step(events);
    }
  }
}

/**
 * The local player's side of an online game: steps their own Game with zero
 * input delay, lets in garbage the server sends, and collects what happened
 * into batches for the server. The whole stream is kept for the round, so
 * after a dropped connection it can resend from wherever the server got to.
 */
export class OnlinePlayer {
  readonly game: Game;
  private keys: [number, number, number][] = [];
  private acks: [number, number][] = [];
  private inbox: GarbageMsg[] = [];
  private seen = new Set<number>();
  /** Ticks before this have been sent. */
  private sentUpTo = 0;

  /** `log` rebuilds the board after a page reload (the server's copy of this stream). */
  constructor(seed: number, handling: Handling, player: PlayerIndex, log?: RelayBatch) {
    if (log) {
      const rebuilt = new StreamPlayer(seed, handling, player);
      rebuilt.push(log);
      this.game = rebuilt.game;
      this.game.drainEvents();
      this.sentUpTo = log.upTo;
    } else {
      this.game = new Game({ seed, handling, garbageSeed: garbageSeed(seed, player) });
    }
  }

  /** Garbage from the server; it is let in before the next tick. Repeats are ignored. */
  receive(g: GarbageMsg): void {
    if (this.seen.has(g.id)) return;
    this.seen.add(g.id);
    this.inbox.push(g);
  }

  step(events: readonly KeyEvent[]): void {
    const g = this.game;
    if (g.over) return;
    for (const garbage of this.inbox) {
      g.receiveGarbage(garbage.lines);
      this.acks.push([g.tick, garbage.id]);
    }
    this.inbox = [];
    for (const e of events) this.keys.push(encodeKey(g.tick, e));
    g.step(events);
  }

  /** Everything not sent yet, at most `maxTicks` of it. */
  takeBatch(maxTicks = 300): InputBatch {
    const from = this.sentUpTo;
    const upTo = Math.min(this.game.tick, from + maxTicks);
    const inRange = (t: number) => t >= from && t < upTo;
    this.sentUpTo = upTo;
    return { upTo, keys: this.keys.filter((k) => inRange(k[0])), acks: this.acks.filter((a) => inRange(a[0])) };
  }

  /** Ticks played but not sent yet. */
  get unsentTicks(): number {
    return this.game.tick - this.sentUpTo;
  }

  /** After a reconnect: the server has everything before `upTo`, so resend from there. */
  resendFrom(upTo: number): void {
    this.sentUpTo = Math.min(upTo, this.game.tick);
  }
}

// ---- messages between the client and the match server -------------------

/** Why a round or match ended. 'invalid' means the server rejected that player's inputs. */
export type EndReason = 'topOut' | 'left' | 'timeout' | 'invalid';

export interface GarbageMsg {
  id: number;
  lines: number;
}

/** Server to client messages, by type. */
export interface ServerMessages {
  /** Only one player is in the room so far. `code` is set for a private room. */
  waiting: { code: string | null };
  /** Both players are in. Sent again after a reconnect. */
  match: {
    you: 0 | 1;
    names: [string, string];
    handling: [Handling, Handling];
    /** Each player's character and block skin. */
    looks: [Look, Look];
    roundsToWin: number;
    score: [number, number];
    /** 'ranked' and 'quick' matches come from the queue; 'private' from a room code. */
    mode: MatchMode;
    /** Both players' ratings, when both have accounts. */
    ratings: [PublicRating, PublicRating] | null;
    /** Ranked matches have no rematch: queue again for a fresh opponent. */
    canRematch: boolean;
  };
  /** A round starts after the countdown. Both boards use `seed`. */
  round: { round: number; seed: number; countdownMs: number };
  /** An attack for you to let in. */
  garbage: GarbageMsg;
  /** The opponent's accepted inputs, to drive their board on your screen. */
  opp: RelayBatch;
  /** After a reconnect: both streams so far, garbage you haven't let in, and the time since tick 0. */
  resync: { round: number; seed: number; elapsedMs: number; logs: [RelayBatch, RelayBatch]; pending: GarbageMsg[] };
  oppStatus: { connected: boolean };
  roundEnd: { winner: 0 | 1 | null; score: [number, number]; reason: EndReason };
  matchEnd: { winner: 0 | 1 | null; score: [number, number]; reason: EndReason };
  /** After a ranked match, to each player with their own change. */
  rating: RatingChange;
  /** The match was saved: its replay can be fetched from /api/matches/:id/replay. */
  saved: { matchId: number };
  /** Who has asked for a rematch so far. */
  rematch: { requested: [boolean, boolean] };
}

export type MatchMode = 'ranked' | 'quick' | 'private';

/**
 * Options a client passes when it creates or joins a private room. Queued
 * matches are joined through a seat reservation from the queue instead.
 */
export interface JoinOptions {
  mode: 'private';
  name: string;
  handling: Handling;
  look: Look;
}

/** Rooms are named this on the server. */
export const BATTLE_ROOM = 'battle';
/** The matchmaking queue's room. */
export const QUEUE_ROOM = 'queue';
