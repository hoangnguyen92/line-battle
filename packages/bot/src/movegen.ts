import { getKicks, PIECE_CELLS, VISIBLE_HEIGHT, type Key, type PieceType, type Rotation, type SpinKind } from '@line-battle/engine';
import type { BotBoard } from './board';

/** Where pieces spawn, matching the engine. */
export const SPAWN_X: Record<PieceType, number> = { I: 3, J: 3, L: 3, O: 4, S: 3, T: 3, Z: 3 };
export const SPAWN_Y = VISIBLE_HEIGHT + 1;

export interface PieceState {
  x: number;
  y: number;
  rot: Rotation;
}

/** A final resting spot for a piece and the taps that get it there (hard drop not included). */
export interface Placement extends PieceState {
  type: PieceType;
  spin: SpinKind;
  inputs: Key[];
}

/** One tap: the engine applies each of these as a press and release. */
type Op = 'left' | 'right' | 'rotateCW' | 'rotateCCW' | 'rotate180' | 'softDrop';
const OPS: readonly Op[] = ['left', 'right', 'rotateCW', 'rotateCCW', 'rotate180', 'softDrop'];
const TURN: Partial<Record<Op, 1 | 2 | 3>> = { rotateCW: 1, rotateCCW: 3, rotate180: 2 };

interface Node extends PieceState {
  /** The last move was a rotation (needed for T-spins). */
  rotated: boolean;
  /** The last rotation used the fifth kick, which upgrades a mini to a full T-spin. */
  kick4: boolean;
  path: Op[];
}

/** 3-corner T-spin check, the same rule as the engine. */
export function detectSpin(board: BotBoard, type: PieceType, s: PieceState, rotated: boolean, kick4: boolean): SpinKind {
  if (type !== 'T' || !rotated) return 'none';
  const cx = s.x + 1;
  const cy = s.y - 1;
  const corners = [
    board.occupied(cx - 1, cy + 1), board.occupied(cx + 1, cy + 1),
    board.occupied(cx + 1, cy - 1), board.occupied(cx - 1, cy - 1),
  ];
  let filled = 0;
  for (const c of corners) if (c) filled++;
  if (filled < 3) return 'none';
  if (corners[s.rot] && corners[(s.rot + 1) % 4]) return 'full';
  return kick4 ? 'full' : 'mini';
}

function rotate(board: BotBoard, type: PieceType, n: Node, turn: 1 | 2 | 3): Node | null {
  const to = ((n.rot + turn) % 4) as Rotation;
  const kicks = getKicks(type, n.rot, to);
  for (let i = 0; i < kicks.length; i++) {
    const [kx, ky] = kicks[i];
    if (board.fits(type, n.x + kx, n.y + ky, to)) {
      return { x: n.x + kx, y: n.y + ky, rot: to, rotated: true, kick4: i === 4, path: n.path };
    }
  }
  return null;
}

function apply(board: BotBoard, type: PieceType, n: Node, op: Op): Node | null {
  const turn = TURN[op];
  if (turn) return rotate(board, type, n, turn);
  if (op === 'softDrop') {
    const y = board.dropY(type, n.x, n.y, n.rot);
    return y === n.y ? null : { ...n, y, rotated: false, kick4: false };
  }
  const dx = op === 'left' ? -1 : 1;
  return board.fits(type, n.x + dx, n.y, n.rot) ? { ...n, x: n.x + dx, rotated: false, kick4: false } : null;
}

/** Cells of a placement as one sortable key, so placements that look the same merge. */
function cellKey(type: PieceType, s: PieceState, spin: SpinKind): string {
  const list = PIECE_CELLS[type][s.rot].map(([dx, dy]) => (s.y + dy) * 16 + s.x + dx).sort((a, b) => a - b);
  return `${list.join(',')}${type === 'T' ? spin : ''}`;
}

/**
 * Every spot the piece can reach and lock in, found by a breadth-first search
 * over taps from its current position. That includes tucks under overhangs and
 * spins. Each spot keeps its shortest tap sequence.
 */
export function findPlacements(
  board: BotBoard,
  type: PieceType,
  start: PieceState,
  maxDepth = 12,
): Placement[] {
  if (!board.fits(type, start.x, start.y, start.rot)) return [];
  const seen = new Set<number>();
  const keyOf = (n: Node) => ((n.y * 16 + n.x) * 4 + n.rot) * 4 + (type === 'T' ? (n.rotated ? 1 : 0) + (n.kick4 ? 2 : 0) : 0);
  const root: Node = { ...start, rotated: false, kick4: false, path: [] };
  seen.add(keyOf(root));
  let frontier = [root];
  const best = new Map<string, Placement>();

  for (let depth = 0; frontier.length > 0; depth++) {
    const next: Node[] = [];
    for (const n of frontier) {
      // Lock from here with a hard drop.
      const y = board.dropY(type, n.x, n.y, n.rot);
      const grounded = y === n.y;
      const spin = grounded ? detectSpin(board, type, n, n.rotated, n.kick4) : 'none';
      const at = { x: n.x, y, rot: n.rot };
      const key = cellKey(type, at, spin);
      // A soft drop right before the hard drop does nothing, so leave it out.
      const path = n.path[n.path.length - 1] === 'softDrop' && !n.rotated ? n.path.slice(0, -1) : n.path;
      const prev = best.get(key);
      if (!prev || prev.inputs.length > path.length) best.set(key, { type, ...at, spin, inputs: path });

      if (depth >= maxDepth) continue;
      for (const op of OPS) {
        const m = apply(board, type, n, op);
        if (!m) continue;
        const k = keyOf(m);
        if (seen.has(k)) continue;
        seen.add(k);
        m.path = [...n.path, op];
        next.push(m);
      }
    }
    frontier = next;
  }
  return [...best.values()];
}

/**
 * The quick version used deeper in the search: every rotation and column
 * reachable by rotating at the spawn row, sliding, then dropping straight down.
 */
export function findDrops(board: BotBoard, type: PieceType): Placement[] {
  const out: Placement[] = [];
  const sx = SPAWN_X[type];
  // Start each drop just above the stack instead of at the spawn row.
  const floor = Math.max(...board.heights()) + 3;
  for (const rot of DROP_ROTATIONS[type]) {
    let x0 = sx;
    let y0 = SPAWN_Y;
    if (rot !== 0) {
      const k = getKicks(type, 0, rot).find(([kx, ky]) => board.fits(type, sx + kx, SPAWN_Y + ky, rot));
      if (!k) continue;
      x0 += k[0];
      y0 += k[1];
    }
    const from = Math.min(y0, floor);
    for (let x = x0; board.fits(type, x, y0, rot); x--) out.push(drop(board, type, x, from, rot));
    for (let x = x0 + 1; board.fits(type, x, y0, rot); x++) out.push(drop(board, type, x, from, rot));
  }
  return out;
}

/** Rotations that give different shapes: the others repeat these, shifted. */
const DROP_ROTATIONS: Record<PieceType, Rotation[]> = {
  I: [0, 1], O: [0], S: [0, 1], Z: [0, 1], J: [0, 1, 2, 3], L: [0, 1, 2, 3], T: [0, 1, 2, 3],
};

function drop(board: BotBoard, type: PieceType, x: number, y: number, rot: Rotation): Placement {
  return { type, x, y: board.dropY(type, x, y, rot), rot, spin: 'none', inputs: [] };
}

/** True when this placement leaves the piece entirely above the visible field (a lock out). */
export function locksOut(type: PieceType, s: PieceState): boolean {
  return PIECE_CELLS[type][s.rot].every(([, dy]) => s.y + dy >= VISIBLE_HEIGHT);
}
