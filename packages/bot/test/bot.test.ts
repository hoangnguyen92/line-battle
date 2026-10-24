import { describe, expect, it } from 'vitest';
import { Game, Match, Rng, type GameEvent, type Key, type PieceType } from '@line-battle/engine';
import {
  BOT_HANDLING,
  BotBoard,
  BotController,
  evaluateBoard,
  findPlacements,
  LEVELS,
  SPAWN_X,
  SPAWN_Y,
  think,
  tSlotLines,
  DEFAULT_WEIGHTS,
  type BotSnapshot,
  type LevelId,
} from '../src';

/** A game whose board is set from strings (top row first) and whose current piece is `type`. */
function gameWith(rows: string[], type: PieceType): Game {
  const g = new Game({ seed: 1, entryDelay: 0, handling: BOT_HANDLING });
  g.board.cells.fill(0);
  rows.forEach((row, i) => [...row].forEach((ch, x) => ch !== '.' && g.board.set(x, rows.length - 1 - i, 8)));
  g.active = { type, x: SPAWN_X[type], y: SPAWN_Y, rot: 0 };
  return g;
}

function seeded(seed: number): () => number {
  const rng = new Rng(seed);
  return () => rng.next() / 2 ** 32;
}

/** Taps each key in turn on a real game, one tick apart, then hard drops. */
function play(game: Game, inputs: readonly Key[]): GameEvent[] {
  for (const key of [...inputs, 'hardDrop'] as Key[]) game.step([{ key, down: true }, { key, down: false }]);
  return game.drainEvents();
}

const TSD = [
  'XX........',
  'X...XXXXXX',
  'XX.XXXXXXX',
];

describe('move search', () => {
  it('finds every column and rotation on an empty board', () => {
    const board = new BotBoard();
    const spots = findPlacements(board, 'T', { x: 3, y: SPAWN_Y, rot: 0 });
    // 8 + 9 + 8 + 9 placements of a T on a flat floor.
    expect(spots.filter((s) => s.y === 1 || s.y === 2).length).toBe(34);
  });

  it('gives inputs that land the piece where it planned, in the real engine', () => {
    const rows = ['....XXX...', 'X......XX.', 'XX.XXX.XXX'];
    for (const type of ['I', 'J', 'L', 'O', 'S', 'T', 'Z'] as PieceType[]) {
      const board = BotBoard.parse(rows);
      for (const spot of findPlacements(board, type, { x: SPAWN_X[type], y: SPAWN_Y, rot: 0 })) {
        const g = gameWith(rows, type);
        const before = new BotBoard(BotBoard.from(g.board).rows.slice());
        before.place(type, spot.x, spot.y, spot.rot);
        play(g, spot.inputs);
        // Compare before any line clear: the locked cells must match the plan.
        const placed = BotBoard.from(g.board);
        const expected = before.clone();
        expected.clearLines();
        expect([...placed.rows], `${type} ${JSON.stringify(spot)}`).toEqual([...expected.rows]);
      }
    }
  });

  it('finds tucks under an overhang', () => {
    const rows = ['XXXX......', '..........'];
    const spots = findPlacements(BotBoard.parse(rows), 'I', { x: 3, y: SPAWN_Y, rot: 0 });
    expect(spots.some((s) => s.x === 0 && s.y === 1 && s.rot === 0)).toBe(true);
  });

  it('finds the T-spin double and the engine agrees it is one', () => {
    const board = BotBoard.parse(TSD);
    const spin = findPlacements(board, 'T', { x: 3, y: SPAWN_Y, rot: 0 }).find((s) => s.spin === 'full' && s.rot === 2);
    expect(spin).toBeDefined();
    const g = gameWith(TSD, 'T');
    const clear = play(g, spin!.inputs).find((e) => e.type === 'clear');
    expect(clear).toMatchObject({ info: { lines: 2, spin: 'full' } });
  });
});

describe('board scoring', () => {
  it('spots a T-spin double slot', () => {
    const board = BotBoard.parse(TSD);
    expect(tSlotLines(board, board.heights())).toBe(2);
    expect(tSlotLines(BotBoard.parse(['XXXXXXXX..']), BotBoard.parse(['XXXXXXXX..']).heights())).toBe(-1);
  });

  it('prefers a flat board to one with a hole', () => {
    const status = { b2b: -1, combo: -1 };
    const flat = evaluateBoard(BotBoard.parse(['XXXXXXXXX.']), status, DEFAULT_WEIGHTS);
    const holey = evaluateBoard(BotBoard.parse(['XXXXXXXXX.', 'XXXX.XXXX.']), status, DEFAULT_WEIGHTS);
    expect(flat).toBeGreaterThan(holey);
  });
});

describe('bot', () => {
  const snap = (rows: string[], current: PieceType, queue: PieceType[]): BotSnapshot => ({
    rows: [...BotBoard.parse(rows).rows], current, active: { x: SPAWN_X[current], y: SPAWN_Y, rot: 0 },
    hold: null, holdUsed: false, queue, b2b: -1, combo: -1, incoming: 0,
  });

  it('takes a QUAD when the well is ready', () => {
    const rows = ['XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.'];
    const plan = think(snap(rows, 'I', ['O', 'T', 'S', 'Z', 'L']), LEVELS[3])!;
    expect(plan.target).toMatchObject({ x: 7, rot: 1 });
  });

  it('spins into a T-spin slot', () => {
    const queue: PieceType[] = ['O', 'I', 'L', 'J', 'S'];
    expect(think(snap(TSD, 'T', queue), LEVELS[3])!.target.spin).toBe('full');
    expect(think(snap(TSD, 'T', queue), LEVELS[5])!.target.spin).toBe('full');
  });

  it('keeps each level close to its speed', () => {
    for (const id of [1, 3, 5] as LevelId[]) {
      const level = { ...LEVELS[id], mistakeRate: 0 };
      const g = new Game({ seed: 5, handling: BOT_HANDLING });
      const bot = new BotController(level, (s) => think(s, level));
      while (g.piecesPlaced < 40 && !g.over) g.step(bot.update(g));
      const pps = g.piecesPlaced / (g.tick / 60);
      expect(pps).toBeGreaterThan(level.pps * 0.9);
      expect(pps).toBeLessThan(level.pps * 1.1);
    }
  });

  it('survives a long solo game at level 3', () => {
    const g = new Game({ seed: 11, handling: BOT_HANDLING });
    const random = seeded(3);
    const bot = new BotController(LEVELS[3], (s) => think(s, LEVELS[3], random));
    while (g.piecesPlaced < 200 && !g.over) g.step(bot.update(g));
    expect(g.toppedOut).toBe(false);
    expect(g.lines).toBeGreaterThan(70);
  });

  it('plays the same with the same seed (async planner too)', async () => {
    const level = LEVELS[2];
    const run = async (async: boolean) => {
      const g = new Game({ seed: 4, handling: BOT_HANDLING });
      const random = seeded(9);
      const bot = new BotController(level, (s) => (async ? Promise.resolve(think(s, level, random)) : think(s, level, random)));
      while (g.piecesPlaced < 20 && !g.over) {
        g.step(bot.update(g));
        if (async) await Promise.resolve();
      }
      return [...g.board.cells].join('');
    };
    expect(await run(false)).toBe(await run(false));
    expect(await run(true)).toHaveLength(400);
  });

  it('level 3 beats level 1 (the phase 3 gate)', () => {
    let wins = 0;
    for (let i = 0; i < 3; i++) {
      const m = new Match({ seed: 100 + i, players: [{ handling: BOT_HANDLING }, { handling: BOT_HANDLING }] });
      const random = seeded(i + 1);
      const a = new BotController(LEVELS[3], (s) => think(s, LEVELS[3], random));
      const b = new BotController(LEVELS[1], (s) => think(s, LEVELS[1], random));
      while (!m.over && m.tick < 60 * 180) m.step([a.update(m.players[0]), b.update(m.players[1])]);
      if (m.result === 0) wins++;
    }
    expect(wins).toBe(3);
  }, 30000);
});
