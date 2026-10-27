import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Api, type ApiRequest } from '../src/api';
import { Metrics } from '../src/metrics';
import { Store } from '../src/store';

const V1 = 'aaaaaaaaaaaaaaaa';
const V2 = 'bbbbbbbbbbbbbbbb';
const DAY = 24 * 60 * 60 * 1000;

describe('metrics', () => {
  let now: number;
  let store: Store;
  let metrics: Metrics;
  let api: Api;
  const req = (method: string, path: string, body: unknown = null, token: string | null = null): ApiRequest => ({ method, path, token, body, ip: '1.2.3.4' });

  beforeEach(() => {
    now = Date.UTC(2026, 9, 27, 5, 0);
    store = new Store(':memory:', () => now);
    metrics = new Metrics(store.db, ':memory:', () => now);
    api = new Api(store, () => now, [], metrics, 'secret-key');
  });
  afterEach(() => store.close());

  it('keeps valid events and drops junk', () => {
    expect(metrics.record('short', [{ e: 'visit' }])).toBe(0);
    expect(metrics.record(V1, 'nope')).toBe(0);
    const kept = metrics.record(V1, [
      { e: 'visit', d: 'facebook' },
      { e: 'click', d: 'start-bot' },
      { e: 'play', d: 'bot-2' },
      { e: 'game-finished', d: 'bot-2', n: 95 },
      { e: 'time', n: 300 },
      { e: 'hack', d: 'x' },
      { e: 'click', d: '<script>' },
    ]);
    expect(kept).toBe(6);
    const rows = store.db.prepare("SELECT detail FROM events WHERE name = 'click'").all() as { detail: string | null }[];
    expect(rows.map((r) => r.detail)).toEqual(['start-bot', null]);
  });

  it('builds the dashboard: visitors, sources, modes, clicks, stay', () => {
    metrics.record(V1, [{ e: 'visit', d: 'facebook' }, { e: 'click', d: 'start-bot' }, { e: 'play', d: 'bot-2' }, { e: 'game-finished', d: 'bot-2', n: 90 }, { e: 'time', n: 240 }]);
    metrics.record(V2, [{ e: 'visit', d: 'tiktok' }, { e: 'time', n: 60 }]);
    // V1 comes back the next day.
    now += DAY;
    metrics.record(V1, [{ e: 'visit', d: 'direct' }, { e: 'play', d: 'sprint' }, { e: 'game-quit', d: 'sprint', n: 30 }]);

    const d = metrics.dashboard() as any;
    const today = d.days[d.days.length - 1];
    const yesterday = d.days[d.days.length - 2];
    expect(yesterday).toMatchObject({ visitors: 2, newVisitors: 2, players: 1, games: 1, minutes: 5 });
    expect(today).toMatchObject({ visitors: 1, returning: 1, games: 1 });
    // The first visit's source sticks.
    expect(d.sources).toEqual(
      expect.arrayContaining([
        { source: 'facebook', visitors: 1, players: 1, minutes: 4 },
        { source: 'tiktok', visitors: 1, players: 0, minutes: 1 },
      ]),
    );
    expect(d.modes.find((m: any) => m.mode === 'bot-2')).toMatchObject({ games: 1, finished: 1, quit: 0, avgSeconds: 90 });
    expect(d.modes.find((m: any) => m.mode === 'sprint')).toMatchObject({ games: 1, finished: 0, quit: 1 });
    expect(d.clicks).toEqual([{ button: 'start-bot', clicks: 1, visitors: 1 }]);
    expect(d.onlineNow).toBe(1);
    expect(d.totals.visitors).toBe(2);
    expect(d.system.now.memTotal).toBeGreaterThan(0);
  });

  it('the API takes events from anyone but the dashboard only with the key', async () => {
    expect((await api.handle(req('POST', '/api/track', { v: V1, events: [{ e: 'visit', d: 'youtube' }] }))).body).toEqual({ kept: 1 });
    expect((await api.handle(req('GET', '/api/admin/dashboard'))).status).toBe(401);
    expect((await api.handle(req('GET', '/api/admin/dashboard', null, 'wrong'))).status).toBe(401);
    const ok = await api.handle(req('GET', '/api/admin/dashboard', null, 'secret-key'));
    expect(ok.status).toBe(200);
    expect((ok.body as any).sources[0].source).toBe('youtube');
  });

  it('without a key the dashboard does not exist', async () => {
    const closed = new Api(store, () => now, [], metrics, null);
    expect((await closed.handle(req('GET', '/api/admin/dashboard', null, 'anything'))).status).toBe(404);
  });

  it('saves video numbers per day and platform, replacing the same day', async () => {
    const save = (body: unknown) => api.handle(req('POST', '/api/admin/social', body, 'secret-key'));
    expect((await save({ day: '2026-10-27', platform: 'facebook', views: 258 })).status).toBe(200);
    expect((await save({ day: '2026-10-27', platform: 'facebook', views: 300, likes: 2 })).status).toBe(200);
    expect((await save({ day: 'today', platform: 'facebook' })).status).toBe(400);
    expect((await save({ day: '2026-10-27', platform: 'myspace' })).status).toBe(400);
    const d = metrics.dashboard() as any;
    expect(d.social).toEqual([{ day: '2026-10-27', platform: 'facebook', views: 300, likes: 2, comments: 0, followers: 0 }]);
  });
});
