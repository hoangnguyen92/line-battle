import { SDF_INSTANT, TICK_RATE, type Game, type Handling, type Key, type KeyEvent } from '@line-battle/engine';
import type { BotLevel } from './levels';
import { snapshot, type BotPlan, type BotSnapshot } from './search';

/**
 * Handling for the bot's own game. It taps instead of holding keys, and a
 * soft drop tap must drop all the way so planned tucks line up.
 */
export const BOT_HANDLING: Handling = { das: 10, arr: 3, sdf: SDF_INSTANT };

/** Asks for a plan: synchronous in tests, a worker round trip in the browser. */
export type Planner = (snap: BotSnapshot) => BotPlan | null | Promise<BotPlan | null>;

interface Scheduled {
  key: Key;
  tick: number;
}

/**
 * Drives one Game for the bot. Call update() once per tick, before stepping
 * the game, and feed the returned key events in. It asks the planner for a
 * plan whenever a new piece appears, then taps the plan out at the level's
 * speed, so the bot obeys the same rules and timing as a human.
 */
export class BotController {
  private pieceId = -1;
  private pieceStart = 0;
  private waiting = false;
  private plan: BotPlan | null = null;
  private taps: Scheduled[] = [];
  private scheduled = false;
  private replans = 0;

  constructor(readonly level: BotLevel, private planner: Planner) {}

  /** Ticks from a piece appearing to its hard drop, so that with the entry delay the bot keeps its speed. */
  interval(game: Game): number {
    return Math.max(1, Math.round(TICK_RATE / this.level.pps) - game.config.entryDelay);
  }

  /** Forgets the current piece, e.g. at the start of a new round. */
  reset(): void {
    this.pieceId = -1;
    this.waiting = false;
    this.plan = null;
    this.taps = [];
    this.scheduled = false;
  }

  update(game: Game): KeyEvent[] {
    if (game.over || !game.active) return [];
    if (game.piecesPlaced !== this.pieceId) {
      this.pieceId = game.piecesPlaced;
      this.pieceStart = game.tick;
      this.plan = null;
      this.taps = [];
      this.scheduled = false;
      this.replans = 0;
      this.request(game);
    }
    if (this.plan && !this.scheduled) this.schedule(game);
    const out: KeyEvent[] = [];
    while (this.taps.length > 0 && this.taps[0].tick <= game.tick) {
      const { key } = this.taps.shift()!;
      out.push({ key, down: true }, { key, down: false });
    }
    return out;
  }

  private request(game: Game): void {
    const snap = snapshot(game);
    if (!snap) return;
    const id = this.pieceId;
    this.waiting = true;
    const result = this.planner(snap);
    const accept = (plan: BotPlan | null) => {
      if (id !== this.pieceId) return; // the piece is gone, the plan is stale
      this.waiting = false;
      // No legal spot at all: just drop it.
      this.plan = plan ?? { hold: false, start: snap.active, target: { ...snap.active, spin: 'none' }, inputs: [] };
    };
    if (result instanceof Promise) result.then(accept, () => accept(null));
    else accept(result);
  }

  /** Spreads the plan's taps so the piece lands about one interval after it appeared. */
  private schedule(game: Game): void {
    const plan = this.plan!;
    const p = game.active!;
    // The piece moved while the plan was being made (gravity): plan again from here.
    if (!plan.hold && (p.x !== plan.start.x || p.y !== plan.start.y || p.rot !== plan.start.rot)) {
      if (this.replans++ < 2 && !this.waiting) {
        this.plan = null;
        this.request(game);
        if (!this.plan) return;
        return this.schedule(game);
      }
    }
    const keys: Key[] = [...plan.inputs, 'hardDrop'];
    const gap = this.level.inputGap;
    const first = Math.max(game.tick, this.pieceStart + this.interval(game) - (keys.length - 1) * gap - 1);
    this.taps = keys.map((key, i) => ({ key, tick: first + i * gap }));
    this.scheduled = true;
  }
}
