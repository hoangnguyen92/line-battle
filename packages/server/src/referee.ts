import { decodeKey, Game, KEYS, TICK_RATE, type Handling, type InputBatch, type KeyEvent, type PlayerIndex, type RelayBatch } from '@line-battle/engine';

/** How far a client's tick may run ahead of the server's clock (a speed hack check). */
export const LEAD_SLACK_TICKS = 30;
/** A client may take this long to let in garbage after the server sends it. */
export const ACK_WINDOW_TICKS = 120;
/** Most ticks one batch may cover, so one message can't make the server simulate minutes. */
export const MAX_BATCH_TICKS = 600;
/** Pieces in any one second above this can't be human (the plan's ~30 pps rule). */
export const MAX_PIECES_PER_SECOND = 30;

export interface Garbage {
  id: number;
  lines: number;
}

export type BatchResult =
  | {
      ok: true;
      /** The batch for the opponent's view of this board. */
      relay: RelayBatch;
      /** Attacks this batch sent, already queued as pending for the opponent. */
      sent: Garbage[];
      toppedOut: boolean;
    }
  | { ok: false; reason: string };

interface Pending extends Garbage {
  /** Server clock tick when it was sent; it must be let in within ACK_WINDOW_TICKS of that. */
  sentAt: number;
}

/** The server's copy of one player's board, rebuilt from that player's inputs. */
class PlayerSim {
  readonly game: Game;
  /** Everything accepted so far, for a reconnect. */
  readonly log: RelayBatch = { upTo: 0, keys: [], acks: [] };
  readonly pending: Pending[] = [];
  private lockTicks: number[] = [];

  constructor(seed: number, handling: Handling) {
    this.game = new Game({ seed, handling });
  }

  /** Notes a lock; false when more than MAX_PIECES_PER_SECOND locked within one second. */
  recordLock(tick: number): boolean {
    this.lockTicks.push(tick);
    while (this.lockTicks[0] <= tick - TICK_RATE) this.lockTicks.shift();
    return this.lockTicks.length <= MAX_PIECES_PER_SECOND;
  }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Checks a batch's shape and order without touching any state. */
function checkShape(b: unknown, from: number): string | null {
  const batch = b as Partial<InputBatch> | null;
  if (!batch || !isInt(batch.upTo) || !Array.isArray(batch.keys) || !Array.isArray(batch.acks)) return 'malformed batch';
  if (batch.upTo < from) return 'batch goes back in time';
  if (batch.upTo - from > MAX_BATCH_TICKS) return 'batch too long';
  // At most a press and a release of every key, every tick.
  if (batch.keys.length > (batch.upTo - from) * KEYS.length * 2) return 'too many inputs';
  let last = from;
  for (const k of batch.keys) {
    if (!Array.isArray(k) || k.length !== 3 || !k.every(isInt)) return 'malformed input';
    const [tick, key, down] = k;
    if (tick < last || tick >= batch.upTo || key < 0 || key >= KEYS.length || (down !== 0 && down !== 1)) return 'input out of order';
    last = tick;
  }
  last = from;
  for (const a of batch.acks) {
    if (!Array.isArray(a) || a.length !== 2 || !a.every(isInt)) return 'malformed garbage ack';
    if (a[0] < last || a[0] >= batch.upTo) return 'garbage ack out of order';
    last = a[0];
  }
  return null;
}

/**
 * Referees one round. Each player's inputs are replayed here with the same
 * engine, so the server always knows the true boards: attacks come from the
 * server's copy, never from what a client claims.
 */
export class RoundReferee {
  readonly sims: [PlayerSim, PlayerSim];
  private nextGarbageId = 1;

  constructor(readonly seed: number, handling: [Handling, Handling]) {
    this.sims = [new PlayerSim(seed, handling[0]), new PlayerSim(seed, handling[1])];
  }

  game(p: PlayerIndex): Game {
    return this.sims[p].game;
  }

  /** Garbage sent to `p` that it hasn't let in yet. */
  pending(p: PlayerIndex): Garbage[] {
    return this.sims[p].pending.map(({ id, lines }) => ({ id, lines }));
  }

  /** After a reconnect the player couldn't have let anything in, so their window starts again now. */
  restartAckWindow(p: PlayerIndex, clockTick: number): void {
    for (const g of this.sims[p].pending) g.sentAt = Math.max(g.sentAt, clockTick);
  }

  log(p: PlayerIndex): RelayBatch {
    return this.sims[p].log;
  }

  /**
   * Applies one batch from player `p`. `clockTick` is how many ticks have
   * passed on the server's clock since the round started.
   */
  applyBatch(p: PlayerIndex, batch: unknown, clockTick: number): BatchResult {
    const sim = this.sims[p];
    const opp = this.sims[1 - p];
    const g = sim.game;
    const from = g.tick;
    const shape = checkShape(batch, from);
    if (shape) return { ok: false, reason: shape };
    const b = batch as InputBatch;
    if (b.upTo > clockTick + LEAD_SLACK_TICKS) return { ok: false, reason: 'running faster than real time' };

    const relay: RelayBatch = { upTo: b.upTo, keys: b.keys, acks: [] };
    const sent: Garbage[] = [];
    let ki = 0;
    let ai = 0;
    while (g.tick < b.upTo && !g.over) {
      while (ai < b.acks.length && b.acks[ai][0] === g.tick) {
        const id = b.acks[ai++][1];
        const at = sim.pending.findIndex((x) => x.id === id);
        if (at < 0) return { ok: false, reason: 'unknown garbage' };
        const [{ lines }] = sim.pending.splice(at, 1);
        g.receiveGarbage(lines);
        relay.acks.push([g.tick, lines]);
      }
      const events: KeyEvent[] = [];
      while (ki < b.keys.length && b.keys[ki][0] === g.tick) events.push(decodeKey(b.keys[ki++]));
      g.step(events);
      for (const ev of g.drainEvents()) {
        if (ev.type === 'lock' && !sim.recordLock(ev.tick)) return { ok: false, reason: 'placing pieces impossibly fast' };
        if (ev.type === 'attack' && ev.info.sent > 0) {
          const garbage = { id: this.nextGarbageId++, lines: ev.info.sent };
          opp.pending.push({ ...garbage, sentAt: clockTick });
          sent.push(garbage);
        }
      }
    }
    const late = sim.pending.find((x) => g.tick > x.sentAt + ACK_WINDOW_TICKS);
    if (late && !g.over) return { ok: false, reason: 'garbage was not let in' };

    // A batch that topped out is cut where the game ended.
    relay.upTo = g.tick;
    if (g.over) relay.keys = b.keys.slice(0, ki);
    sim.log.upTo = relay.upTo;
    sim.log.keys.push(...relay.keys);
    sim.log.acks.push(...relay.acks);
    return { ok: true, relay, sent, toppedOut: g.toppedOut };
  }
}
