import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import {
  BATTLE_ROOM,
  DEFAULT_HANDLING,
  DEFAULT_LOOK,
  OnlinePlayer,
  playOnlineRound,
  QUEUE_ROOM,
  TICK_RATE,
  type JoinOptions,
  type KeyEvent,
  type QueueJoinOptions,
  type QueueMessages,
  type Region,
  type ServerMessages,
} from '@line-battle/engine';
import { BattleRoom, DEFAULT_MAX_PLAYERS, playersInMatches, QueueRoom, setMaxPlayers, setStore, Store } from '../src';
import { newToken } from '../src/passwords';

let server: Server;
let url = '';
let store: Store;

beforeAll(async () => {
  const http = createServer();
  server = new Server({ transport: new WebSocketTransport({ server: http }), greet: false, gracefullyShutdown: false });
  store = new Store(':memory:');
  setStore(store);
  server.define(BATTLE_ROOM, BattleRoom, { countdownMs: 50, roundBreakMs: 50 });
  server.define(QUEUE_ROOM, QueueRoom, { pairEveryMs: 100, anyRegionAfterMs: 1500, anyDeviceAfterMs: 1500 });
  await server.listen(0);
  url = `ws://localhost:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
  setStore(null);
  store.close();
});

/** An account with a session, straight in the store. */
function account(name: string, rating = 1500): string {
  const user = store.createUser(name, 'scrypt$x$y', 'asia')!;
  store.db.prepare('UPDATE users SET rating = ? WHERE id = ?').run(rating, user.id);
  const token = newToken();
  store.createSession(user.id, token);
  return token;
}

interface Queued {
  queue: Room;
  status: QueueMessages['searching'][];
  /** Resolves with the player in the match room once the queue finds an opponent. */
  matched: Promise<Player>;
}

async function enqueue(queue: QueueJoinOptions['queue'], name: string, region: Region = 'asia', token?: string, touch = false): Promise<Queued> {
  const client = new Client(url);
  if (token) client.auth.token = token;
  const room = await client.joinOrCreate(QUEUE_ROOM, { queue, region, name, handling: DEFAULT_HANDLING, look: DEFAULT_LOOK, touch } satisfies QueueJoinOptions);
  const status: QueueMessages['searching'][] = [];
  room.onMessage('searching', (m: QueueMessages['searching']) => status.push(m));
  const matched = new Promise<Player>((resolve, reject) => {
    room.onMessage('matched', async ({ reservation }: QueueMessages['matched']) => {
      try {
        // Listen straight away: the match room's first messages follow the join at once.
        const player = new Player(await client.consumeSeatReservation(reservation as never), () => []);
        void room.leave();
        resolve(player);
      } catch (e) {
        reject(e);
      }
    });
  });
  return { queue: room, status, matched };
}

const hardDrops = (t: number): KeyEvent[] => (t % 4 === 0 ? [{ key: 'hardDrop', down: true }, { key: 'hardDrop', down: false }] : []);

type Got = { [K in keyof ServerMessages]?: ServerMessages[K][] };

/** A test player: records every message and, once a round starts, plays in real time. */
class Player {
  got: Got = {};
  local: OnlinePlayer | null = null;
  connected = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly room: Room,
    /** Inputs for each tick; the default hard drops every few ticks to top out fast. */
    public policy: (tick: number) => KeyEvent[] = hardDrops,
  ) {
    room.reconnection.minUptime = 0;
    room.onDrop(() => (this.connected = false));
    room.onReconnect(() => (this.connected = true));
    for (const type of ['waiting', 'match', 'round', 'garbage', 'opp', 'resync', 'oppStatus', 'roundEnd', 'matchEnd', 'rematch', 'rating', 'gems', 'saved'] as const) {
      room.onMessage(type, (msg: never) => {
        (this.got[type] ??= [] as never[]).push(msg);
        if (type === 'round') this.startRound(msg as ServerMessages['round']);
        if (type === 'garbage') this.local?.receive(msg as ServerMessages['garbage']);
        if (type === 'resync') this.resync(msg as ServerMessages['resync']);
        if (type === 'roundEnd' || type === 'matchEnd') this.stop();
      });
    }
  }

  private startRound(r: ServerMessages['round']): void {
    this.stop();
    const local = new OnlinePlayer(r.seed, DEFAULT_HANDLING, this.got.match!.at(-1)!.you);
    this.local = local;
    const start = Date.now() + r.countdownMs;
    this.timer = setInterval(() => {
      const target = Math.floor(((Date.now() - start) * TICK_RATE) / 1000);
      while (local.game.tick < target && !local.game.over) local.step(this.policy(local.game.tick));
      if (target >= 0 && this.connected) this.room.send('inputs', local.takeBatch());
    }, 50);
  }

  private resync(r: ServerMessages['resync']): void {
    const you = this.got.match!.at(-1)!.you;
    this.local!.resendFrom(r.logs[you].upTo);
    for (const g of r.pending) this.local!.receive(g);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async waitFor<K extends keyof ServerMessages>(type: K, count = 1, ms = 15_000): Promise<ServerMessages[K][]> {
    const until = Date.now() + ms;
    while ((this.got[type]?.length ?? 0) < count) {
      if (Date.now() > until) throw new Error(`timed out waiting for ${type}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.got[type] as ServerMessages[K][];
  }
}

const opts = (mode: JoinOptions['mode'], name: string): JoinOptions => ({ mode, name, handling: DEFAULT_HANDLING, look: { character: name === 'Host' ? 'mochi' : 'bao', skin: name === 'Host' ? 'flat' : 'neon' } });

describe('battle room', () => {
  it('runs a private room match to the end, first to 2', async () => {
    const hostRoom = await new Client(url).create(BATTLE_ROOM, opts('private', 'Host'));
    const host = new Player(hostRoom);
    const [{ code }] = await host.waitFor('waiting');
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    expect(hostRoom.roomId).toBe(code);

    // The host hard drops nonstop and the guest waits, so the host tops out in both rounds.
    const guest = new Player(await new Client(url).joinById(code!, opts('private', 'Guest <b>')), () => []);
    const [match] = await guest.waitFor('match');
    expect(match.you).toBe(1);
    expect(match.names).toEqual(['Host', 'Guest b']);
    // The guest hasn't bought neon, so the opponent sees the default skin.
    expect(match.looks).toEqual([{ character: 'mochi', skin: 'flat' }, { character: 'bao', skin: 'gem' }]);

    const [end] = await host.waitFor('matchEnd');
    expect(end).toEqual({ winner: 1, score: [0, 2], reason: 'topOut' });
    expect(host.got.roundEnd).toEqual([{ winner: 1, score: [0, 1], reason: 'topOut' }]);
    // The guest saw the host's board through relayed inputs.
    expect(guest.got.opp!.length).toBeGreaterThan(3);
    await Promise.all([hostRoom.leave(), guest.room.leave()]);
  }, 30_000);

  it('quick match pairs two players through the queue and keeps private rooms out', async () => {
    const priv = new Player(await new Client(url).create(BATTLE_ROOM, opts('private', 'Lonely'))).room;
    const qa = await enqueue('quick', 'A');
    const qb = await enqueue('quick', 'B');
    const [a, b] = await Promise.all([qa.matched, qb.matched]);
    expect(a.room.roomId).toBe(b.room.roomId);
    expect(a.room.roomId).not.toBe(priv.roomId);
    const [m] = await b.waitFor('match');
    expect(m).toMatchObject({ mode: 'quick', ratings: null, canRematch: true });
    expect([...m.names].sort()).toEqual(['A', 'B']);
    await b.waitFor('round');
    // A leaving mid-match hands B the win.
    await a.room.leave();
    const [end] = await b.waitFor('matchEnd');
    expect(end.winner).toBe(1);
    expect(end.reason).toBe('left');
    await Promise.all([b.room.leave(), priv.leave()]);
  }, 30_000);

  it('a queued match room only takes its reserved seats', async () => {
    const qa = await enqueue('quick', 'Seat1');
    const qb = await enqueue('quick', 'Seat2');
    const [a, b] = await Promise.all([qa.matched, qb.matched]);
    await expect(new Client(url).joinById(a.room.roomId, opts('private', 'Gatecrash'))).rejects.toThrow();
    await Promise.all([a.room.leave(), b.room.leave()]);
  });

  it('pairs within a region first, then across regions after a wait', async () => {
    const a = await enqueue('quick', 'Hanoi', 'asia');
    const b = await enqueue('quick', 'Paris', 'europe');
    const c = await enqueue('quick', 'Tokyo', 'asia');
    const [ra, rc] = await Promise.all([a.matched, c.matched]);
    expect(ra.room.roomId).toBe(rc.room.roomId);
    expect(b.status[0]?.anyRegion).toBe(false);
    // Paris waits; once both have waited long enough, a player in another region will do.
    const d = await enqueue('quick', 'Sydney', 'oceania');
    const [rb, rd] = await Promise.all([b.matched, d.matched]);
    expect(rb.room.roomId).toBe(rd.room.roomId);
    await Promise.all([ra, rb, rc, rd].map((r) => r.room.leave()));
  }, 30_000);

  it('pairs phone players together first and tells each side who is on touch', async () => {
    const keys = await enqueue('quick', 'Keys');
    const phone = await enqueue('quick', 'Phone1', 'asia', undefined, true);
    const phone2 = await enqueue('quick', 'Phone2', 'asia', undefined, true);
    const [r1, r2] = await Promise.all([phone.matched, phone2.matched]);
    expect(r1.room.roomId).toBe(r2.room.roomId);
    const [m] = await r1.waitFor('match');
    expect(m.touch).toEqual([true, true]);
    // The keyboard player waits; after the wait a phone player will do.
    const phone3 = await enqueue('quick', 'Phone3', 'asia', undefined, true);
    const [rk, r3] = await Promise.all([keys.matched, phone3.matched]);
    expect(rk.room.roomId).toBe(r3.room.roomId);
    const [mk] = await rk.waitFor('match');
    expect([...mk.touch!].sort()).toEqual([false, true]);
    await Promise.all([r1, r2, rk, r3].map((r) => r.room.leave()));
  }, 30_000);

  it('ranked needs an account and keeps far-apart ratings apart at first', async () => {
    await expect(enqueue('ranked', 'Guest')).rejects.toThrow(/log in/i);
    const low = await enqueue('ranked', '', 'asia', account('Lowly', 1500));
    const high = await enqueue('ranked', '', 'asia', account('Mighty', 2400));
    let matched = false;
    void low.matched.then(() => (matched = true));
    await new Promise((r) => setTimeout(r, 800));
    expect(low.status[0]).toMatchObject({ rating: 1500, range: 100 });
    // Still waiting: 900 points apart is far outside the range.
    expect(matched).toBe(false);
    await Promise.all([low.queue.leave(), high.queue.leave()]);
  });

  it('a ranked match moves both ratings and saves a replay that plays back', async () => {
    const qa = await enqueue('ranked', '', 'asia', account('Ranker'));
    const qb = await enqueue('ranked', '', 'asia', account('Rival'));
    const players = await Promise.all([qa.matched, qb.matched]);
    await Promise.all(players.map((p) => p.waitFor('match')));
    // Whoever sits first hard drops nonstop and loses both rounds.
    const loser = players.find((p) => p.got.match![0].you === 0)!;
    const winner = players.find((p) => p !== loser)!;
    loser.policy = hardDrops;
    const m = loser.got.match![0];
    expect(m).toMatchObject({ mode: 'ranked', canRematch: false });
    expect(m.ratings).toEqual([{ rating: 1500, rd: 350, settled: false }, { rating: 1500, rd: 350, settled: false }]);

    const [end] = await winner.waitFor('matchEnd');
    expect(end).toMatchObject({ winner: 1, score: [0, 2], reason: 'topOut' });
    const [up] = await winner.waitFor('rating');
    const [down] = await loser.waitFor('rating');
    expect(up.after.rating).toBeGreaterThan(1500);
    expect(down.after.rating).toBeLessThan(1500);
    expect(up.after.rd).toBeLessThan(350);
    // Gems for playing: a first win of the day, and a finished loss.
    expect((await winner.waitFor('gems'))[0]).toEqual({ earned: 45, total: 45 });
    expect((await loser.waitFor('gems'))[0]).toEqual({ earned: 5, total: 5 });

    // No rematch in ranked: asking does nothing.
    loser.room.send('rematch');
    await new Promise((r) => setTimeout(r, 200));
    expect(winner.got.rematch).toBeUndefined();

    const [{ matchId }] = await winner.waitFor('saved');
    const replay = store.replay(matchId)!;
    expect(replay.rounds).toHaveLength(2);
    expect(replay.names).toEqual(m.names);
    for (let i = 0; i < replay.rounds.length; i++) {
      const [p0, p1] = playOnlineRound(replay, i);
      expect(p0.game.toppedOut).toBe(true);
      expect(p1.game.toppedOut).toBe(false);
    }
    const profile = store.profile(m.names[0])!;
    expect(profile).toMatchObject({ games: 1, wins: 0 });
    expect(profile.recent[0]).toMatchObject({ id: matchId, mode: 'ranked', score: [0, 2], side: 0 });
    await Promise.all(players.map((p) => p.room.leave()));
  }, 30_000);

  it('rejects impossible inputs and ends the match', async () => {
    const hostRoom = await new Client(url).create(BATTLE_ROOM, opts('private', 'Cheat'));
    const host = new Player(hostRoom, () => []);
    const [{ code }] = await host.waitFor('waiting');
    const guest = new Player(await new Client(url).joinById(code!, opts('private', 'Fair')), () => []);
    await host.waitFor('round');
    host.stop();
    // Claiming ten seconds of play right away is a speed hack.
    hostRoom.send('inputs', { upTo: 600, keys: [], acks: [] });
    const [end] = await guest.waitFor('matchEnd');
    expect(end).toMatchObject({ winner: 1, reason: 'invalid' });
    await Promise.all([hostRoom.leave(), guest.room.leave()]);
  }, 30_000);

  it('a rematch starts a new match when both ask', async () => {
    const hostRoom = await new Client(url).create(BATTLE_ROOM, opts('private', 'H'));
    const host = new Player(hostRoom);
    const [{ code }] = await host.waitFor('waiting');
    const guest = new Player(await new Client(url).joinById(code!, opts('private', 'G')), () => []);
    await host.waitFor('matchEnd');
    hostRoom.send('rematch');
    await guest.waitFor('rematch');
    expect(guest.got.rematch![0]).toEqual({ requested: [true, false] });
    guest.room.send('rematch');
    await host.waitFor('round', 3);
    expect(host.got.match!.at(-1)!.score).toEqual([0, 0]);
    await Promise.all([hostRoom.leave(), guest.room.leave()]);
  }, 30_000);

  it('a dropped player reconnects and carries on', async () => {
    const hostRoom = await new Client(url).create(BATTLE_ROOM, opts('private', 'Flaky'));
    const host = new Player(hostRoom, () => []);
    const [{ code }] = await host.waitFor('waiting');
    const guest = new Player(await new Client(url).joinById(code!, opts('private', 'Steady')), () => []);
    await host.waitFor('round');
    await new Promise((r) => setTimeout(r, 400));
    // Kill the host's socket from the server side, like a network drop.
    const room = matchMaker.getLocalRoomById(code!);
    (room.clients.find((c) => c.sessionId === hostRoom.sessionId)!.ref as unknown as { terminate(): void }).terminate();
    await guest.waitFor('oppStatus', 2);
    expect(guest.got.oppStatus).toEqual([{ connected: false }, { connected: true }]);
    const [resync] = await host.waitFor('resync');
    expect(resync.round).toBe(1);
    // Play resumes: the host's ticks keep being accepted, then the host tops out twice.
    host.policy = hardDrops;
    const [end] = await guest.waitFor('matchEnd');
    expect(end).toEqual({ winner: 1, score: [0, 2], reason: 'topOut' });
    await Promise.all([hostRoom.leave(), guest.room.leave()]);
  }, 30_000);

  it('over the player cap, the queue waits for a free slot and private rooms are refused', async () => {
    await until(() => playersInMatches() === 0);
    setMaxPlayers(2);
    try {
      const qa = await enqueue('quick', 'Cap1');
      const qb = await enqueue('quick', 'Cap2');
      const [a, b] = await Promise.all([qa.matched, qb.matched]);
      const qc = await enqueue('quick', 'Cap3');
      const qd = await enqueue('quick', 'Cap4');
      let started = false;
      void qc.matched.then(() => (started = true));
      await until(() => qc.status.some((s) => s.serverFull));
      expect(qc.status.at(-1)).toMatchObject({ serverFull: true, playing: 2 });
      expect(started).toBe(false);
      await expect(new Client(url).create(BATTLE_ROOM, opts('private', 'Late'))).rejects.toThrow(/full/i);
      // Both leave the first match: their slots free up and the waiting pair starts.
      await Promise.all([a.room.leave(), b.room.leave()]);
      const [c, d] = await Promise.all([qc.matched, qd.matched]);
      expect(c.room.roomId).toBe(d.room.roomId);
      await Promise.all([c.room.leave(), d.room.leave()]);
    } finally {
      setMaxPlayers(DEFAULT_MAX_PLAYERS);
    }
  }, 30_000);
});

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
