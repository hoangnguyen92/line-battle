import { describe, expect, it } from 'vitest';
import { attackFor, comboBonus, GARBAGE_CELL, KEYS, Match, MatchRecorder, playMatchReplay, Rng, type GameEvent, type MatchConfig, type KeyEvent } from '../src';
import { newGame, setRows, stepN, tap } from './helpers';

const clear = (lines: number, extra: Partial<Parameters<typeof attackFor>[0]> = {}) =>
  attackFor({ lines, spin: 'none', b2b: 0, combo: 0, perfectClear: false, ...extra }).total;

/** Drops a vertical I into column 9. */
function dropI(game: ReturnType<typeof newGame>): void {
  game.active = { type: 'I', x: 7, y: 21, rot: 1 };
  tap(game, 'hardDrop');
}

/** The hole column of each of the bottom `rows` rows, checking each is a garbage row with one hole. */
function garbageHoles(game: ReturnType<typeof newGame>, rows: number): number[] {
  return [...Array(rows).keys()].map((y) => {
    const row = [...Array(10).keys()].map((x) => game.board.get(x, y));
    expect(row.filter((v) => v === GARBAGE_CELL)).toHaveLength(9);
    return row.indexOf(0);
  });
}

const WELL = 'XXXXXXXXX.';
const attacks = (events: GameEvent[]) => events.flatMap((e) => (e.type === 'attack' ? [e.info] : []));

describe('attack table', () => {
  it('sends the base lines for each clear', () => {
    expect([1, 2, 3, 4].map((n) => clear(n))).toEqual([0, 1, 2, 4]);
    expect([1, 2, 3].map((n) => clear(n, { spin: 'full' }))).toEqual([2, 4, 6]);
    expect(clear(1, { spin: 'mini' })).toBe(0);
    expect(clear(0, { spin: 'full' })).toBe(0);
  });

  it('adds back-to-back, combo and perfect clear bonuses', () => {
    expect(clear(4, { b2b: 1 })).toBe(5);
    expect(clear(4, { b2b: 3 })).toBe(5);
    expect(clear(2, { spin: 'full', b2b: 2, combo: 3 })).toBe(4 + 1 + 2);
    expect(clear(4, { perfectClear: true })).toBe(14);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 20].map(comboBonus)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('reports the attack on the clear event', () => {
    const g = newGame();
    setRows(g, ['XXXXXXXX..', WELL, WELL, WELL, WELL]);
    g.drainEvents();
    dropI(g);
    const events = g.drainEvents();
    expect(events.find((e) => e.type === 'clear')).toMatchObject({ info: { lines: 4, attack: 4 } });
    expect(attacks(events)).toEqual([{ raw: 4, cancelled: 0, sent: 4, tick: expect.any(Number) }]);
    expect(g.attackSent).toBe(4);
  });
});

describe('garbage queue', () => {
  it('waits for the delay, then rises on a lock that clears nothing', () => {
    const g = newGame();
    g.receiveGarbage(3);
    tap(g, 'hardDrop'); // before the delay: nothing rises
    expect(g.garbageReceived).toBe(0);
    expect(g.incomingLines).toBe(3);
    stepN(g, 20);
    tap(g, 'hardDrop');
    expect(g.garbageReceived).toBe(3);
    expect(g.incomingLines).toBe(0);
    // Three garbage rows at the bottom, each with one hole.
    expect(garbageHoles(g, 3)).toHaveLength(3);
  });

  it('gives each line its own random hole', () => {
    const g = newGame();
    g.receiveGarbage(8);
    stepN(g, 20);
    tap(g, 'hardDrop');
    expect(new Set(garbageHoles(g, 8)).size).toBeGreaterThan(1);
  });

  it('lines up the holes of one attack in perAttack mode', () => {
    const g = newGame({ garbageHoles: 'perAttack' });
    g.receiveGarbage(3);
    stepN(g, 20);
    tap(g, 'hardDrop');
    expect(new Set(garbageHoles(g, 3)).size).toBe(1);
  });

  it('cancels incoming garbage before sending', () => {
    const g = newGame();
    g.receiveGarbage(6);
    setRows(g, ['XXXXXXXX..', WELL, WELL, WELL, WELL]);
    g.drainEvents();
    dropI(g);
    expect(attacks(g.drainEvents())).toMatchObject([{ raw: 4, cancelled: 4, sent: 0 }]);
    expect(g.incomingLines).toBe(2);
    expect(g.attackSent).toBe(0);
  });

  it('sends what is left after cancelling everything', () => {
    const g = newGame();
    g.receiveGarbage(1);
    g.receiveGarbage(1);
    setRows(g, ['XXXXXXXX..', WELL, WELL, WELL, WELL]);
    g.drainEvents();
    dropI(g);
    expect(attacks(g.drainEvents())).toMatchObject([{ raw: 4, cancelled: 2, sent: 2 }]);
    expect(g.incoming).toHaveLength(0);
  });

  it('does not rise while the player keeps clearing', () => {
    const g = newGame();
    g.receiveGarbage(10);
    stepN(g, 25);
    setRows(g, ['XXXXXXXX..', WELL, WELL, WELL, WELL, WELL, WELL, WELL, WELL]);
    dropI(g); // quad: cancels 4
    expect(g.garbageReceived).toBe(0);
    expect(g.incomingLines).toBe(6);
  });

  it('raises at most 8 lines per lock', () => {
    const g = newGame();
    g.receiveGarbage(12);
    stepN(g, 20);
    tap(g, 'hardDrop');
    expect(g.garbageReceived).toBe(8);
    tap(g, 'hardDrop');
    expect(g.garbageReceived).toBe(12);
  });

  it('in perAttack mode, sometimes moves the hole between attacks', () => {
    const g = newGame({ garbageHoles: 'perAttack', garbageMessiness: 100 });
    g.receiveGarbage(2);
    g.receiveGarbage(2);
    expect(g.incoming[0].hole).not.toBe(g.incoming[1].hole);
    const calm = newGame({ garbageHoles: 'perAttack', garbageMessiness: 0 });
    for (let i = 0; i < 5; i++) calm.receiveGarbage(1);
    expect(new Set(calm.incoming.map((x) => x.hole)).size).toBe(1);
  });

  it('tops out when garbage pushes blocks off the top', () => {
    const g = newGame({ garbageCap: 40 });
    g.board.set(0, 39, 1);
    g.receiveGarbage(1);
    stepN(g, 20);
    tap(g, 'hardDrop');
    expect(g.toppedOut).toBe(true);
  });
});

describe('match', () => {
  it('routes attacks to the opponent after the delay', () => {
    const m = new Match({ seed: 5, players: [{ entryDelay: 0 }, { entryDelay: 0 }] });
    const [a, b] = m.players;
    setRows(a, ['XXXXXXXX..', WELL, WELL, WELL, WELL]);
    a.active = { type: 'I', x: 7, y: 21, rot: 1 };
    m.step([[{ key: 'hardDrop', down: true }], []]);
    expect(b.incomingLines).toBe(4);
    expect(m.drainEvents()[0].some((e) => e.type === 'attack')).toBe(true);
    for (let i = 0; i < 20; i++) m.step();
    m.step([[], [{ key: 'hardDrop', down: true }]]);
    expect(b.garbageReceived).toBe(4);
  });

  it('ends when a player tops out', () => {
    const m = new Match({ seed: 5, players: [{ entryDelay: 0 }, { entryDelay: 0 }] });
    for (let i = 0; i < 200 && !m.over; i++) {
      m.step([[{ key: 'hardDrop', down: i % 2 === 0 }], []]);
    }
    expect(m.result).toBe(1);
  });

  it('gives each player the same pieces but their own garbage holes', () => {
    const holesOf = (config: MatchConfig) => {
      const m = new Match(config);
      expect(m.players[0].queue).toEqual(m.players[1].queue);
      return m.players.map((g) => {
        for (let i = 0; i < 4; i++) g.receiveGarbage(2);
        stepN(g, 20);
        tap(g, 'hardDrop');
        return garbageHoles(g, 8).join();
      });
    };
    const players: MatchConfig['players'] = [{ entryDelay: 0 }, { entryDelay: 0 }];
    const [a, b] = holesOf({ seed: 9, players });
    expect(a).not.toBe(b);
    // Version 1 replays were recorded with both boards sharing holes.
    const [c, d] = holesOf({ seed: 9, players, sharedGarbage: true });
    expect(c).toBe(d);
  });

  it('replays a round exactly', () => {
    const rng = new Rng(3);
    const config = { seed: 77 };
    const live = new Match(config);
    const rec = new MatchRecorder(config);
    const held = [new Set<string>(), new Set<string>()];
    for (let t = 0; t < 6000 && !live.over; t++) {
      const batch: [KeyEvent[], KeyEvent[]] = [[], []];
      for (const p of [0, 1] as const) {
        if (rng.int(3) !== 0) continue;
        const key = KEYS[rng.int(KEYS.length)];
        const down = !held[p].has(key);
        down ? held[p].add(key) : held[p].delete(key);
        batch[p].push({ key, down });
        rec.record(p, live.tick, { key, down });
      }
      live.step(batch);
    }
    const again = playMatchReplay(rec.finish(live.tick));
    expect(again.result).toBe(live.result);
    for (const p of [0, 1]) {
      expect(Array.from(again.players[p].board.cells)).toEqual(Array.from(live.players[p].board.cells));
      expect(again.players[p].attackSent).toBe(live.players[p].attackSent);
    }
  });
});
