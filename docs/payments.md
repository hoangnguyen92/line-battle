# The shop and payments

Looks only, never power. Players buy **gems** in packs, then spend gems on
characters, block skins and board themes. Gems exist so a small item doesn't
pay a whole card fee by itself.

- Catalog and prices: `packages/engine/src/shop.ts` (`PRICES`, `GEM_PACKS`).
  Anything without a price is free. Earned skins (Gold) are never sold.
- Accounts keep gems and bought items (`owned` and `gem_ledger` tables). Every
  change to a balance is in the ledger with a reason.
- The server swaps any item a player hasn't bought for the default before the
  opponent sees it, so a modified browser can't show off unpaid items.
- Guests can use the free items only.

## Giving gems by hand

For testing or support, from your PC:

    npm run gems -- <name>               # balance, items, recent changes
    npm run gems -- <name> 500 test      # add 500 gems (reason "test")
    npm run gems -- <name> -200 mistake  # take 200 back

## Card payments (Stripe)

Off until three settings are in the server's `.env`. With them missing the
shop still works, and the gem packs say "Buying gems opens soon".

1. In the Stripe dashboard, Developers > API keys: copy the secret key.
   Start with the **test mode** key (`sk_test_...`).
2. Developers > Webhooks > Add endpoint:
   - URL: `https://linebattle.net/api/pay/stripe/webhook`
   - Events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `charge.refunded`
   - Copy its signing secret (`whsec_...`).
3. On the server, add to `~/line-battle/.env`:

       STRIPE_SECRET_KEY=sk_test_...
       STRIPE_WEBHOOK_SECRET=whsec_...
       SITE_URL=https://linebattle.net

   then `docker compose up -d`. The server log says
   `Card payments on (Stripe test mode)`.
4. Buy a pack with Stripe's test card `4242 4242 4242 4242`, any future date
   and any CVC. The gems should appear a few seconds after you're sent back.
5. When that works, swap in the live keys (a live webhook endpoint has its
   own signing secret).

Players reading Vietnamese pay in VND, everyone else in USD. Gems are only
added when Stripe's signed webhook arrives, never because the browser says it
paid, and the same payment can't add gems twice. A full refund in the Stripe
dashboard takes the gems back (as many as are left).

## Adding another provider

MoMo, ZaloPay and Napas are planned through a second provider (e.g. Xsolla).
A provider implements `PaymentProvider` in `packages/server/src/payments.ts`
(start a checkout, handle its webhook) and is added to the list in
`packages/server/src/main.ts`. Its webhook goes to `/api/pay/<name>/webhook`.
