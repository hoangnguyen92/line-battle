import type { LevelId } from '@line-battle/bot';
import { DEFAULT_HANDLING, type Handling } from '@line-battle/engine';

const HANDLING_KEY = 'lineBattle.handling';
const SPRINT_BEST_KEY = 'lineBattle.sprintBestTicks';
const BOT_LEVEL_KEY = 'lineBattle.botLevel';
const GAUNTLET_BEST_KEY = 'lineBattle.gauntletBest';

// Storage can be unavailable (private mode, blocked site data), so every access is guarded.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* settings just won't persist */
  }
}

export function loadHandling(): Handling {
  try {
    const saved = JSON.parse(read(HANDLING_KEY) ?? 'null');
    if (saved && typeof saved.das === 'number') return { ...DEFAULT_HANDLING, ...saved };
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_HANDLING };
}

export function saveHandling(h: Handling): void {
  write(HANDLING_KEY, JSON.stringify(h));
}

export function loadBestTicks(): number | null {
  const v = Number(read(SPRINT_BEST_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function saveBestTicks(ticks: number): void {
  write(SPRINT_BEST_KEY, String(ticks));
}

export function loadBotLevel(): LevelId {
  const v = Number(read(BOT_LEVEL_KEY));
  return v >= 1 && v <= 5 ? (v as LevelId) : 2;
}

export function saveBotLevel(level: LevelId): void {
  write(BOT_LEVEL_KEY, String(level));
}

/** Bots beaten in the best gauntlet run (0-5). */
export function loadGauntletBest(): number {
  const v = Number(read(GAUNTLET_BEST_KEY));
  return v >= 1 && v <= 5 ? v : 0;
}

export function saveGauntletBest(beaten: number): void {
  write(GAUNTLET_BEST_KEY, String(beaten));
}
