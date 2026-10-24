import type { ClearInfo } from './game';

/** Lines sent for a plain clear of 0-4 lines. */
const BASE_ATTACK = [0, 0, 1, 2, 4];
/** Lines sent for a full T-spin clearing 0-3 lines. */
const SPIN_ATTACK = [0, 2, 4, 6];
/** Lines sent for a T-spin mini clearing 0-2 lines. */
const MINI_ATTACK = [0, 0, 1];

export const PERFECT_CLEAR_BONUS = 10;

/** Combo bonus by combo count: 0, 1-2, 3-4, 5-6, 7-9, then 10+. */
export function comboBonus(combo: number): number {
  if (combo <= 0) return 0;
  if (combo <= 2) return 1;
  if (combo <= 4) return 2;
  if (combo <= 6) return 3;
  if (combo <= 9) return 4;
  return 5;
}

export interface Attack {
  base: number;
  b2b: number;
  combo: number;
  perfectClear: number;
  total: number;
}

/** Lines a clear sends before cancelling: base + back-to-back + combo + perfect clear. */
export function attackFor(info: Pick<ClearInfo, 'lines' | 'spin' | 'b2b' | 'combo' | 'perfectClear'>): Attack {
  if (info.lines === 0) return { base: 0, b2b: 0, combo: 0, perfectClear: 0, total: 0 };
  const table = info.spin === 'full' ? SPIN_ATTACK : info.spin === 'mini' ? MINI_ATTACK : BASE_ATTACK;
  const base = table[Math.min(info.lines, table.length - 1)];
  const b2b = info.b2b > 0 ? 1 : 0;
  const combo = comboBonus(info.combo);
  const perfectClear = info.perfectClear ? PERFECT_CLEAR_BONUS : 0;
  return { base, b2b, combo, perfectClear, total: base + b2b + combo + perfectClear };
}
