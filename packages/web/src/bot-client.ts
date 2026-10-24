import { LEVELS, think, type BotPlan, type BotSnapshot, type LevelId, type Planner } from '@line-battle/bot';
import type { PlanRequest, PlanResponse } from './bot-worker';

/** Sends plan requests to the bot worker and matches up the answers. */
export class BotWorker {
  private worker: Worker | null = null;
  private nextId = 0;
  private waiting = new Map<number, (plan: BotPlan | null) => void>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./bot-worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (e: MessageEvent<PlanResponse>) => {
        const resolve = this.waiting.get(e.data.id);
        this.waiting.delete(e.data.id);
        resolve?.(e.data.plan);
      });
      this.worker.addEventListener('error', () => this.fallBack());
    } catch {
      this.worker = null;
    }
  }

  /** A planner for one difficulty level, for BotController. */
  planner(level: LevelId): Planner {
    return (snap) => this.plan(level, snap);
  }

  private plan(level: LevelId, snap: BotSnapshot): BotPlan | null | Promise<BotPlan | null> {
    // Without a worker the bot thinks on the main thread; slower, but it still plays.
    if (!this.worker) return think(snap, LEVELS[level]);
    const id = this.nextId++;
    const request: PlanRequest = { id, level, snap };
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker!.postMessage(request);
    });
  }

  /** The worker failed to load: answer anything still waiting with "no plan" and stop using it. */
  private fallBack(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const resolve of this.waiting.values()) resolve(null);
    this.waiting.clear();
  }
}
