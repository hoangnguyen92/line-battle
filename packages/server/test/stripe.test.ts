import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GEM_PACKS, type ShopInfo } from '@line-battle/engine';
import { Api } from '../src/api';
import { Store, type User } from '../src/store';
import { StripePayments, stripeConfigFromEnv, verifySignature } from '../src/stripe';

const SECRET = 'whsec_test';
const NOW = 1_800_000_000_000;
const sign = (payload: string, t = NOW / 1000, secret = SECRET) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

const paidEvent = (user: number, pack: string, pi = 'pi_1', status = 'paid') =>
  JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', payment_status: status, payment_intent: pi, client_reference_id: String(user), metadata: { user_id: String(user), pack } } },
  });

describe('stripe', () => {
  let store: Store;
  let user: User;
  let requests: { url: string; body: URLSearchParams }[];
  let stripe: StripePayments;
  beforeEach(() => {
    store = new Store(':memory:', () => NOW);
    user = store.createUser('Payer', 'h', 'asia')!;
    requests = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, body: init.body as URLSearchParams });
      return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_1' }), { status: 200 });
    }) as unknown as typeof fetch;
    stripe = new StripePayments({ secretKey: 'sk_test_x', webhookSecret: SECRET, siteUrl: 'https://linebattle.net' }, store, fakeFetch, () => NOW);
  });
  afterEach(() => store.close());

  it('is off unless every setting is there', () => {
    expect(stripeConfigFromEnv({ STRIPE_SECRET_KEY: 'sk' })).toBeNull();
    expect(stripeConfigFromEnv({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', SITE_URL: 'https://x.net/' })?.siteUrl).toBe('https://x.net');
  });

  it('checks webhook signatures, including their age', () => {
    const body = '{"a":1}';
    expect(verifySignature(body, sign(body), SECRET, NOW / 1000)).toBe(true);
    expect(verifySignature(body + ' ', sign(body), SECRET, NOW / 1000)).toBe(false);
    expect(verifySignature(body, sign(body, NOW / 1000, 'other'), SECRET, NOW / 1000)).toBe(false);
    expect(verifySignature(body, sign(body, NOW / 1000 - 600), SECRET, NOW / 1000)).toBe(false);
    expect(verifySignature(body, null, SECRET, NOW / 1000)).toBe(false);
  });

  it('starts a checkout priced in dong or dollars', async () => {
    const pack = GEM_PACKS[1];
    expect(await stripe.checkout(user, pack, 'vnd')).toContain('checkout.stripe.com');
    await stripe.checkout(user, pack, 'usd');
    const [vnd, usd] = requests.map((r) => r.body);
    expect(vnd.get('line_items[0][price_data][currency]')).toBe('vnd');
    expect(vnd.get('line_items[0][price_data][unit_amount]')).toBe(String(pack.vnd));
    expect(usd.get('line_items[0][price_data][unit_amount]')).toBe(String(Math.round(pack.usd * 100)));
    expect(vnd.get('metadata[user_id]')).toBe(String(user.id));
  });

  it('adds gems once per payment, waits for delayed payments, and takes them back on a refund', () => {
    const pack = GEM_PACKS[0];
    const unpaid = paidEvent(user.id, pack.id, 'pi_2', 'unpaid');
    expect(stripe.handleWebhook(unpaid, sign(unpaid))).toBe(true);
    expect(store.userById(user.id)!.gems).toBe(0);

    const paid = paidEvent(user.id, pack.id);
    expect(stripe.handleWebhook(paid, 'forged')).toBe(false);
    expect(stripe.handleWebhook(paid, sign(paid))).toBe(true);
    expect(stripe.handleWebhook(paid, sign(paid))).toBe(true);
    expect(store.userById(user.id)!.gems).toBe(pack.gems);

    const refund = JSON.stringify({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', refunded: true } } });
    expect(stripe.handleWebhook(refund, sign(refund))).toBe(true);
    expect(store.userById(user.id)!.gems).toBe(0);
  });

  it('is reachable through the api', async () => {
    const api = new Api(store, () => NOW, [stripe]);
    expect(((await api.handle({ method: 'GET', path: '/api/shop', body: null, token: null, ip: 'x' })).body as ShopInfo).payments).toEqual(['stripe']);
    const paid = paidEvent(user.id, GEM_PACKS[0].id, 'pi_9');
    const hook = (signature: string) => api.handle({ method: 'POST', path: '/api/pay/stripe/webhook', body: null, token: null, ip: 'x', rawBody: paid, signature });
    expect((await hook('bad')).status).toBe(400);
    expect((await hook(sign(paid))).status).toBe(200);
    expect(store.userById(user.id)!.gems).toBe(GEM_PACKS[0].gems);
    // Without a provider, checkout says so instead of failing oddly.
    store.createSession(user.id, 'tok');
    const closed = await new Api(store, () => NOW).handle({ method: 'POST', path: '/api/shop/checkout', body: { pack: 'gems-200' }, token: 'tok', ip: 'x' });
    expect(closed.status).toBe(503);
  });
});
