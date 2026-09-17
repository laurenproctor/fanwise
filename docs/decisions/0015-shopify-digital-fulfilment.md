# ADR 0015: Shopify marks a paid digital order line fulfilled

**Status:** accepted, 17 September 2026, at the founder's request.
**Date:** September 2026
**Builds on:** ADR 0013, whose confirmation (`deliverySetupConfirmedAt`) is the switch, and whose
metafield and snippet are unchanged.
**Revisits:** the fulfilment tail ADR 0001 declined to take on in Gate A, and the `orders/paid`
route ADR 0013 rejected. Neither is reversed: this takes a narrower path than either described.

---

## Context

A Shopify product Fanwise publishes needs no shipping (`requiresShipping: false` since A5), so an
order for one appears in the admin as **Unfulfilled** until somebody clicks Fulfill. The download
reached the buyer in the order confirmation email the moment they paid (ADR 0013), so the click is
bookkeeping. The founder asked, on 16 September 2026, for Fanwise to do it: once the creator has
confirmed the snippet is in their email, mark the order fulfilled, but only when it is a digital
order through Fanwise.

Three ways were put to the founder:

1. **Shopify's shop-wide setting** (Settings → Checkout → Order processing). Fulfils every line of
   every order, physical ones included. Wrong for a mixed store.
2. **A Shopify Flow rule**, no Fanwise code: trigger on a fulfillment order becoming ready, act
   when its delivery method is `none`. Per shop, by hand, and Fanwise cannot see whether it exists.
3. **Fanwise does it**, from a webhook.

## Decision

**The third, by the fulfillment-order route rather than the orders route.**

- **The trigger** is the `fulfillment_orders/order_routing_complete` webhook, which fires once per
  order when Shopify has grouped its lines into fulfillment orders. It is not an `orders/*` topic,
  so it needs none of Shopify's protected-customer-data approval, which is the approval an
  unlisted app cannot count on and the reason ADR 0013 rejected `orders/paid`. Its payload is one
  id.
- **Three scopes**, each with one reader: `read_merchant_managed_fulfillment_orders` for the topic
  and the read-back; `write_merchant_managed_fulfillment_orders` for `fulfillmentCreate`;
  `read_orders` for one field, the order's financial status. No protected field is ever named in
  a query. Adding them shows **Reconnect** on every existing connection (`staleScopes`), and the
  app version has to carry them first, per `docs/channels/shopify.md` §9.
- **The subscription** is made by Fanwise at authorization time, idempotently, pointed at
  `/api/channels/shopify/webhook` (`ensureRoutingWebhook`). Best effort: a failure is recorded on
  the connection's metadata under a generic key and shown on the Channels card, and never blocks
  the connection, because losing publishing to protect bookkeeping is the wrong trade. Shopify
  deletes a subscription after eight consecutive failed deliveries, which is why it runs on every
  authorization rather than once.
- **The route** is generic in the channel key, like the OAuth callback, and does the billing
  webhook's four steps: raw body, signature, receipt by the provider's delivery id
  (`channel_webhook_events`), then a job carrying the receipt's id. The work never runs in the
  request; Shopify allows five seconds.
- **The job** loads every active connection to the shop the verified delivery named, and asks the
  adapter to act once per connection. The adapter reads the fulfillment order back and fulfils
  exactly the lines that are Fanwise's: something left to fulfil, no shipping required, and the
  product is a listing published through this connection. A mug in the same order is left for the
  creator. A digital product the creator made by hand in the admin is left too: Fanwise did not
  deliver it and will not claim to have.
- **Only when paid**, `displayFinancialStatus == PAID`, the same word the email snippet gates on.
  A bank transfer still pending is left alone, the way ADR 0013 already treats its link.
- **Only once the snippet is confirmed.** The founder's rule. Without `deliverySetupConfirmedAt`
  the delivery is acknowledged and recorded as skipped, and Shopify is not asked anything.
- **No notification.** `notifyCustomer: false`: the shop's shipping email is written for a parcel,
  and the buyer already holds the download.
- **Idempotent twice over.** The receipt collides on the delivery id and, separately, on an
  idempotency key naming the fulfillment order, both on disk before the external write
  (invariant 3). Shopify itself refuses to fulfil a line with nothing remaining.

## What this does not do

- It does not catch an order that becomes paid later. The routing-complete delivery arrives when
  the order is placed; a manual payment confirmed a day later is not seen again. The `orders/paid`
  topic would see it, and needs the approval this route avoids. The creator fulfils those by hand,
  as they send the link by hand.
- It does not fulfil a line whose product was published by a different connection to the same
  shop, or unpublished since. `external_listing_id` is the membership test.
- It does not delete the subscription on disconnect. The route then finds no active connection and
  the receipt records that; an uninstalled app loses its subscriptions with it.
- It keeps no payload. The receipt is ids, timestamps and an outcome.

## Consequences

- **[verify] on a live shop**, in this order: that the app version released with the three scopes
  grants them on reconnect; that `webhookSubscriptionCreate` accepts the `uri` shape against
  `2026-07`; that a real order delivers a routing-complete payload carrying `fulfillment_order.id`;
  that `fulfillmentOrder.order.displayFinancialStatus` reads without a protected-data error under
  `read_orders` alone; and that a mixed test order leaves the shipped line untouched.
- Every existing Shopify connection shows **Reconnect** until it is redone. Publishing is refused
  before any call until then, with the message the connection card explains.
- B5's transaction ingestion will find `read_orders` already granted, and will need the protected
  customer data conversation this ADR sidestepped, because a sale event names a buyer.
- A second trigger, on `orders/paid`, is the one addition that would close the late-payment gap,
  and it is the decision to have if manual payment methods turn out to matter.
