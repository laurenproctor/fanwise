# ADR 0001: Shopify digital file delivery

**Status:** accepted, 4 September 2026. **Amended at A5, 4 September 2026** — see the
amendment at the foot of this file. The decision is unchanged; the mechanism is stronger.
**Date:** September 2026
**Blocks:** A2 (asset architecture), A5 (Shopify adapter)

---

## Context

Shopify's Admin API creates products, attaches media and exposes orders. It does **not**
deliver digital files to buyers. Shopify has no native digital-download product type, and
Shopify's own free Digital Products app exposes no API for attaching a file
programmatically.

`stagedUploadsCreate` plus `fileCreate` will put a file in the store's Files and hand back a
CDN URL, but that is a public link, not gated per-order delivery. It is not a solution.

So "publish a digital product to Shopify" is currently: create the product by API, then
attach the deliverable by some other means.

Three options were considered.

**A. Fanwise hosts delivery.** The Shopify product points at a Fanwise download link.
Fanwise listens for `orders/paid`, mints a signed expiring token, and gets the link to the
buyer.

**B. A third-party delivery app with an API.** Fileflare and similar expose REST endpoints
to upload an asset and attach it to a Shopify product ID. The merchant installs and pays for
that app.

**C. Assisted file step.** Fanwise creates the product with everything except the file. The
creator attaches it once in Shopify admin, guided by the same handoff pattern the assisted
channels already use.

---

## Decision

**Take option C now. Reconsider option B if customers ask for it. Do not build option A.**

Shopify is declared as an API channel that publishes automatically, with
`digitalFileUpload: false`.

```ts
capabilities: {
  automaticPublish: true,
  automaticUpdate: true,
  metrics: true,
  transactions: true,
  digitalFileUpload: false,   // Shopify has no API for this
  imageUpload: true,
  drafts: true,
}
```

**As implemented at A5, `metrics` and `transactions` are false.** They exist on Shopify, but
the steps that use them are B6 and B5, and `docs/channel-adapters.md` requires a capability
to be declared false until the step using it has arrived. The block above describes the
eventual shape. See the amendment.

This is the capability matrix working exactly as intended. It is not a workaround.

---

## Why

**Shopify is the channel Fanwise does not charge for.** Under the pricing model the owned
storefront is included at no channel charge. Building a delivery system, the most expensive
option on the list, for the one channel that generates no channel revenue is the worst
effort-to-return trade available in Gate A.

**The strategic case for option A is thinner than it looks.** The appeal is that Fanwise
becomes the delivery system of record and gets download analytics no marketplace would hand
over. But Etsy hosts its own files. Creative Market hosts its own files. Every marketplace
hosts its own files. Fanwise-hosted delivery would apply to exactly one channel type, owned
storefronts, which is also the type Shopify's own ecosystem already serves well. There is no
cross-channel leverage here, and the canonical-product thesis is about the **listing**, not
the bytes.

**Delivery is a solved, boring, high-stakes problem.** Getting it wrong means a buyer who
paid cannot download what they bought. That failure lands on the creator's reputation and
their support inbox, not on Fanwise's. Taking that liability on for free, in the first
gate, to save one manual step, is a bad trade.

**Option A also drags in a tail nobody has budgeted for:** transactional email or a
Shopify order-status extension, a token store, download caps and link-sharing abuse
controls, refund-triggered revocation, storage egress at bundle scale, and buyer email
addresses in Fanwise's database with the privacy obligations that follow. Each is tractable.
Together they are a product, not a feature.

**Option B is throwaway work if option A is never built,** which is the recommendation, and
it introduces a dependency in the critical path plus a second bill. "Fanwise is $9 a month
plus $6 a channel, and also install Fileflare and pay them" is a worse pitch than one manual
step. It also adds an install to onboarding, which is where activation goes to die.

**Option C costs almost nothing** because the assisted handoff component has to exist
anyway for Creative Market at step B3. Shopify reuses it for one field.

---

## What the creator experiences

After publishing to Shopify, the listing shows one outstanding step:

```
  SHOPIFY                                   Published, 1 step left

  Product created and live.       View in Shopify  ↗

  ⚠  Attach the download file
     Shopify has no API for digital files, so this step is
     manual, once per product.

     1  Download the deliverable      aster-grotesk.zip  [download]
     2  Open the product in Shopify   Products › Aster Grotesk  ↗
     3  Add digital attachment, upload the file

     [ Mark file attached ]
```

Honest about why, specific about what, and it takes about a minute. `channel_listings` keeps
`status_source = "verified"` for the listing itself, since the API confirmed it. The
outstanding work is a `listing_manual_steps` row with key `attach_digital_file`, which the
creator completes.

Fully published is therefore a derived condition, not a status value: published, and no
required manual step left incomplete. Do not report the product as live until it holds. A live Shopify
product with no deliverable attached is a product that can take money and give nothing back,
which is the one outcome worth engineering against.

---

## Consequences

**Good.** No delivery infrastructure, no buyer PII, no egress bill, no third-party
dependency, no extra install in onboarding. Gate A's exit test still passes: a real product
publishes, a second click creates nothing, and a buyer can actually download the file.

**Bad.** Shopify is not fully hands-off, which weakens the "automatic" story on the one
channel where a creator most expects automation, since it is their own store. Expect this to
come up in alpha.

**Neutral.** The decision is reversible in both directions. Option B is a contained addition
to the adapter later. Option A remains possible if direct storefronts become the dominant
channel and delivery becomes strategically worth owning.

---

## When to revisit

Any one of these should reopen it:

1. Shopify ships an API for digital file attachment. Check before starting A5 regardless;
   they ship changes here regularly.
2. Three or more alpha creators name the manual step as a real annoyance rather than a
   shrug. Then do option B, not option A.
3. Direct storefronts overtake marketplaces in Fanwise's connected-channel mix. Then owning
   delivery starts to earn its cost, and option A gets a real hearing.

---

## Verify before implementing

- Current Shopify behavior for digital products and whether any first-party API now exists.
- The Digital Products app's per-file size limit against realistic font and template bundles.
- Fileflare's API surface and pricing, so option B stays a known quantity if it is needed.

---

# Amendment, A5, 4 September 2026

Two changes on implementation. Neither reverses the decision; the first hardens it and the
second corrects a capability declaration.

## 1. The product is created as a draft, not live

This document's "What the creator experiences" sketch shows the Shopify product created and
live, with the file step outstanding, and reports it as "Published, 1 step left". Its own
normative text says the opposite two paragraphs later:

> A live Shopify product with no deliverable attached is a product that can take money and
> give nothing back, which is the one outcome worth engineering against.

The sketch engineers against that outcome with a label. A5 engineers against it with the
provider's own state:

```
publish()        Shopify product created with status DRAFT
                 listing.status = published, status_source = verified
                 manual step attach_digital_file, incomplete
                 Fanwise reports "Published, not live"

mark attached    productSet with the product identifier, status ACTIVE
                 manual step complete
                 Fanwise reports "Live"
```

The window in which a buyer can pay and receive nothing does not exist, rather than existing
and being labelled carefully. "Fully published is a derived condition" survives intact and is
now also true of the thing being described, not only of Fanwise's description of it.

Three consequences worth recording:

- **`drafts: true` becomes load-bearing.** It was previously a capability nothing used, and
  a capability nothing checks is a capability that can quietly become false.
- **Activation is a second external write**, so it carries its own idempotency key. It is a
  set-state operation rather than a create, so it is convergent by nature, but it goes
  through the same job row and the same guards as everything else.
- **The cost is one mutation.** That is the entire price of the change.

The creator-facing flow in the sketch is otherwise unchanged: same honesty about why, same
three steps, same download beside the step that needs it.

## 2. `metrics` and `transactions` ship false

The capability block above declares both true. A5 declares both false, because Fanwise has
not built the steps that read them — transactions at B5, metrics at B6 — and
`docs/channel-adapters.md` is explicit that a capability is false while the feature exists on
the provider but the step using it has not arrived.

The distinction matters and is worth keeping visible in the adapter: `digitalFileUpload` is
false because **Shopify cannot**, and these two are false because **Fanwise has not**. Only
the first is permanent.

## Re-verification

This ADR asks for Shopify's digital-product behaviour to be re-checked before A5 regardless.
Done on 4 September 2026 against shopify.dev and current third-party documentation:

- Shopify still has no first-party API for attaching a buyer-downloadable file, and no
  native digital-download product type.
- Shopify's own Digital Downloads app still exposes no public API.
- Fileflare still documents the REST surface option B would depend on, so option B remains a
  known quantity if it is ever needed.
- `2026-07` is the current stable Admin API version and is what the adapter pins.

The premise holds. Option C stands.
