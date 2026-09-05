# Channel spec: Shopify

The first real channel, and the only one Fanwise does not bill for: under the pricing model
one owned storefront is included in the $9 base. Everything here is written against the
GraphQL Admin API `2026-07`, verified against shopify.dev in September 2026.

Read `docs/decisions/0001-shopify-digital-delivery.md` first. This document assumes its
conclusion: **Shopify has no API for attaching a buyer-downloadable file**, so the file step
is assisted, and the adapter declares `digitalFileUpload: false`.

## 1. What the step proves

A5's exit test is three claims, and each maps to something in this file:

| Claim | Where it is answered |
|---|---|
| A real product publishes | §4 publish, §5 the mutation |
| A second click creates nothing | §7 idempotency |
| The file is actually deliverable to a buyer | §6 the draft gate |

## 2. Adapter definition

```ts
key: "shopify"
name: "Shopify"
integrationType: "api"

capabilities: {
  automaticPublish: true,    // productSet, implemented
  automaticUpdate: true,     // productSet with an identifier, implemented
  metrics: false,            // exists on the provider, arrives at B6
  transactions: false,       // exists on the provider, arrives at B5
  digitalFileUpload: false,  // does not exist on the provider at all
  imageUpload: true,         // files: [FileSetInput], implemented
  drafts: true,              // status: DRAFT, and load-bearing. See §6
}
```

Three of these are false, for two different reasons, and the difference matters.
`digitalFileUpload` is false because Shopify cannot do it. `metrics` and `transactions` are
false because Fanwise has not built the steps that use them; the capability rule in
`docs/channel-adapters.md` is that a capability is declared false when the feature exists but
the step using it has not arrived.

**This is a deliberate departure from the code block in ADR 0001**, which showed `metrics`
and `transactions` as true. That block described the eventual shape, not A5's. Declaring
them true now would have the UI offer a sales report that does not exist.

## 3. Canonical product to listing field map

| Fanwise | Shopify | Notes |
|---|---|---|
| `canonical_title` or `name` | `title` | Max 255 |
| `canonical_description` | `descriptionHtml` | Plain text is wrapped in paragraphs, §8 |
| `short_description` | `seo.description` | Truncated at 320 |
| `base_price` | `variants[0].price` | Money, string-encoded |
| `currency` | — | Not settable per product. The shop's currency wins, §12 |
| `product_type` | `productType` | Coarse Fanwise type, title-cased |
| `brand_name` | `vendor` | Falls back to the workspace name |
| `slug` | `handle` | Shopify uniquifies a collision itself |
| `cover_image` asset | `files[0]` | `FileSetInput`, `contentType: IMAGE` |
| `deliverable` asset | **nothing** | No API exists. §6 |

`currency` is the one field that does not survive the trip, and it is worth stating plainly
rather than discovering later: Shopify prices are always in the shop's own currency, so a
listing priced in EUR published to a USD shop becomes a USD number of the same magnitude.
The adapter therefore records the shop currency on the connection at OAuth and raises a
warning-severity requirement when the two disagree.

## 4. Requirements

Severity is what the channel actually enforces, not what would be nice. An `error` means
Shopify rejects it or Fanwise cannot proceed; a `warning` means it publishes and is worse
for it.

| Key | Rule | Severity | Why |
|---|---|---|---|
| `title` | 3–255 chars | error | Shopify rejects an empty title and truncates past 255 |
| `price` | set, ≥ 0 | error | A digital product with no price is not a product |
| `deliverable` | ≥ 1 ready `deliverable` or `archive` asset | error | §6: there must be a file to hand over |
| `description` | ≥ 40 chars | warning | Shopify accepts an empty description. Buyers do not |
| `cover_image` | ≥ 1 ready `cover_image` asset | warning | Publishes without one, sells badly |
| `tags` | ≤ 250 tags, ≤ 255 chars each | error | Hard Shopify limits, rejected above them |
| `vendor` | set | warning | Falls back to the workspace name, so never blocks |
| `currency_matches_shop` | listing currency = shop currency | warning | §3. Custom rule |

`deliverable` is the interesting one. Shopify itself does not require a file, so on a literal
reading it should be a warning. It is an error because the *channel as Fanwise implements it*
requires one: the manual attach step in §6 is unperformable without a file, and a Shopify
product that can take money with nothing behind it is the outcome ADR 0001 names as the one
worth engineering against.

## 5. The publish call

One mutation, `productSet`, run synchronously. Product, variant, price and image in a single
external write, which keeps the number of moments at which a provider object can come into
existence at exactly one.

```graphql
mutation FanwiseProductSet($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
  productSet(identifier: $identifier, input: $input, synchronous: true) {
    product { id legacyResourceId handle status onlineStoreUrl }
    userErrors { field message code }
  }
}
```

`identifier` is omitted on the first publish and carries `{ id }` on every subsequent call.
That is what makes a retry converge rather than duplicate: with an identifier, `productSet`
is an update.

The variant is the Shopify single-variant convention, one option named `Title` with the value
`Default Title`, and the digital shape is set on the inventory item:

```
productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }]
variants: [{
  optionValues: [{ optionName: "Title", name: "Default Title" }],
  price: "48.00",
  taxable: true,
  inventoryItem: { requiresShipping: false, tracked: false },
}]
```

`requiresShipping: false` is not cosmetic. Left true, Shopify asks the buyer for a shipping
address and may apply a shipping rate to a font.

**Unverified against a live shop.** Every shape above comes from shopify.dev, not from a
2xx. The Partner account was still pending when A5 was written, so `productSet` is exercised
against a recorded fake in tests and nothing else. §13 is the list of what a live shop has to
confirm.

## 6. Digital delivery, and the draft gate

Per ADR 0001 the deliverable is attached by hand, once per product, in Shopify admin.

Fanwise makes that safe rather than merely documented:

```
publish()            product created with status DRAFT
                     listing.status = published, status_source = verified
                     manual step attach_digital_file, incomplete
                     Fanwise reports "Published, not live"

mark attached        productSet identifier:{id} status ACTIVE
                     manual step complete
                     Fanwise reports "Live"
```

The product is not purchasable until the creator confirms the file is on it. The window in
which a buyer can pay and receive nothing does not exist, rather than existing and being
warned about.

**This refines ADR 0001's UI sketch**, which showed the product created live with the file
step outstanding. The ADR's own normative text asks for the opposite — "do not report the
product as live until [no required manual step is incomplete]" — and creating the product as
a draft is the reading that satisfies it structurally instead of by label. The ADR carries an
amendment recording the change.

It also makes `drafts: true` load-bearing. A capability that nothing uses is a capability
nobody checks.

## 7. Idempotency

Three checks before any external create, in the order `docs/architecture.md` fixes them:

1. `channel_listings.external_listing_id` is already set → the product exists, nothing to
   create.
2. A `publication_jobs` row with this idempotency key already succeeded → return its result.
3. The key itself is unique in the database, so the second insert loses.

The key for a publish is derived from `(workspace, listing, kind)` and deliberately **not**
from the listing content: two clicks of Publish on the same listing are the same operation
whatever was typed between them. An update's key includes a content fingerprint, because two
different edits are two different operations.

A failed job is retried on its own row, incrementing `attempt_count`. It is not a new row,
because it is not a new operation.

## 8. Description transform

`canonical_description` is plain text. Shopify expects HTML in `descriptionHtml`, so blank
lines become paragraph breaks and everything else is escaped. No Markdown, no sanitizer, no
rich text: the canonical record does not hold any, and inventing structure the creator did
not write is exactly the kind of thing the factuality rule exists to prevent elsewhere.

## 9. OAuth

Standard Shopify authorization code grant against the shop domain the creator types.

- The shop domain is validated against `^[a-z0-9][a-z0-9-]*\.myshopify\.com$` before it
  reaches a URL. A shop domain is a hostname Fanwise is about to redirect a person to and
  then send a client secret to, so it is checked, not trusted.
- `state` is a single-use row in `channel_oauth_states` with a five-minute expiry, not a
  cookie. It records the workspace, the user and the shop the flow started against, so the
  callback cannot be replayed, cannot be bound to a different workspace, and cannot be
  pointed at a different shop.
- The callback's HMAC is verified with the client secret **before the parameters are used**,
  per `docs/security.md` rule 5, using a timing-safe comparison.
- The access token is offline (permanent). It is sealed by the credentials service and
  written to `channel_connection_secrets`. It never reaches `channel_connections`, a log
  line, an error message, or the browser.

Scopes requested: `write_products`, `read_products`. Nothing else. `read_orders` arrives at
B5 with transaction ingestion and will force a re-authorization, which is correct: a creator
should be asked again when the ask changes.

## 10. Rate limits

Cost-based, 100 points per second on Standard. `productSet` is a mutation and cheap relative
to that ceiling for one product at a time. The client reads
`extensions.cost.throttleStatus` and retries a `THROTTLED` response after the documented
restore interval, with a bounded number of attempts. It does not implement a token bucket:
A5 publishes one product per click, and B-gate bulk work is where a bucket earns its keep.

## 11. Error normalization

Nothing provider-shaped reaches the creator. `userErrors`, GraphQL `errors`, HTTP status and
transport failures are all mapped to a `NormalizedError` carrying a code, a readable message
and a `retryable` flag. The raw response is persisted on the `publication_jobs` row so the
original is recoverable, and is never rendered.

| Provider signal | Code | Retryable |
|---|---|---|
| 401, or `invalid_token` | `credentials_invalid` | no |
| 403, missing scope | `permission_denied` | no |
| 429, or `THROTTLED` | `rate_limited` | yes |
| `userErrors` non-empty | `validation_rejected` | no |
| 404 on an identifier | `not_found` | no |
| 5xx | `provider_unavailable` | yes |
| socket, DNS, timeout | `network` | yes |

## 12. Data written

- `channels` — one row, `shopify`, `billable = false`.
- `channel_connections` — `external_account_id` is the shop domain,
  `external_account_name` the shop's display name, `metadata` the shop currency and plan.
- `channel_connection_secrets` — the sealed offline access token, with `key_version`.
- `channel_listings` — `external_listing_id` is the product GID,
  `external_url` the admin product URL, `status_source = verified`.
- `publication_jobs` — one row per logical publish, carrying the idempotency key.
- `listing_manual_steps` — one row, `attach_digital_file`.
- `listing_snapshots` — one `publish` snapshot per successful publication.

## 13. Open questions to resolve against a live shop

Nothing below is a guess about intent; each is a shape that only a 2xx can confirm.

1. `productSet` with `productOptions` + `variants` on a brand new product: confirm the
   default-variant convention is accepted and no second mutation is needed for price.
2. `InventoryItemInput.requiresShipping: false` on a `productSet` variant: confirm it is
   honored at creation rather than only on update.
3. `files: [FileSetInput]` with a Supabase signed URL: **answered, 5 September 2026.** A
   publish against a publicly reachable Supabase project put the image on the product, so the
   async fetch does complete inside the signed URL's TTL. The earlier failure was
   environmental: the URL pointed at a local Supabase that Shopify cannot resolve. Media state
   at the moment `productSet` returns is still not asserted on, because nothing needs it — §5
   reads media before the next write instead. Earlier note, kept because the failure mode it
   describes is real: **partly answered, 5 September 2026.** A real publish produced a
   product with no image. The cause on that run was environmental rather than the TTL — the
   signed URL pointed at a local Supabase, which Shopify cannot resolve — so the TTL
   question is still open and needs a publicly reachable storage host to answer. What the
   run did settle is that a fetch failure is invisible: `productSet` returns success, the
   response carries nothing about media, and the product is simply imageless. §5 now reads
   the product's media before writing and re-sends `files` when Shopify holds none, so the
   state is repairable rather than permanent. Whether the fetch succeeds against a public
   URL inside the TTL remains untested.
4. `onlineStoreUrl` on a DRAFT product: expected null, so §12 stores the admin URL. Confirm
   it populates on activation, and whether it is worth a second read.
5. The exact `code` values on `ProductSetUserError`, so §11's `validation_rejected` messages
   can name the offending field rather than repeating Shopify's sentence.
6. Whether an unlisted app install without App Store review grants `write_products` in full,
   which is the alpha path named in `docs/channel-feasibility.md`.
