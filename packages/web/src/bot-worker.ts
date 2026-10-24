// Runs the bot's search off the main thread so thinking never stalls rendering.
import { LEVELS, think, type BotPlan, type BotSnapshot, type LevelId } from '@line-battle/bot';

export interface PlanRequest {
  id: number;
  level: LevelId;
  snap: BotSnapshot;
}

export interface PlanResponse {
  id: number;
  plan: BotPlan | null;
}

addEventListener('message', (e: MessageEvent<PlanRequest>) => {
  const { id, level, snap } = e.data;
  const response: PlanResponse = { id, plan: think(snap, LEVELS[level]) };
  postMessage(response);
});
