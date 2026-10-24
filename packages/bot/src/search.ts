import { BOARD_HEIGHT, VISIBLE_HEIGHT, type Game, type Key, type PieceType, type SpinKind } from '@line-battle/engine';
import { BotBoard } from './board';
import { evaluateBoard, findTSlot, scoreMove, type Status } from './evaluate';
import type { BotLevel } from './levels';
import { findDrops, findPlacements, locksOut, SPAWN_X, SPAWN_Y, type PieceState, type Placement } from './movegen';

/** Everything the bot needs to decide, as plain data so it can be posted to a worker. */
export interface BotSnapshot {
  /** One bitmask per row, bottom row first. */
  rows: number[];
  current: PieceType;
  /** Where the current piece is now. */
  active: PieceState;
  hold: PieceType | null;
  holdUsed: boolean;
  queue: PieceType[];
  b2b: number;
  combo: number;
  /** Garbage lines waiting to rise into this board. */
  incoming: number;
}

export interface BotPlan {
  hold: boolean;
  /** Where the piece starts (for the current piece, the position the plan was made from). */
  start: PieceState;
  target: PieceState & { spin: SpinKind };
  /** Taps to make before the hard drop, starting with 'hold' if the plan holds. */
  inputs: Key[];
}

export function snapshot(game: Game): BotSnapshot | null {
  const p = game.active;
  if (!p) return null;
  return {
    rows: [...BotBoard.from(game.board).rows],
    current: p.type,
    active: { x: p.x, y: p.y, rot: p.rot },
    hold: game.hold,
    holdUsed: game.holdUsed,
    queue: game.queue,
    b2b: game.b2b,
    combo: game.combo,
    incoming: game.incomingLines,
  };
}

interface SearchNode {
  board: BotBoard;
  status: Status;
  hold: PieceType | null;
  /** Index into the piece list of the next piece to play. */
  next: number;
  /** Garbage still waiting after the attacks sent so far. */
  danger: number;
  /** Sum of move scores along the way. */
  acc: number;
  total: number;
  /** Which first move this line of play started with. */
  root: number;
}

const DEAD = -1e9;

/** Places a piece on a copy of the board and scores the result. */
function expand(parent: SearchNode, p: Placement, hold: PieceType | null, next: number, level: BotLevel, root: number): SearchNode | null {
  if (locksOut(p.type, p)) return null;
  const board = parent.board.clone();
  board.place(p.type, p.x, p.y, p.rot);
  const move = scoreMove(board, p.type, p.spin, parent.status, level.weights);
  // Blocks in the spawn rows after clearing mean the next piece can't appear.
  const blocked = board.rows[SPAWN_Y - 1] !== 0 || board.rows[SPAWN_Y] !== 0;
  const danger = Math.max(0, parent.danger - move.attack);
  const acc = parent.acc + move.score;
  const overTop = board.rows.subarray(VISIBLE_HEIGHT, BOARD_HEIGHT).some((r) => r !== 0);
  const total = blocked ? DEAD : acc + evaluateBoard(board, move.status, level.weights, danger) + (overTop ? DEAD / 1000 : 0);
  return { board, status: move.status, hold, next, danger, acc, total, root };
}

/** The ways to play the next piece from a node: the queue piece, or swap with hold. */
function choices(node: SearchNode, pieces: PieceType[], level: BotLevel, holdLocked: boolean): { type: PieceType; hold: PieceType | null; next: number; held: boolean }[] {
  const out = [];
  const piece = pieces[node.next];
  if (!piece) return [];
  out.push({ type: piece, hold: node.hold, next: node.next + 1, held: false });
  if (level.useHold && !holdLocked) {
    if (node.hold && node.hold !== piece) out.push({ type: node.hold, hold: piece, next: node.next + 1, held: true });
    else if (!node.hold && pieces[node.next + 1]) out.push({ type: pieces[node.next + 1], hold: piece, next: node.next + 2, held: true });
  }
  return out;
}

/**
 * Placements for the deeper steps: straight drops, plus spinning a T into a
 * ready T-spin slot so the search can see the payoff of building one.
 */
function deepPlacements(board: BotBoard, type: PieceType, level: BotLevel): Placement[] {
  const drops = findDrops(board, type);
  if (type !== 'T' || level.weights.tSlot[2] <= 0) return drops;
  const slot = findTSlot(board, board.heights());
  if (slot) drops.push({ type, x: slot.cx - 1, y: slot.y + 2, rot: 2, spin: 'full', inputs: [] });
  return drops;
}

/** A random source for mistakes: returns a float in [0, 1). */
export type Random = () => number;

/**
 * Picks where to put the current piece: every reachable spot is tried, then a
 * beam search plays the preview pieces on the best boards and the first move
 * of the best line wins.
 */
export function think(snap: BotSnapshot, level: BotLevel, random: Random = Math.random): BotPlan | null {
  const board = new BotBoard(Uint16Array.from(snap.rows));
  const pieces = [snap.current, ...snap.queue];
  const start: SearchNode = {
    board, status: { b2b: snap.b2b, combo: snap.combo }, hold: snap.hold, next: 0,
    danger: snap.incoming, acc: 0, total: 0, root: -1,
  };

  // Depth 1: full move search, including spins and tucks.
  const roots: BotPlan[] = [];
  let layer: SearchNode[] = [];
  for (const c of choices(start, pieces, level, snap.holdUsed)) {
    const from = c.held ? { x: SPAWN_X[c.type], y: SPAWN_Y, rot: 0 as const } : snap.active;
    for (const p of findPlacements(board, c.type, from)) {
      const node = expand(start, p, c.hold, c.next, level, roots.length);
      if (!node) continue;
      roots.push({
        hold: c.held,
        start: from,
        target: { x: p.x, y: p.y, rot: p.rot, spin: p.spin },
        inputs: c.held ? ['hold', ...p.inputs] : p.inputs,
      });
      layer.push(node);
    }
  }
  if (roots.length === 0) return null;

  // Each first move is worth the best line of play that starts with it.
  const value = layer.map((n) => n.total);
  for (let depth = 1; depth < level.lookahead; depth++) {
    layer.sort((a, b) => b.total - a.total);
    const beam = layer.slice(0, level.beamWidth);
    const nextLayer: SearchNode[] = [];
    for (const node of beam) {
      for (const c of choices(node, pieces, level, false)) {
        for (const p of deepPlacements(node.board, c.type, level)) {
          const child = expand(node, p, c.hold, c.next, level, node.root);
          if (child) nextLayer.push(child);
        }
      }
    }
    if (nextLayer.length === 0) break;
    // Deeper results replace shallower ones for the roots that reached this depth.
    const reached = new Map<number, number>();
    for (const n of nextLayer) reached.set(n.root, Math.max(reached.get(n.root) ?? -Infinity, n.total));
    for (const [root, v] of reached) value[root] = v;
    // Roots that fell out of the beam can't beat ones that kept going.
    for (let i = 0; i < value.length; i++) if (!reached.has(i)) value[i] = Math.min(value[i], DEAD / 2);
    layer = nextLayer;
  }

  const order = value.map((_, i) => i).sort((a, b) => value[b] - value[a]);
  let pick = order[0];
  if (level.mistakeRate > 0 && order.length > 1 && random() < level.mistakeRate) {
    // A misdrop: one of the next few spots, but never one that loses outright.
    const options = order.slice(1, 1 + level.mistakeRange).filter((i) => value[i] > DEAD / 2);
    if (options.length > 0) pick = options[Math.floor(random() * options.length)];
  }
  return roots[pick];
}
