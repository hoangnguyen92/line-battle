import { DEFAULT_HANDLING, type Handling } from '@line-battle/engine';

const HANDLING_KEY = 'lineBattle.handling';
const SPRINT_BEST_KEY = 'lineBattle.sprintBestTicks';

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
