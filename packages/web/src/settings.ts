import type { LevelId } from '@line-battle/bot';
import { DEFAULT_HANDLING, isRegion, regionFromTimeZone, sanitizeHandling, sanitizePrefs, type Handling, type Prefs, type Region } from '@line-battle/engine';
import type { TouchMode, TouchStyle } from './touch';

const HANDLING_KEY = 'lineBattle.handling';
const SPRINT_BEST_KEY = 'lineBattle.sprintBestTicks';
const BOT_LEVEL_KEY = 'lineBattle.botLevel';
const GAUNTLET_BEST_KEY = 'lineBattle.gauntletBest';
const NAME_KEY = 'lineBattle.name';

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

/** The name shown to online opponents. */
export function loadName(): string {
  return read(NAME_KEY) ?? '';
}

export function saveName(name: string): void {
  write(NAME_KEY, name);
}

const REGION_KEY = 'lineBattle.region';

/** Where you play from, for matchmaking; first guessed from the browser's time zone. */
export function loadRegion(): Region {
  const saved = read(REGION_KEY);
  if (isRegion(saved)) return saved;
  try {
    return regionFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return 'asia';
  }
}

export function saveRegion(region: Region): void {
  write(REGION_KEY, region);
}

const PREFS_KEY = 'lineBattle.prefs';

/** Looks, keys and sound; the account's copy wins once signed in. */
export function loadPrefs(): Prefs {
  try {
    return sanitizePrefs(JSON.parse(read(PREFS_KEY) ?? 'null'));
  } catch {
    return sanitizePrefs(null);
  }
}

export function savePrefs(p: Prefs): void {
  write(PREFS_KEY, JSON.stringify(p));
}

const TOUCH_MODE_KEY = 'lineBattle.touchMode';
const TOUCH_HANDLING_KEY = 'lineBattle.touchHandling';

/**
 * Touch defaults: a longer DAS so a quick tap moves one cell, and soft drop
 * a bit faster since a thumb holds it for less time.
 */
export const TOUCH_HANDLING: Handling = { das: 12, arr: 2, sdf: 10 };

/** 'auto' shows the buttons on phones and tablets only. */
export function loadTouchMode(): TouchMode {
  const v = read(TOUCH_MODE_KEY);
  return v === 'on' || v === 'off' ? v : 'auto';
}

export function saveTouchMode(mode: TouchMode): void {
  write(TOUCH_MODE_KEY, mode);
}

/** Handling for the touch buttons; kept in this browser only, since it belongs to the device. */
export function loadTouchHandling(): Handling {
  try {
    const saved = JSON.parse(read(TOUCH_HANDLING_KEY) ?? 'null');
    if (saved && typeof saved.das === 'number') return sanitizeHandling(saved);
  } catch {
    /* fall through to defaults */
  }
  return { ...TOUCH_HANDLING };
}

export function saveTouchHandling(h: Handling): void {
  write(TOUCH_HANDLING_KEY, JSON.stringify(h));
}

const TOUCH_STYLE_KEY = 'lineBattle.touchStyle';
const SWIPE_SENSITIVITY_KEY = 'lineBattle.swipeSensitivity';

/** Swipe unless the player picked the buttons. */
export function loadTouchStyle(): TouchStyle {
  return read(TOUCH_STYLE_KEY) === 'buttons' ? 'buttons' : 'swipe';
}

export function saveTouchStyle(style: TouchStyle): void {
  write(TOUCH_STYLE_KEY, style);
}

/** Percent: 100 moves the piece one cell for each cell's width of drag; the default 80 is a little calmer. */
export function loadSwipeSensitivity(): number {
  const v = Number(read(SWIPE_SENSITIVITY_KEY));
  return v >= 50 && v <= 200 ? v : 80;
}

export function saveSwipeSensitivity(percent: number): void {
  write(SWIPE_SENSITIVITY_KEY, String(percent));
}
