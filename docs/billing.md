# Billing

Built at step C1, code complete 8 September 2026 on the branch `c1-stripe-billing`. The
model is simple for the customer and harder to implement than tiers, which is the tradeoff
being made deliberately. The implementation is described at the end of this file.

## The model

$9 per month base, plus $6 per connected external marketplace. One owned storefront
(Shopify) is included at no channel charge. Annual billing is ten months for twelve, so $90
base and $60 per marketplace.

## Stripe shape

One subscription per workspace with two items:

- **Base**: fixed price, quantity 1.
- **Channels**: per-unit price, quantity equal to the count of connected billable channels.

Not a plan enum. There is no Starter, Pro or Business, and no feature gate keyed to a plan
name.

## The rules that make it work

1. Connecting or disconnecting a channel is a billing event, in the same transaction as the
   `channel_connections` write. A connection that exists without a corresponding quantity is
   revenue lost silently.
2. Disconnection decrements quantity at the **end of the period**. No mid-cycle refund, which
   is what the pricing page promises.
3. A connection bills for a **minimum of one full period**, so connect-disconnect cycling
   around the boundary gains nothing.
4. An owned storefront is billable: false, and every marketplace is billable: true. This is
   a property of the channel row, not a condition in a component. Two rows are owned
   storefronts, Shopify and WooCommerce, and both are seeded included. Whether a second
   owned storefront should bill is decision 23 in `docs/decisions/0002`, still open;
   flipping the WooCommerce row is one migration.
5. Assisted versus automatic pricing is **an open decision**. Charging the same $6 for a
   channel Fanwise cannot publish to is harder to defend. Resolve before the pricing page is
   public.

## Entitlements

One service. It answers: may this workspace connect another channel, add a seat, generate
this, store this. It gates on connected channel count and type, never on a plan name string.

`if (plan === "pro")` must not appear anywhere in the codebase. When someone needs a limit,
they ask the entitlement service, and the limit is defined once.

## Storage

"Unlimited catalog subject to fair use" needs a real number in code even though it is not on
the pricing page. Starting suggestion: 25 GB per workspace, revisited with data.

## Implementation, C1

`lib/billing` owns it. The vendor lives in `lib/billing/providers/stripe` behind a
`BillingGateway` contract written in Fanwise's words, and a unit test reads the tree to keep
the vendor's name there, the same way the channel keys and the model vendor are kept inside
their layers. The gateway is selected by the presence of `STRIPE_SECRET_KEY`; without it,
`selectGateway()` is null and the settings page says billing is not configured, which is what
CI, the database suite and a fresh checkout see.

### The tables

`workspace_billing` is one row per workspace: the provider's customer and subscription ids,
the subscription status, the interval, the two item ids, the channel quantity the provider
holds, the current period, and `period_peak_quantity`. It is a mirror written by the server
only, from webhooks and the checkout action; the count of connected billable channels is the
source and the sync job reconciles the two.

`billing_events` is the ledger, and it is how rule 1 is kept. A trigger on
`channel_connections` writes one row on every insert and every delete, in the same
transaction, carrying `channels.billable` as it was at that moment and an idempotency key
that is NOT NULL and unique. No path that writes a connection can forget to write the event,
because none of them writes it. A reconnect that lands on an existing row is an update and
fires nothing, which is right: the same connection id is the same unit.

`billing_webhook_events` records every provider event by the provider's own id, so a
redelivery collides at the database. No grant to anon or authenticated.

### The sync job

`sync_billing` runs after any connection write and after any subscription webhook. It reads
the pending ledger rows for one workspace in order and, for each, sets the channel item's
quantity to the count of billable connections that exist *now*. The quantity is absolute,
never an increment, so a job that runs late, twice, or after a burst sets the same number;
a burst of connects is one provider call and a run of rows marked applied as no-ops.

Each attempt at a row carries `billing_event:<id>:a<attempt>`, and the attempt count is
persisted before the call. The provider binds a key to the parameters it first saw, and the
quantity may have moved between attempts, so one key per attempt is what keeps a retry from
being refused as a conflict while the key is still written down first (invariant 3).

A workspace with no live subscription leaves its billable events **pending**. When a checkout
completes, the subscription's webhook enqueues the job and the pending rows carry every
connection made during the trial onto the new subscription. "Pending" is also the honest
word for what a creator on trial sees: recorded, not yet billed. An event on a channel that
is not billable is marked `skipped` with the sentence "included in the base price".

A transient provider failure leaves the row pending, records the code, and rethrows so the
queue retries. A permanent refusal marks the row `failed` with the normalized message and
the provider's original, and stops; later rows would meet the same refusal.

### How rules 2 and 3 are actually expressed

Both are one decision, `prorationFor()` in `lib/billing/rules.ts`, and neither needs a
scheduled job.

- **Going down never credits.** A disconnected channel was paid for through the end of the
  period; the connection is gone and the next invoice carries the lower number. That is
  "decrements at the end of the period, no mid-cycle refund" in money terms.
- **Going up prorates the remainder of the period**, unless the new quantity is one the
  workspace has already been billed for this period. `period_peak_quantity` is the highest
  quantity billed since the period started, reset by the webhook when the period rolls. A
  creator who connects, disconnects and reconnects inside one period pays for the unit once,
  which is rule 3.

What this does not do, stated rather than hidden: a channel connected late in a period and
disconnected before the period ends is charged the prorated days and not a full period. The
published-listing refusal on disconnect makes that hard to exploit, and a literal
minimum-one-period charge would mean a flat invoice item that reads badly on an annual plan.
If the founder wants the literal rule, it is a change to `prorationFor()` and a flat charge,
not to the schema.

### Trial

Fourteen days from workspace creation, on Fanwise's side. No provider object exists until
the creator subscribes, so decision 18 (trial or free plan) stays open without a migration
riding on it: either answer is a change to `TRIAL_DAYS` and to the entitlement service at
C2. Nothing is gated on the trial at C1; the settings page displays it and that is all.

### Checkout and portal

Checkout is the provider's hosted page, opened from the settings page for monthly or annual.
The customer is created first under a key derived from the workspace, its id persisted, and
the session then carries the base price and, if any billable channels are connected, the
channel price at that quantity. The subscription's metadata names the workspace, so a webhook
attributes without a lookup; the customer id is the fallback.

The portal is the provider's too. Card, interval switch, invoices and cancellation all
happen there and reach Fanwise as `customer.subscription.updated`. Fanwise builds none of
those screens.

### Open

- Assisted versus automatic pricing (decision 16). C1 charges one channel price. A second
  price is a second item on the subscription and a second column in the config, not a schema
  change.
- The exit test needs a real provider account: a checkout in test mode, a connect that lands
  as a prorated line, a disconnect that produces no credit, a period roll that resets the
  peak, and a portal cancellation that reaches the row. None of it has run.
