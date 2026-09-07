# ADR 0004: How a Shopify product reaches a sales channel

**Status:** proposed, 7 September 2026. Awaiting a decision.
**Date:** September 2026
**Blocks:** A5's third exit clause, and therefore Gate A
**Supersedes:** the open-decisions register entry 4a, which stays as the index pointer

---

## Context

A5's exit test is three claims. Two are answered. The third — *the file is actually
deliverable to a buyer* — turned out not to be merely unrun but blocked, and running the
other two is what found it.

**`status: ACTIVE` does not make a Shopify product purchasable.** Status and *published to a
sales channel* are different facts, and Fanwise was setting only the first. All three
products on the development store read `publishedAt: null` and `onlineStoreUrl: null`,
including the two that are ACTIVE. They are active and on no sales channel, so no storefront
page exists and no buyer can reach them.

This was an assumption nobody had tested — that ACTIVE means for sale — rather than a defect
in anything that was written. It is exactly what an exit test is for.

`productSet` cannot fix it. It sets status; channel publication is a different mutation
against a different object.

### What the API actually requires

Verified against shopify.dev for the `2026-07` Admin API on 7 September 2026:

| Call | Purpose | Scope |
|---|---|---|
| `publications` | Find the Online Store publication id | `read_publications` |
| `publishablePublish(id, input: [{ publicationId }])` | Put the product on it | `write_publications` |

**Two scopes, not one.** An app cannot publish to a publication it cannot first enumerate,
and the publication id is per-shop, so it has to be read rather than assumed. Fanwise
currently requests `write_products` and `read_products` and nothing else
(`lib/channels/adapters/shopify/config.ts`).

### What a scope change costs, in this codebase specifically

Shopify's documented behaviour is that merchants who already have the app installed approve
new scopes the next time they open it. **That is the managed-installation flow, and Fanwise
does not use it.** Fanwise runs its own authorization code grant against the shop domain
(`docs/channels/shopify.md` §9), with its own authorize and callback routes, so Shopify will
not prompt anybody on Fanwise's behalf.

Worse, Fanwise cannot currently tell that a connection is stale. `channel_connections.scopes`
is written at OAuth and **read by nothing** — a grep for it finds one line, the write. So the
real cost of adding a scope is not two strings in an array. It is:

1. the two strings,
2. a comparison of each connection's stored scopes against what the adapter now asks for,
3. a connection state that means *authorized, but not for what we now need*,
4. somewhere in the UI that says so and starts the re-authorization,
5. and every existing creator going through it.

At three connections that is cheap in wall-clock and expensive in principle. At three hundred
it is a migration.

---

## Options

**A. Fanwise publishes to the sales channel.** Request both publication scopes, read the
Online Store publication id at connect time and cache it on the connection, and call
`publishablePublish` in `activate()` alongside the existing status change. Build scope-drift
detection and a re-authorization path, because there is no other way to get the existing
connections onto the new grant.

**B. The creator publishes it.** A second manual step beside `attach_digital_file`, with the
same standing: Fanwise says exactly what to do, the creator asserts it is done, and
`status_source` stays honest about who confirmed it. No scope change, no re-authorization,
no new mutation.

**C. Rely on the publication's own `autoPublish`.** A `Publication` carries an `autoPublish`
field, and a shop whose Online Store publication has it set would put new products on the
channel without being asked. **Not a real option, and listed so it is not rediscovered as
one.** It is the merchant's setting, not the app's; Fanwise would be depending on a
configuration it cannot read without `read_publications` — the very scope option B exists to
avoid — and cannot set at all. A product's reachability would vary by shop for reasons
Fanwise could neither see nor explain. It is also, on the evidence of the development store,
not on by default.

---

## Decision

**Not yet made. This document exists to make it once rather than repeatedly.**

The recommendation carried over from register entry 4a, and unchanged by the API detail
found since: **option B for Gate A, option A afterwards.**

Two things are worth separating, because only one of them is a decision:

**The honesty fix is not optional and does not wait for this.** `liveness` currently reports
`live` as "On the channel, and available to buy" once the manual file step is done. For these
products the first half is true and the second is false. That must be corrected in whichever
direction this lands, and it should land before either option is built. ADR 0001 invented
`published_not_live` for the unattached-file case; this is a second way to be unbuyable that
the vocabulary does not yet cover, and shipping a third state is a smaller change than either
option here.

---

## Why B first

**Gate A is about closing the loop with a handful of creators.** Its exit condition is one
outside creator taking a real product to two live listings. Spending that gate's goodwill on
a forced re-authorization of every existing connection — to save one click, on the one
channel the creator already owns and is already logged into — is a poor trade.

**The step is reversible into the scope. The reverse is not.** Shipping B and later replacing
it with A is a manual step that disappears, which creators experience as the product getting
better. Shipping A and later retreating to B is a scope that was taken and then a step that
appeared, which is the product getting worse, and the scope cannot be un-granted without
another round of re-authorization.

**B is nearly free.** The assisted handoff component exists, the manual-step table exists, and
`gatesActivation` already models "the product is not live until a human confirms something".
This is a second row with the same shape as `attach_digital_file`.

**A is the answer that makes Publish Everywhere mean what it says**, which is why it should
not be abandoned — only sequenced. The central action of this product cannot indefinitely
mean *published, then two things you do by hand*.

### The honest argument against B

Shopify *will* let an app do this. Unlike ADR 0001's file step, which is a manual step
because the API has no alternative, this one would be a manual step **by choice**. That is a
real difference in kind, and it is the strongest case for doing A now: a creator who is told
"Shopify has no API for this" about the file and then told "please also click Publish
yourself" about the channel is being asked to take two different sentences on trust, and only
one of them is a limit.

If that asymmetry is judged worse than a re-authorization at three connections — and it is a
judgement, not a calculation — then A now is defensible and this recommendation should be
overruled.

---

## What the creator experiences

### Under B

```
  SHOPIFY                                  Published, 2 steps left

  Product created. Not yet on sale.        View in Shopify  ↗

  ⚠  Attach the download file
     Shopify has no API for digital files, so this step is
     manual, once per product.

  ⚠  Put it on your Online Store
     Shopify keeps "active" and "on sale" as separate settings.
     Sales channels ›  Online Store  ✓

     [ Mark both done ]        → product goes live, and is buyable
```

Two steps is meaningfully worse than one, and it is the whole cost of B. The wording has to
carry it: the first step says Shopify *cannot*, the second says Shopify *keeps these
separate*. Neither may say "cannot" about the second, because that is not true.

### Under A

One step, the file, exactly as ADR 0001 describes it. Plus, once, per existing creator:

```
  SHOPIFY                                    Reconnect needed

  Fanwise now needs permission to put products on your
  sales channels. Your existing products are unaffected.

  [ Reconnect Shopify ]
```

---

## Consequences

**If B.** No scope change, no re-authorization, no new mutation, no scope-drift machinery.
Gate A's third exit clause becomes runnable immediately. The cost is two manual steps on the
channel a creator most expects to be automatic, and it will come up in alpha — as ADR 0001
already predicts for the file step, now doubled.

**If A.** Publish Everywhere means what it says on Shopify. The cost is four pieces of work
that do not exist yet, of which scope-drift detection is the one that is not obvious from the
outside and is the one that will take the time, plus a forced re-authorization whose cost
grows with every day the decision is deferred. That last point is the argument for deciding
this now rather than at B1.

**Either way.** `liveness` gains a state, and `docs/channels/shopify.md` §13 item 4 stops
being an open question and becomes a documented property of the channel.

---

## When to revisit, if B is chosen

1. **Before Gate B opens.** A is the intended end state; B is a Gate A expedient. If it
   survives into B without a date, it has become permanent by inattention.
2. Any creator who forgets the sales-channel step and reports a product as broken. One is
   enough — that is a buyer who could not buy, which is the failure ADR 0001 exists to
   prevent, arriving through a different door.
3. Any second owned-storefront channel. Two channels with the same avoidable manual step is
   a pattern rather than an exception.

---

## Verify before implementing

Whichever is chosen, `docs/channels/shopify.md` §13 items 7 through 9 are still open and
should be answered in the same live run:

- Whether a live shop accepts the taxonomy ids in §14.
- Whether `seo.title` is accepted.
- Whether `product(id:)` returns null rather than erroring for a deleted id.

And specific to this decision:

- **Whether the development store's Online Store publication has `autoPublish` set**, which
  would explain the observed `publishedAt: null` differently and is worth ruling out before
  building anything. Reading it needs `read_publications`, so under B this stays unanswered,
  which is itself an argument that is honest to state.
- Under A: whether `publishablePublish` on an already-published resource is a no-op, since
  `activate()` must stay idempotent. Architecture invariant 3 does not bend for a second
  mutation in the same method.
