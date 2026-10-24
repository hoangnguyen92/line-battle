import { attackFor, BOARD_WIDTH, type PieceType, type SpinKind } from '@line-battle/engine';
import { BotBoard, FULL_ROW } from './board';

/**
 * Evaluation weights. The board terms score the shape of the stack; the move
 * terms score what a placement just did. Values are in the same spirit as the
 * open-source Cold Clear bot's defaults, retuned by self-play.
 */
export interface Weights {
  height: number;
  topHalf: number;
  topQuarter: number;
  holes: number;
  holesSq: number;
  covered: number;
  bumpiness: number;
  bumpinessSq: number;
  rowTransitions: number;
  wellDepth: number;
  /** Bonus for the deepest well being in each column. */
  wellColumn: number[];
  /** Bonus for a ready T-spin slot by how many lines it would clear (0-3). */
  tSlot: number[];
  backToBack: number;

  clear: number[];
  tSpin: number[];
  tSpinMini: number[];
  b2bClear: number;
  perfectClear: number;
  /** Per line of combo bonus attack. */
  comboAttack: number;
  /** A T piece placed without a spin. */
  wastedT: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  height: -39,
  topHalf: -150,
  topQuarter: -511,
  holes: -173,
  holesSq: -3,
  covered: -17,
  bumpiness: -24,
  bumpinessSq: -7,
  rowTransitions: -5,
  wellDepth: 57,
  wellColumn: [20, 23, 20, 50, 59, 21, 59, 10, -10, 24],
  tSlot: [8, 148, 192, 407],
  backToBack: 52,

  clear: [0, -143, -100, -58, 390],
  tSpin: [0, 121, 410, 602],
  tSpinMini: [0, -158, -93],
  b2bClear: 104,
  perfectClear: 999,
  comboAttack: 150,
  wastedT: -152,
};

/** Board state the search tracks besides the cells. */
export interface Status {
  b2b: number;
  combo: number;
}

export interface MoveResult {
  lines: number;
  attack: number;
  perfectClear: boolean;
  status: Status;
  score: number;
}

/** Scores what a placement did (after its piece is on the board, before clearing). */
export function scoreMove(board: BotBoard, piece: PieceType, spin: SpinKind, status: Status, w: Weights): MoveResult {
  const lines = board.clearLines();
  let { b2b, combo } = status;
  let score = 0;
  if (lines > 0) {
    const difficult = lines === 4 || spin !== 'none';
    b2b = difficult ? b2b + 1 : -1;
    combo++;
  } else {
    combo = -1;
  }
  const perfectClear = lines > 0 && board.isEmpty();
  const attack = attackFor({ lines, spin, b2b: Math.max(b2b, 0), combo: Math.max(combo, 0), perfectClear });
  if (spin === 'full') score += w.tSpin[lines];
  else if (spin === 'mini') score += w.tSpinMini[lines];
  else score += w.clear[lines];
  if (piece === 'T' && spin === 'none') score += w.wastedT;
  if (attack.b2b > 0) score += w.b2bClear;
  if (perfectClear) score += w.perfectClear;
  score += attack.combo * w.comboAttack;
  return { lines, attack: attack.total, perfectClear, status: { b2b, combo }, score };
}

const heights = new Array<number>(BOARD_WIDTH);

/**
 * Scores the shape of a board. `danger` (incoming garbage lines) counts as
 * extra height for the top-of-board penalties, so the bot plays safer under attack.
 */
export function evaluateBoard(board: BotBoard, status: Status, w: Weights, danger = 0): number {
  const h = board.heights(heights);
  const { rows } = board;
  let score = 0;

  let maxH = 0;
  let well = 0;
  for (let x = 0; x < BOARD_WIDTH; x++) {
    if (h[x] > maxH) maxH = h[x];
    if (h[x] < h[well]) well = x;
  }
  const top = maxH + danger;
  score += w.height * maxH;
  if (top > 10) score += w.topHalf * (top - 10);
  if (top > 15) score += w.topQuarter * (top - 15);

  // Well: rows above the well column's floor that are full except for it.
  const wellMask = FULL_ROW & ~(1 << well);
  let depth = 0;
  for (let y = h[well]; y < rows.length && rows[y] === wellMask && depth < 6; y++) depth++;
  score += w.wellDepth * depth + w.wellColumn[well];

  // Bumpiness, skipping the well so keeping it open isn't punished.
  let bump = 0;
  let bumpSq = 0;
  let prev = -1;
  for (let x = 0; x < BOARD_WIDTH; x++) {
    if (x === well) continue;
    if (prev >= 0) {
      const d = Math.abs(h[x] - h[prev]);
      bump += d;
      bumpSq += d * d;
    }
    prev = x;
  }
  score += w.bumpiness * bump + w.bumpinessSq * bumpSq;

  // Holes: empty cells with something above them in the same column.
  let holes = 0;
  let roof = 0;
  for (let y = maxH - 1; y >= 0; y--) {
    holes += popcount(roof & ~rows[y] & FULL_ROW);
    roof |= rows[y];
  }
  // Cells stacked on top of each column's highest hole (up to 6), which must be dug out.
  let covered = 0;
  if (holes > 0) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const bit = 1 << x;
      for (let y = h[x] - 1, above = 0; y >= 0; y--) {
        if (rows[y] & bit) above++;
        else {
          covered += Math.min(above, 6);
          break;
        }
      }
    }
  }
  score += w.holes * holes + w.holesSq * holes * holes + w.covered * covered;

  // Row transitions: filled/empty changes along each row, walls count as filled.
  let transitions = 0;
  for (let y = 0; y < maxH; y++) {
    const r = rows[y] | (1 << BOARD_WIDTH);
    transitions += popcount(((r << 1) | 1) ^ r) & 0x7ff;
  }
  score += w.rowTransitions * transitions;

  if (status.b2b >= 0) score += w.backToBack;
  const slot = findTSlot(board, h);
  // The cell under the slot's roof is meant to be empty: don't count it as a hole.
  if (slot) score += w.tSlot[slot.lines] - w.holes;
  return score;
}

function popcount(n: number): number {
  n -= (n >> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export interface TSlot {
  /** Column of the T's centre. */
  cx: number;
  /** Row of the T's downward-pointing cell. */
  y: number;
  /** Lines a T spun in here would clear. */
  lines: number;
}

/**
 * Looks for a T-spin double slot: a T-shaped hole pointing down, with both
 * lower corners filled and a roof on one side, open to the other side.
 * Returns the one that clears the most lines, or null.
 */
export function findTSlot(board: BotBoard, h: number[]): TSlot | null {
  let best: TSlot | null = null;
  const occ = (x: number, y: number) => board.occupied(x, y);
  for (let cx = 1; cx < BOARD_WIDTH - 1; cx++) {
    // The T's centre sits on top of column cx's stack.
    const y = h[cx];
    if (occ(cx, y) || occ(cx - 1, y + 1) || occ(cx, y + 1) || occ(cx + 1, y + 1)) continue;
    if (!occ(cx - 1, y) || !occ(cx + 1, y)) continue;
    const roofL = occ(cx - 1, y + 2);
    const roofR = occ(cx + 1, y + 2);
    if (roofL === roofR) continue;
    // The open side must be reachable from above.
    const open = roofL ? cx + 1 : cx - 1;
    if (h[open] > y + 1) continue;
    const bottom = board.rows[y] | (1 << cx);
    const middle = board.rows[y + 1] | (7 << (cx - 1));
    const lines = (bottom === FULL_ROW ? 1 : 0) + (middle === FULL_ROW ? 1 : 0);
    if (!best || lines > best.lines) best = { cx, y, lines };
  }
  return best;
}

/** Lines the best T-spin slot would clear, or -1 if there is none. */
export function tSlotLines(board: BotBoard, h: number[]): number {
  return findTSlot(board, h)?.lines ?? -1;
}
