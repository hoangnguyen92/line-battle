import { createHmac, timingSafeEqual } from 'node:crypto';
import { GEM_PACKS, type GemPack } from '@line-battle/engine';
import type { Currency, PaymentProvider } from './payments';
import type { Store, User } from './store';

// ---- card payments through Stripe Checkout ---------------------------------
// The player is sent to a Stripe page to pay, and Stripe tells us about the
// payment with a signed webhook. Gems are only ever added from the webhook,
// never from the browser coming back, so closing the tab can't lose gems and
// a forged "I paid" can't make them.

export interface StripeConfig {
  /** sk_live_... or sk_test_... */
  secretKey: string;
  /** whsec_..., from the webhook endpoint in the Stripe dashboard. */
  webhookSecret: string;
  /** Where Stripe sends the player back to, e.g. https://linebattle.net */
  siteUrl: string;
}

/** Null (payments off) unless all three settings are there. */
export function stripeConfigFromEnv(env: Record<string, string | undefined>): StripeConfig | null {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL } = env;
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SITE_URL) return null;
  return { secretKey: STRIPE_SECRET_KEY, webhookSecret: STRIPE_WEBHOOK_SECRET, siteUrl: SITE_URL.replace(/\/$/, '') };
}

/** A signed webhook older than this is refused, so a captured one can't be replayed later. */
const SIGNATURE_TOLERANCE_S = 300;

export class StripeError extends Error {}

/** True when `header` (Stripe-Signature) signs `payload` with `secret`. */
export function verifySignature(payload: string, header: string | null, secret: string, nowS: number): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > SIGNATURE_TOLERANCE_S || signatures.length === 0) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest();
  return signatures.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

interface CheckoutSession {
  id: string;
  payment_status: string;
  payment_intent: string | null;
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
}

interface Charge {
  payment_intent: string | null;
  refunded: boolean;
}

export class StripePayments implements PaymentProvider {
  readonly name = 'stripe';

  constructor(
    private config: StripeConfig,
    private store: Store,
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  /** Starts a payment for a gem pack and returns the Stripe page to send the player to. */
  async checkout(user: User, pack: GemPack, currency: Currency): Promise<string> {
    const amount = currency === 'vnd' ? pack.vnd : Math.round(pack.usd * 100); // VND has no minor unit
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: `${this.config.siteUrl}/?paid=1`,
      cancel_url: `${this.config.siteUrl}/?paid=0`,
      client_reference_id: String(user.id),
      'metadata[user_id]': String(user.id),
      'metadata[pack]': pack.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][price_data][product_data][name]': `${pack.gems} gems - Line Battle`,
    });
    const res = await this.fetchFn('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      // Stripe hands back the same session if a retried request has the same key.
      headers: { 'idempotency-key': `checkout-${user.id}-${pack.id}-${currency}-${Math.floor(this.now() / 10_000)}`, authorization: `Bearer ${this.config.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const data = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
    if (!res.ok || !data?.url) throw new StripeError(data?.error?.message ?? `Stripe answered ${res.status}`);
    return data.url;
  }

  /**
   * Handles a webhook. Returns false when the signature is wrong. Events we
   * don't use are accepted and ignored, so Stripe doesn't keep retrying them.
   */
  handleWebhook(payload: string, signature: string | null): boolean {
    if (!verifySignature(payload, signature, this.config.webhookSecret, Math.floor(this.now() / 1000))) return false;
    const event = JSON.parse(payload) as { type: string; data: { object: unknown } };
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      this.paid(event.data.object as CheckoutSession);
    } else if (event.type === 'charge.refunded') {
      this.refunded(event.data.object as Charge);
    }
    return true;
  }

  private paid(session: CheckoutSession): void {
    // Bank transfers and the like complete first and pay later, with a second event.
    if (session.payment_status !== 'paid') return;
    const userId = Number(session.metadata?.user_id ?? session.client_reference_id);
    const pack = GEM_PACKS.find((p) => p.id === session.metadata?.pack);
    if (!pack || !Number.isInteger(userId) || !this.store.userById(userId)) {
      console.error('stripe: paid session with unknown user or pack', session.id);
      return;
    }
    // Keyed on the payment, so a webhook that arrives twice adds the gems once.
    this.store.addGems(userId, pack.gems, `stripe ${pack.id}`, `stripe:${session.payment_intent ?? session.id}`);
  }

  /** A full refund takes the gems back (as many as are left). */
  private refunded(charge: Charge): void {
    if (!charge.refunded || !charge.payment_intent) return;
    const credit = this.store.ledgerEntry(`stripe:${charge.payment_intent}`);
    if (!credit) return;
    this.store.addGems(credit.userId, -credit.delta, 'stripe refund', `stripe-refund:${charge.payment_intent}`);
  }
}
