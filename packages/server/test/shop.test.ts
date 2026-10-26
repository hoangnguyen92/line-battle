import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canUse, SHOP_ITEMS, usableLook, usableTheme, type Me, type SessionResponse } from '@line-battle/engine';
import { Api, type ApiRequest } from '../src/api';
import { Store, vnDayStart } from '../src/store';

describe('catalog', () => {
  it('earned skins are never for sale and free items need no purchase', () => {
    const gold = SHOP_ITEMS.find((i) => i.id === 'skin:gold')!;
    expect(gold.price).toBe(0);
    expect(gold.earned).toBeTruthy();
    expect(canUse('skin', 'gem', [])).toBe(true);
    expect(canUse('skin', 'neon', [])).toBe(false);
    expect(canUse('skin', 'neon', ['skin:neon'])).toBe(true);
    expect(canUse('skin', 'nonsense', ['skin:nonsense'])).toBe(false);
  });

  it('a look with unowned items falls back to the defaults', () => {
    expect(usableLook({ character: 'pip', skin: 'neon' }, [])).toEqual({ character: 'bao', skin: 'gem' });
    expect(usableLook({ character: 'pip', skin: 'neon' }, ['character:pip'])).toEqual({ character: 'pip', skin: 'gem' });
    expect(usableLook({ character: 'mochi', skin: 'gold' }, [])).toEqual({ character: 'mochi', skin: 'gold' });
    expect(usableTheme('sakura', [])).toBe('night');
  });
});

describe('store: gems and items', () => {
  let store: Store;
  beforeEach(() => (store = new Store(':memory:')));
  afterEach(() => store.close());

  it('buys with gems, once, and only with enough of them', () => {
    const u = store.createUser('Buyer', 'h', 'asia')!;
    expect(store.buy(u.id, 'skin:neon')).toBe('not-enough-gems');
    expect(store.addGems(u.id, 300, 'test')).toBe(true);
    expect(store.buy(u.id, 'skin:neon')).toBe('ok');
    expect(store.buy(u.id, 'skin:neon')).toBe('owned');
    expect(store.buy(u.id, 'skin:candy')).toBe('not-enough-gems');
    expect(store.buy(u.id, 'skin:gold')).toBe('not-for-sale');
    expect(store.buy(u.id, 'skin:gem')).toBe('not-for-sale');
    expect(store.userById(u.id)).toMatchObject({ gems: 50, owned: ['skin:neon'] });
  });

  it('the same payment ref only adds gems once, and balances never go negative', () => {
    const u = store.createUser('Payer', 'h', 'asia')!;
    expect(store.addGems(u.id, 200, 'pack', 'pay:1')).toBe(true);
    expect(store.addGems(u.id, 200, 'pack', 'pay:1')).toBe(false);
    expect(store.userById(u.id)!.gems).toBe(200);
    expect(store.ledgerEntry('pay:1')).toMatchObject({ userId: u.id, delta: 200 });
    store.addGems(u.id, -500, 'refund');
    expect(store.userById(u.id)!.gems).toBe(0);
  });
});

describe('gems for playing', () => {
  // 2027-01-15 10:00 in Vietnam.
  let now = Date.UTC(2027, 0, 15, 3);
  let store: Store;
  beforeEach(() => {
    now = Date.UTC(2027, 0, 15, 3);
    store = new Store(':memory:', () => now);
  });
  afterEach(() => store.close());

  it('days start at midnight in Vietnam', () => {
    expect(vnDayStart(now)).toBe(Date.UTC(2027, 0, 14, 17));
    expect(vnDayStart(Date.UTC(2027, 0, 14, 16, 59))).toBe(Date.UTC(2027, 0, 13, 17));
  });

  it('pays wins, the first win of the day, and finished losses, up to the daily cap', () => {
    const u = store.createUser('Grinder', 'h', 'asia')!;
    expect(store.rewardMatch(u.id, true, true)).toBe(45);
    expect(store.rewardMatch(u.id, true, false)).toBe(15);
    expect(store.rewardMatch(u.id, false, true)).toBe(5);
    expect(store.rewardMatch(u.id, false, false)).toBe(0);
    let total = 65;
    for (let i = 0; i < 20; i++) total += store.rewardMatch(u.id, true, true);
    expect(total).toBe(150);
    expect(store.userById(u.id)!.gems).toBe(150);
    // Spending doesn't make room under the cap.
    store.buy(u.id, 'skin:pixel');
    expect(store.rewardMatch(u.id, true, true)).toBe(0);
    // A new day, a new first win.
    now += 24 * 60 * 60 * 1000;
    expect(store.rewardMatch(u.id, true, true)).toBe(45);
  });
});

describe('api: shop', () => {
  let store: Store;
  let api: Api;
  const call = (method: string, path: string, body?: unknown, token: string | null = null) =>
    api.handle({ method, path, body, token, ip: '10.1.0.1' } satisfies ApiRequest);
  beforeEach(() => {
    store = new Store(':memory:');
    api = new Api(store);
  });
  afterEach(() => store.close());

  it('lists the catalog, and buying needs an account and gems', async () => {
    const shop = await call('GET', '/api/shop');
    expect((shop.body as { items: unknown[] }).items.length).toBe(SHOP_ITEMS.length);
    expect((await call('POST', '/api/shop/buy', { item: 'skin:neon' })).status).toBe(401);

    const { token, me } = (await call('POST', '/api/signup', { name: 'Shopper', password: 'hunter22!' })).body as SessionResponse;
    expect(me).toMatchObject({ gems: 0, owned: [] });
    expect((await call('POST', '/api/shop/buy', { item: 'skin:neon' }, token)).status).toBe(402);
    expect((await call('POST', '/api/shop/buy', { item: 'skin:what' }, token)).status).toBe(404);
    store.addGems(me.id, 400, 'test');
    const bought = await call('POST', '/api/shop/buy', { item: 'character:pip' }, token);
    expect(bought.status).toBe(200);
    expect(bought.body as Me).toMatchObject({ gems: 0, owned: ['character:pip'] });
    // A double click is not an error and doesn't charge twice.
    expect((await call('POST', '/api/shop/buy', { item: 'character:pip' }, token)).body as Me).toMatchObject({ gems: 0 });
  });
});
