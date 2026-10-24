import { describe, expect, it } from 'vitest';
import { Bag, Game, PIECE_TYPES, playReplay, Recorder, Rng, KEYS, type KeyEvent } from '../src';
import { newGame, press, release, setRows, stepN, tap } from './helpers';

describe('7-bag', () => {
  it('deals every piece once per bag of 7', () => {
    const bag = new Bag(42);
    for (let i = 0; i < 50; i++) expect([...bag.nextBag()].sort()).toEqual([...PIECE_TYPES].sort());
  });

  it('is the same for the same seed and differs across seeds', () => {
    const a = new Bag(7), b = new Bag(7), c = new Bag(8);
    const seqA = [a.nextBag(), a.nextBag()].flat().join('');
    expect([b.nextBag(), b.nextBag()].flat().join('')).toBe(seqA);
    expect([c.nextBag(), c.nextBag()].flat().join('')).not.toBe(seqA);
  });
});

describe('spawn, queue and hold', () => {
  it('shows a 5-piece preview and spawns above the visible field', () => {
    const g = newGame();
    expect(g.queue).toHaveLength(5);
    expect(g.pieceCells().every(([, y]) => y >= 20)).toBe(true);
  });

  it('holds once per piece', () => {
    const g = newGame();
    const first = g.active!.type;
    const next = g.queue[0];
    tap(g, 'hold');
    expect(g.hold).toBe(first);
    expect(g.active!.type).toBe(next);
    tap(g, 'hold');
    expect(g.hold).toBe(first);
    expect(g.active!.type).toBe(next);
    tap(g, 'hardDrop');
    tap(g, 'hold');
    expect(g.active!.type).toBe(first);
  });
});

describe('movement and handling', () => {
  it('moves one cell on a tap and slides to the wall after DAS with ARR 0', () => {
    const g = newGame({ handling: { das: 8, arr: 0, sdf: 6 } });
    const x0 = g.active!.x;
    g.step([press('left')]);
    expect(g.active!.x).toBe(x0 - 1);
    stepN(g, 6);
    expect(g.active!.x).toBe(x0 - 1);
    stepN(g, 2);
    const minX = Math.min(...g.pieceCells().map(([x]) => x));
    expect(minX).toBe(0);
  });

  it('repeats every ARR ticks after DAS', () => {
    const g = newGame({ handling: { das: 4, arr: 2, sdf: 6 } });
    const x0 = g.active!.x;
    g.step([press('right')]); // tick 0: +1
    stepN(g, 4); // DAS charged on the 4th tick: +1
    expect(g.active!.x).toBe(x0 + 2);
    stepN(g, 2); // one ARR step
    expect(g.active!.x).toBe(x0 + 3);
  });

  it('hard drop lands where the ghost shows', () => {
    const g = newGame();
    const landing = g.pieceCells(g.ghost());
    tap(g, 'hardDrop');
    expect(g.piecesPlaced).toBe(1);
    for (const [x, y] of landing) expect(g.board.get(x, y)).not.toBe(0);
  });

  it('instant soft drop (SDF 41) drops without locking', () => {
    const g = newGame({ handling: { das: 8, arr: 2, sdf: 41 } });
    g.step([press('softDrop')]);
    expect(g.active!.y).toBe(g.ghost()!.y);
    expect(g.piecesPlaced).toBe(0);
  });
});

describe('entry delay', () => {
  it('ignores presses between a hard drop and the next piece', () => {
    const g = newGame({ entryDelay: 6 });
    const next = g.queue[0];
    g.step([press('hardDrop'), release('hardDrop'), press('rotateCW'), press('hold')]);
    expect(g.active).toBeNull();
    g.step([release('rotateCW'), press('hardDrop')]);
    stepN(g, 4);
    expect(g.active).toBeNull();
    stepN(g, 1);
    expect(g.active).toMatchObject({ type: next, rot: 0 });
    expect(g.piecesPlaced).toBe(1);
    expect(g.hold).toBeNull();
  });

  it('makes a held direction charge DAS again for the new piece', () => {
    const g = newGame({ entryDelay: 6, handling: { das: 10, arr: 0, sdf: 6 } });
    g.step([press('left')]);
    g.step([press('hardDrop')]);
    stepN(g, 6, [release('hardDrop')]);
    const x0 = g.active!.x;
    stepN(g, 9);
    expect(g.active!.x).toBe(x0);
    stepN(g, 1);
    expect(Math.min(...g.pieceCells().map(([x]) => x))).toBe(0);
  });
});

describe('lock delay', () => {
  it('locks 30 ticks after touching the ground', () => {
    const g = newGame({ handling: { das: 8, arr: 2, sdf: 41 } });
    g.step([press('softDrop')]);
    stepN(g, 28);
    expect(g.piecesPlaced).toBe(0);
    stepN(g, 2);
    expect(g.piecesPlaced).toBe(1);
  });

  it('stops resetting after 15 moves on the ground', () => {
    const g = newGame({ handling: { das: 8, arr: 2, sdf: 41 } });
    g.active = { type: 'O', x: 4, y: g.active!.y, rot: 0 };
    g.step([press('softDrop')]);
    // Wiggle left and right for a long time: the piece must still lock.
    for (let i = 0; i < 40 && g.piecesPlaced === 0; i++) {
      tap(g, i % 2 === 0 ? 'left' : 'right');
    }
    expect(g.piecesPlaced).toBe(1);
  });
});

describe('line clears and spins', () => {
  it('clears full rows and reports a quad', () => {
    const g = newGame();
    setRows(g, ['XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.']);
    g.active = { type: 'I', x: 7, y: 21, rot: 1 }; // vertical I in column 9
    g.drainEvents();
    tap(g, 'hardDrop');
    const clear = g.drainEvents().find((e) => e.type === 'clear');
    expect(g.lines).toBe(4);
    expect(clear).toMatchObject({ type: 'clear', info: { lines: 4, perfectClear: true, spin: 'none' } });
  });

  it('detects a T-spin double with the 3-corner rule', () => {
    const g = newGame();
    setRows(g, ['XXXX..XXXX', 'XXX...XXXX', 'XXXX.XXXXX']);
    g.active = { type: 'T', x: 3, y: 2, rot: 1 };
    g.drainEvents();
    tap(g, 'rotateCW');
    tap(g, 'hardDrop');
    const clear = g.drainEvents().find((e) => e.type === 'clear');
    expect(clear).toMatchObject({ type: 'clear', info: { lines: 2, spin: 'full', piece: 'T' } });
  });

  it('kicks a T off the wall with SRS', () => {
    const g = newGame();
    g.active = { type: 'T', x: -1, y: 10, rot: 1 }; // pressed against the left wall
    expect(g.pieceCells().every(([x]) => x >= 0)).toBe(true);
    tap(g, 'rotateCW');
    expect(g.active!.rot).toBe(2);
    expect(g.pieceCells().every(([x]) => x >= 0)).toBe(true);
  });

  it('tracks combo and back-to-back', () => {
    const g = newGame();
    setRows(g, ['XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.']);
    g.active = { type: 'I', x: 7, y: 21, rot: 1 };
    tap(g, 'hardDrop');
    g.active = { type: 'I', x: 7, y: 21, rot: 1 };
    g.drainEvents();
    tap(g, 'hardDrop');
    const clear = g.drainEvents().find((e) => e.type === 'clear');
    expect(clear).toMatchObject({ info: { lines: 4, b2b: 1, combo: 1, perfectClear: true } });
  });
});

describe('game end', () => {
  it('finishes a sprint at the goal', () => {
    const g = newGame({ goalLines: 4 });
    setRows(g, ['XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.']);
    g.active = { type: 'I', x: 7, y: 21, rot: 1 };
    tap(g, 'hardDrop');
    expect(g.finished).toBe(true);
    expect(g.over).toBe(true);
  });

  it('tops out when stacking in one column', () => {
    const g = newGame();
    for (let i = 0; i < 100 && !g.over; i++) tap(g, 'hardDrop');
    expect(g.toppedOut).toBe(true);
  });
});

describe('determinism', () => {
  function randomInputs(seed: number, ticks: number): KeyEvent[][] {
    const rng = new Rng(seed);
    const held = new Set<string>();
    const out: KeyEvent[][] = [];
    for (let t = 0; t < ticks; t++) {
      const batch: KeyEvent[] = [];
      if (rng.int(4) === 0) {
        const key = KEYS[rng.int(KEYS.length)];
        const down = !held.has(key);
        down ? held.add(key) : held.delete(key);
        batch.push({ key, down });
      }
      out.push(batch);
    }
    return out;
  }

  it('same seed and inputs give the same game, and replays reproduce it', () => {
    const inputs = randomInputs(99, 5000);
    const config = { seed: 1234 }; // default entry delay, so replays cover it
    const a = new Game(config);
    const b = new Game(config);
    const rec = new Recorder(config);
    for (const batch of inputs) {
      if (a.over) break;
      for (const e of batch) rec.record(a.tick, e.key, e.down);
      a.step(batch);
      b.step(batch);
    }
    expect(a.piecesPlaced).toBeGreaterThan(20);
    expect(Array.from(b.board.cells)).toEqual(Array.from(a.board.cells));
    const c = playReplay(rec.finish(a.tick));
    expect(Array.from(c.board.cells)).toEqual(Array.from(a.board.cells));
    expect(c.lines).toBe(a.lines);
    expect(c.piecesPlaced).toBe(a.piecesPlaced);
  });
});
