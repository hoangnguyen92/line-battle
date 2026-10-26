import { describe, expect, it } from 'vitest';
import { BOT_HANDLING, BotController, LEVELS, think, type LevelId } from '@line-battle/bot';
import { DEFAULT_HANDLING, OnlinePlayer, Rng, StreamPlayer, type GarbageMsg, type InputBatch, type RelayBatch } from '@line-battle/engine';
import { ACK_WINDOW_TICKS, LEAD_SLACK_TICKS, RoundReferee } from '../src';

const cells = (g: { board: { cells: ArrayLike<number> } }) => Array.from(g.board.cells).join('');

function seeded(seed: number): () => number {
  const rng = new Rng(seed);
  return () => rng.next() / 2 ** 32;
}

/** A message in flight, delivered `latency` ticks after it was sent. */
interface Flight<T> {
  at: number;
  msg: T;
}

/**
 * Plays a whole online round between two bots through the referee, with
 * messages delayed both ways like a real network. Returns everything needed
 * to compare the clients' boards with the server's.
 */
function playOnline(levels: [LevelId, LevelId], latency: [number, number], seed = 7, maxTicks = 60 * 120) {
  const ref = new RoundReferee(seed, [BOT_HANDLING, BOT_HANDLING]);
  const players = [new OnlinePlayer(seed, BOT_HANDLING, 0), new OnlinePlayer(seed, BOT_HANDLING, 1)] as const;
  const mirrors = [new StreamPlayer(seed, BOT_HANDLING, 0), new StreamPlayer(seed, BOT_HANDLING, 1)] as const;
  const bots = levels.map((l, i) => {
    const level = { ...LEVELS[l], mistakeRate: 0 };
    const random = seeded(i + 1);
    return new BotController(level, (s) => think(s, level, random));
  });
  const up: Flight<InputBatch>[][] = [[], []];
  const down: Flight<{ garbage?: GarbageMsg; opp?: RelayBatch }>[][] = [[], []];
  let toppedOut: number | null = null;
  let garbageSent = 0;
  /** Each client's board after every tick, to compare with the server's copy later. */
  const history = [new Map<number, string>(), new Map<number, string>()];

  for (let t = 0; t < maxTicks && toppedOut === null; t++) {
    for (const p of [0, 1] as const) {
      // Deliver what the server sent this player by now.
      while (down[p].length && down[p][0].at <= t) {
        const { msg } = down[p].shift()!;
        if (msg.garbage) players[p].receive(msg.garbage);
        if (msg.opp) mirrors[1 - p].push(msg.opp);
      }
      const g = players[p].game;
      players[p].step(bots[p].update(g));
      history[p].set(g.tick, cells(g));
      if (t % 3 === 2) up[p].push({ at: t + latency[p], msg: players[p].takeBatch() });
    }
    for (const p of [0, 1] as const) {
      while (up[p].length && up[p][0].at <= t) {
        const res = ref.applyBatch(p, up[p].shift()!.msg, t);
        if (!res.ok) throw new Error(`player ${p}: ${res.reason}`);
        const opp = 1 - p;
        down[opp].push({ at: t + latency[opp], msg: { opp: res.relay } });
        for (const garbage of res.sent) {
          garbageSent += garbage.lines;
          down[opp].push({ at: t + latency[opp], msg: { garbage } });
        }
        if (res.toppedOut) toppedOut = p;
      }
    }
  }
  return { ref, players, mirrors, toppedOut, garbageSent, history };
}


describe('online referee', () => {
  it("rebuilds both boards exactly from the clients' inputs, with network delay", () => {
    const { ref, players, toppedOut, garbageSent, history } = playOnline([5, 2], [6, 9]);
    expect(garbageSent).toBeGreaterThan(10);
    // The weaker bot loses, and the server saw the same boards the clients played.
    expect(toppedOut).toBe(1);
    expect(players[1].game.toppedOut).toBe(true);
    for (const p of [0, 1] as const) {
      const server = ref.game(p);
      expect(server.piecesPlaced).toBeGreaterThan(8);
      // The client may be a few ticks ahead; compare at the tick where the server stopped.
      expect(history[p].get(server.tick)).toBe(cells(server));
    }
    expect(ref.game(1).garbageReceived).toBeGreaterThan(0);
  }, 30_000);

  it("drives the opponent's view from relayed inputs", () => {
    const { ref, mirrors } = playOnline([3, 3], [3, 3], 21, 60 * 30);
    for (const p of [0, 1] as const) {
      const mirror = mirrors[p].game;
      const server = ref.game(p);
      // The mirror lags the server by the relay delay; replay the server's log to its tick.
      const atMirror = new StreamPlayer(ref.seed, BOT_HANDLING, p);
      const log = ref.log(p);
      atMirror.push({ upTo: mirror.tick, keys: log.keys.filter((k) => k[0] < mirror.tick), acks: log.acks.filter((a) => a[0] < mirror.tick) });
      expect(mirror.tick).toBeGreaterThan(server.tick - 20);
      expect(cells(mirror)).toBe(cells(atMirror.game));
    }
  }, 30_000);

  it('rebuilds a board from the log after a reconnect', () => {
    const { ref } = playOnline([3, 3], [2, 2], 3, 60 * 20);
    const rebuilt = new OnlinePlayer(ref.seed, BOT_HANDLING, 0, ref.log(0));
    expect(rebuilt.game.tick).toBe(ref.game(0).tick);
    expect(cells(rebuilt.game)).toBe(cells(ref.game(0)));
    expect(rebuilt.game.queue).toEqual(ref.game(0).queue);
    // The next batch carries on from where the server is.
    rebuilt.step([]);
    expect(ref.applyBatch(0, rebuilt.takeBatch(), ref.game(0).tick + 1).ok).toBe(true);
  }, 30_000);
});

describe('referee rejects', () => {
  const fresh = () => new RoundReferee(1, [DEFAULT_HANDLING, DEFAULT_HANDLING]);
  const batch = (upTo: number, keys: InputBatch['keys'] = [], acks: InputBatch['acks'] = []): InputBatch => ({ upTo, keys, acks });

  it('a client running ahead of the clock', () => {
    const ref = fresh();
    expect(ref.applyBatch(0, batch(LEAD_SLACK_TICKS + 10), 0)).toEqual({ ok: false, reason: 'running faster than real time' });
    expect(fresh().applyBatch(0, batch(LEAD_SLACK_TICKS + 10), 10).ok).toBe(true);
  });

  it('malformed or out-of-order inputs', () => {
    expect(fresh().applyBatch(0, null, 100).ok).toBe(false);
    expect(fresh().applyBatch(0, { upTo: 5, keys: 'x', acks: [] }, 100).ok).toBe(false);
    expect(fresh().applyBatch(0, batch(10, [[5, 0, 1], [2, 0, 0]]), 100).ok).toBe(false);
    expect(fresh().applyBatch(0, batch(10, [[3, 99, 1]]), 100).ok).toBe(false);
    expect(fresh().applyBatch(0, batch(10, [[10, 0, 1]]), 100).ok).toBe(false);
    const ref = fresh();
    expect(ref.applyBatch(0, batch(10), 100).ok).toBe(true);
    expect(ref.applyBatch(0, batch(5), 100)).toEqual({ ok: false, reason: 'batch goes back in time' });
  });

  it('garbage that was never sent', () => {
    expect(fresh().applyBatch(0, batch(10, [], [[2, 1]]), 100)).toEqual({ ok: false, reason: 'unknown garbage' });
  });

  /** A referee where player 0's first hard drop clears a QUAD, sending 4 lines to player 1. */
  function quadReady(): RoundReferee {
    const ref = fresh();
    const g = ref.game(0);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 9; x++) g.board.set(x, y, 8);
    g.board.set(0, 4, 8); // so it is not a perfect clear
    g.active = { type: 'I', x: 7, y: 10, rot: 1 };
    const res = ref.applyBatch(0, batch(1, [[0, 3, 1]]), 100);
    expect(res.ok && res.sent).toEqual([{ id: 1, lines: 4 }]);
    return ref;
  }

  it('garbage held back too long', () => {
    const ok = quadReady();
    expect(ok.pending(1)).toEqual([{ id: 1, lines: 4 }]);
    // Letting it in within the window is fine...
    expect(ok.applyBatch(1, batch(50, [], [[40, 1]]), 100).ok).toBe(true);
    expect(ok.game(1).incomingLines).toBe(4);
    expect(ok.pending(1)).toEqual([]);
    // ...ignoring it is not.
    expect(quadReady().applyBatch(1, batch(100 + ACK_WINDOW_TICKS + 5), 1000)).toEqual({ ok: false, reason: 'garbage was not let in' });
  });
});
