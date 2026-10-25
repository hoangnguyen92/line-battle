import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, type ClearInfo, type GameEvent } from '@line-battle/engine';
import { Tutorial } from '../src/tutorial';

const lock: GameEvent = { type: 'lock', piece: 'T', tick: 1 };
const clear = (lines: number): GameEvent => ({
  type: 'clear',
  info: { piece: 'I', lines, spin: 'none', perfectClear: false, b2b: 0, combo: 0, attack: 0, tick: 1 } satisfies ClearInfo,
});

describe('tutorial', () => {
  it('moves through the lessons as each thing happens', () => {
    const t = new Tutorial();
    expect(t.text(DEFAULT_KEYS)).toContain('←');
    expect(t.update(['left'], [])).toBeNull();
    expect(t.update(['right'], [])).toBe('done');
    expect(t.update(['rotateCW', 'rotateCCW'], [])).toBe('done');
    // A hard drop only counts once the piece locks.
    expect(t.update(['hardDrop'], [])).toBeNull();
    expect(t.update([], [lock])).toBe('done');
    expect(t.update([], [{ type: 'hold', piece: 'S' }])).toBe('done');
    // The line lesson starts with a row that has one gap on the right.
    expect(t.game.board.get(0, 0)).toBe(8);
    expect(t.game.board.get(9, 0)).toBe(0);
    expect(t.update([], [lock, clear(1)])).toBe('done');
    expect(t.update([], [lock, clear(2)])).toBeNull();
    expect(t.update([], [lock, clear(4)])).toBe('done');
    expect(t.finished).toBe(true);
  });

  it('sets the board up again when the gap gets covered', () => {
    const t = new Tutorial(4);
    t.game.board.set(9, 2, 6);
    expect(t.update([], [lock])).toBe('retry');
    expect(t.game.board.get(9, 2)).toBe(0);
    expect(t.lesson).toBe(4);
  });
});
