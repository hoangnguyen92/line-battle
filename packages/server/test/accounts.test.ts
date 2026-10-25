import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createEndpoint, createRouter, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { Me, Profile, SessionResponse } from '@line-battle/engine';
import { Api, AUTH_ATTEMPTS, apiEndpoint, type ApiRequest } from '../src/api';
import { DEFAULT_RATING, idleRd, PERIOD_MS, rate, rateMatch, winChance } from '../src/glicko';
import { checkPassword, hashPassword } from '../src/passwords';
import { SESSION_TTL_MS, Store, type MatchRecord } from '../src/store';

describe('glicko-2', () => {
  it("matches Glickman's worked example", () => {
    const r = rate({ rating: 1500, rd: 200, vol: 0.06 }, [
      { opp: { rating: 1400, rd: 30, vol: 0.06 }, score: 1 },
      { opp: { rating: 1550, rd: 100, vol: 0.06 }, score: 0 },
      { opp: { rating: 1700, rd: 300, vol: 0.06 }, score: 0 },
    ]);
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
    expect(r.vol).toBeCloseTo(0.05999, 4);
  });

  it('an upset moves ratings more than an expected win', () => {
    const strong = { rating: 1900, rd: 80, vol: 0.06 };
    const weak = { rating: 1500, rd: 80, vol: 0.06 };
    expect(winChance(strong, weak)).toBeGreaterThan(0.85);
    const expectedWin = rateMatch(strong, weak, 1).rating - strong.rating;
    const upset = rateMatch(weak, strong, 1).rating - weak.rating;
    expect(upset).toBeGreaterThan(expectedWin * 4);
  });

  it('time away widens the deviation, up to the starting 350', () => {
    const settled = { rating: 1800, rd: 60, vol: 0.06 };
    expect(idleRd(settled, 0)).toBe(60);
    expect(idleRd(settled, 30)).toBeGreaterThan(60);
    expect(idleRd(settled, 1e6)).toBe(DEFAULT_RATING.rd);
  });
});

describe('passwords', () => {
  it('hashes with a salt and checks', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).not.toBe(b);
    expect(await checkPassword('correct horse', a)).toBe(true);
    expect(await checkPassword('wrong horse', a)).toBe(false);
    expect(await checkPassword('x', 'garbage')).toBe(false);
  });
});

function record(users: [number, number], winner: 0 | 1, extra: Partial<MatchRecord> = {}): MatchRecord {
  return {
    mode: 'ranked',
    region: 'asia',
    users,
    names: ['A', 'B'],
    score: winner === 0 ? [2, 0] : [0, 2],
    winner,
    reason: 'topOut',
    rated: true,
    replay: { version: 1, kind: 'online', mode: 'ranked', names: ['A', 'B'], handling: [{ das: 10, arr: 2, sdf: 20 }, { das: 10, arr: 2, sdf: 20 }], rounds: [], score: [2, 0], winner, reason: 'topOut' },
    ...extra,
  };
}

describe('store', () => {
  let now = 1_800_000_000_000;
  let store: Store;
  beforeEach(() => {
    now = 1_800_000_000_000;
    store = new Store(':memory:', () => now);
  });
  afterEach(() => store.close());

  it('names are unique regardless of case', () => {
    expect(store.createUser('Hoang', 'h', 'asia')).not.toBeNull();
    expect(store.createUser('hoang', 'h', 'asia')).toBeNull();
    expect(store.credentials('HOANG')?.user.name).toBe('Hoang');
  });

  it('sessions find their user and expire when unused', () => {
    const u = store.createUser('Sess', 'h', 'asia')!;
    store.createSession(u.id, 'tok');
    expect(store.userForToken('tok')?.id).toBe(u.id);
    expect(store.userForToken('nope')).toBeNull();
    now += SESSION_TTL_MS + 1;
    expect(store.userForToken('tok')).toBeNull();
  });

  it('a ranked result updates both players; a voided or casual one does not', () => {
    const a = store.createUser('A', 'h', 'asia')!;
    const b = store.createUser('B', 'h', 'asia')!;
    const { changes } = store.recordMatch(record([a.id, b.id], 0));
    expect(changes![0].after.rating).toBeGreaterThan(1500);
    expect(changes![1].after.rating).toBeLessThan(1500);
    expect(store.userById(a.id)).toMatchObject({ games: 1, wins: 1 });
    expect(store.userById(b.id)).toMatchObject({ games: 1, wins: 0 });

    const before = store.userById(a.id)!.rating;
    expect(store.recordMatch(record([a.id, b.id], 1, { rated: false, reason: 'invalid' })).changes).toBeNull();
    expect(store.recordMatch(record([a.id, b.id], 1, { mode: 'quick' })).changes).toBeNull();
    expect(store.userById(a.id)!.rating).toEqual(before);
    expect(store.recentMatches(a.id).map((m) => m.mode)).toEqual(['quick', 'ranked', 'ranked']);
  });

  it('the leaderboard lists settled ratings only, and they unsettle after a long break', () => {
    const a = store.createUser('Grinder', 'h', 'asia')!;
    const b = store.createUser('Sparring', 'h', 'europe')!;
    const c = store.createUser('Newbie', 'h', 'asia')!;
    for (let i = 0; i < 25; i++) store.recordMatch(record([a.id, b.id], i % 3 === 0 ? 1 : 0));
    store.recordMatch(record([c.id, b.id], 0));
    const board = store.leaderboard();
    expect(board.map((e) => e.name)).toEqual(['Grinder', 'Sparring']);
    expect(board[0].rating).toBeGreaterThan(board[1].rating);
    expect(store.profile('Grinder')).toMatchObject({ rank: 1, games: 25 });
    expect(store.profile('Newbie')).toMatchObject({ rank: null, games: 1 });
    now += 3 * 365 * PERIOD_MS;
    expect(store.leaderboard()).toEqual([]);
  });
});

describe('api', () => {
  let store: Store;
  let api: Api;
  let ip = 0;
  const call = (method: string, path: string, body?: unknown, token: string | null = null) =>
    api.handle({ method, path, body, token, ip: `10.0.0.${ip}` } satisfies ApiRequest);

  beforeEach(() => {
    store = new Store(':memory:');
    api = new Api(store);
    ip++;
  });
  afterEach(() => store.close());

  it('signs up, logs in, syncs settings and logs out', async () => {
    const up = await call('POST', '/api/signup', { name: 'Player_1', password: 'hunter22!', region: 'europe', handling: { das: 7, arr: 0, sdf: 41 } });
    expect(up.status).toBe(201);
    const { token, me } = up.body as SessionResponse;
    expect(me).toMatchObject({ name: 'Player_1', region: 'europe', handling: { das: 7, arr: 0, sdf: 41 }, rating: { rating: 1500, rd: 350, settled: false } });

    expect((await call('POST', '/api/signup', { name: 'player_1', password: 'whatever1' })).status).toBe(409);
    expect((await call('POST', '/api/login', { name: 'Player_1', password: 'nope-nope' })).status).toBe(401);
    expect((await call('POST', '/api/login', { name: 'Nobody', password: 'nope-nope' })).status).toBe(401);
    const login = await call('POST', '/api/login', { name: 'PLAYER_1', password: 'hunter22!' });
    expect(login.status).toBe(200);

    const saved = await call('POST', '/api/me/settings', { handling: { das: 99, arr: 3, sdf: 10 }, region: 'asia' }, token);
    // Out-of-range handling is clamped, as everywhere else.
    expect(saved.body).toMatchObject({ region: 'asia', handling: { das: 20, arr: 3, sdf: 10 } });
    expect(((await call('GET', '/api/me', undefined, token)).body as Me).region).toBe('asia');

    // Looks, keys and sound sync too; unknown values fall back to defaults.
    expect(me.prefs).toBeNull();
    const prefs = { look: { character: 'pip', skin: 'nope' }, theme: 'sakura', keys: { left: ['KeyJ'], right: ['KeyJ', 'KeyL'], hardDrop: [] }, volume: 300, plainOpponent: true };
    const withPrefs = (await call('POST', '/api/me/settings', { prefs }, token)).body as Me;
    expect(withPrefs.prefs).toMatchObject({ look: { character: 'pip', skin: 'gem' }, theme: 'sakura', volume: 100, plainOpponent: true, tutorialDone: false });
    // A key can only do one thing, and an action with no key gets its default back.
    expect(withPrefs.prefs!.keys).toMatchObject({ left: ['KeyJ'], right: ['KeyL'], hardDrop: ['Space'], hold: ['KeyC', 'ShiftLeft', 'ShiftRight'] });
    expect(((await call('GET', '/api/me', undefined, token)).body as Me).prefs!.theme).toBe('sakura');

    expect((await call('POST', '/api/logout', undefined, token)).status).toBe(200);
    expect((await call('GET', '/api/me', undefined, token)).status).toBe(401);
    // The other session still works.
    expect((await call('GET', '/api/me', undefined, (login.body as SessionResponse).token)).status).toBe(200);
  });

  it('checks names and passwords', async () => {
    expect((await call('POST', '/api/signup', { name: 'ab', password: 'longenough' })).status).toBe(400);
    expect((await call('POST', '/api/signup', { name: 'has space', password: 'longenough' })).status).toBe(400);
    expect((await call('POST', '/api/signup', { name: 'Tên_Việt', password: 'longenough' })).status).toBe(201);
    expect((await call('POST', '/api/signup', { name: 'shortpw', password: 'short' })).status).toBe(400);
    expect((await call('POST', '/api/signup', 'not json')).status).toBe(400);
  });

  it('slows down password guessing from one address', async () => {
    await call('POST', '/api/signup', { name: 'Target', password: 'secret-pass' });
    for (let i = 1; i < AUTH_ATTEMPTS; i++) await call('POST', '/api/login', { name: 'Target', password: `guess${i}xx` });
    const blocked = await call('POST', '/api/login', { name: 'Target', password: 'secret-pass' });
    expect(blocked.status).toBe(429);
  });

  it('serves profiles, the leaderboard and replays', async () => {
    const a = (await call('POST', '/api/signup', { name: 'Alpha', password: 'password1' })).body as SessionResponse;
    const b = (await call('POST', '/api/signup', { name: 'Bravo', password: 'password1' })).body as SessionResponse;
    const { matchId } = store.recordMatch(record([a.me.id, b.me.id], 0));
    const profile = (await call('GET', '/api/profile/alpha')).body as Profile;
    expect(profile).toMatchObject({ name: 'Alpha', games: 1, wins: 1 });
    expect(profile.recent[0]).toMatchObject({ id: matchId, side: 0, winner: 0 });
    expect((await call('GET', '/api/profile/Nobody')).status).toBe(404);
    expect((await call('GET', '/api/leaderboard')).body).toEqual([]);
    expect((await call('GET', `/api/matches/${matchId}/replay`)).body).toMatchObject({ matchId, kind: 'online' });
    expect((await call('GET', '/api/matches/999/replay')).status).toBe(404);
    expect((await call('GET', '/api/nothing')).status).toBe(404);
  });

  it('is reachable over HTTP on the match server', async () => {
    const http = createServer();
    const server = defineServer({
      rooms: {},
      routes: createRouter({ health: createEndpoint('/health', { method: 'GET' }, async () => 'ok'), api: apiEndpoint(api) }),
      transport: new WebSocketTransport({ server: http }),
      greet: false,
      gracefullyShutdown: false,
    });
    await server.listen(0);
    const base = `http://localhost:${(http.address() as AddressInfo).port}`;
    try {
      const up = await fetch(`${base}/api/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
        body: JSON.stringify({ name: 'Http', password: 'password1' }),
      });
      expect(up.status).toBe(201);
      const { token } = (await up.json()) as SessionResponse;
      const me = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } });
      expect(((await me.json()) as Me).name).toBe('Http');
      expect((await fetch(`${base}/api/me`)).status).toBe(401);
      expect(await (await fetch(`${base}/health`)).text()).toBe('ok');
    } finally {
      await server.gracefullyShutdown(false);
    }
  });
});
