# Billing

Arrives at step C1. The model is simple for the customer and harder to implement than tiers,
which is the tradeoff being made deliberately.

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
4. The owned storefront is billable: false. Every other channel is billable: true. This is a
   property of the channel row, not a condition in a component.
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
