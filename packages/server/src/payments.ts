import type { GemPack } from '@line-battle/engine';
import type { User } from './store';

// A way to take real money for gems. Stripe (cards) is the first; a provider
// for Vietnamese wallets such as MoMo and ZaloPay plugs in the same way.

export type Currency = 'vnd' | 'usd';

export interface PaymentProvider {
  /** In the webhook address: /api/pay/<name>/webhook */
  readonly name: string;
  /** Starts a payment and returns the provider's page to send the player to. */
  checkout(user: User, pack: GemPack, currency: Currency): Promise<string>;
  /**
   * The provider's report of a payment. Adds the gems (once, however often
   * it is sent) and returns false when the report isn't really from them.
   */
  handleWebhook(payload: string, signature: string | null): boolean;
}
