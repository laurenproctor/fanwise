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
| `seo_title`, then `title` | `seo.title` | Truncated at 70, §14 |
| `seo_description`, then `short_description` | `seo.description` | Truncated at 320, §14 |
| `base_price` | `variants[0].price` | Money, string-encoded |
| `currency` | — | Not settable per product. The shop's currency wins, §12 |
| `product_type` | `productType` | Coarse Fanwise type, title-cased |
| `category` | `category` | A Standard Product Taxonomy id, §14 |
| `brand_name` | `vendor` | Falls back to the workspace name |
| `slug` | `handle` | Shopify uniquifies a collision itself |
| `cover_image`, then `preview_image` assets | `files` | `FileSetInput`, `contentType: IMAGE`, cover first |
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
| `category` | one of the labels in §14 | warning | Shopify creates a product with no category |
| `seo_title` | ≤ 70 chars when set | warning | Optional. Empty means "use the title", §14 |
| `seo_description` | ≤ 320 chars when set | warning | Optional. Empty means "use the short description", §14 |

The last two are the first `optional` text rules in the project. An empty value
satisfies them, and the bounds apply only to a value that is set: leaving a meta
title blank is the ordinary case and has a documented fallback, so a rule that
complained about it would put a permanent warning on almost every listing. They
are rules rather than nothing at all because the editor derives its character
counters from the requirement specs, and a field with no rule gets no counter.

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

**Every write against an existing identifier reads the product first**, and the read has
three questions in it rather than the two it started with. Which images Shopify is holding.
Whether the product is on sale. And, underneath both, whether the product is there at all.

That third one is why the read is now unconditional. It used to be skipped when the listing
had no images to repair and a recorded external state to trust, which is how a product
deleted in the Shopify admin stayed invisible: Fanwise went on holding the id and the admin
URL, `productSet` failed against a dead identifier in a different and less intelligible way
each time, and nothing in the product ever said the plain thing. `product: null` from a
query that succeeded is Shopify confirming the object is gone, and it is normalized to
`external_object_missing` — a code distinct from `not_found` precisely because the runner
acts on it by changing the listing. See §15.

An update preserves whether the product is on sale, and it does not infer that from
absence. `listing.metadata.externalState` is used when it says something; when it says
nothing — a listing published before Fanwise wrote that field, or one a rebuild blanked —
the adapter reads the product's own `status` and sends it back unchanged, ARCHIVED
included. A status it cannot read is refused rather than defaulted: sending DRAFT because
a read came back empty would take a live product off sale, which is the failure the whole
arrangement exists to prevent.

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
                     publishablePublish onto the Online Store publication
                     resourcePublicationsCount read back and asserted
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

The key for a publish is derived from `(workspace, listing, kind, generation)` and
deliberately **not** from the listing content: two clicks of Publish on the same listing are
the same operation whatever was typed between them. An update's key includes a content
fingerprint, because two different edits are two different operations.

`generation` is `channel_listings.publish_generation`, and it is the one thing allowed to
make a second Publish a new operation. It moves only where the provider has confirmed the
product Fanwise created no longer exists, which means it cannot move on a failure, on a
timeout, or on a guess. Within a generation the check is exactly as strong as it was.

It is on `publication_jobs` as well, because the runner's second guard asks whether a
publish for this listing has already succeeded, and the honest version of that question is
"at this generation". Without it the guard would go on skipping the re-publish the new key
just made possible.

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

Scopes requested: `write_products`, `read_products`, `read_publications`,
`write_publications`. Nothing else. `read_orders` arrives at B5 with transaction ingestion
and will force a re-authorization, which is correct: a creator should be asked again when the
ask changes.

The two publication scopes arrived with ADR 0004 and are a pair rather than a choice:
`publishablePublish` needs the write half, and finding *which* publication is the Online
Store needs the read half first, because a publication cannot be published to before it is
enumerated and its id is per shop.

**Fanwise drives its own re-authorization**, because it runs its own authorization code grant
rather than Shopify's managed installation — Shopify's "merchants approve new scopes the next
time they open the app" does not apply here and nothing prompts anybody on Fanwise's behalf.
So `channel_connections.scopes`, which had been written at every authorization and read by
nothing, is now compared against what this build asks for — **not by plain membership**.
Shopify treats `write_x` as implying `read_x` and collapses the pair in what it grants back:
the live connection, authorized for `write_products,read_products`, stored exactly one entry,
`write_products`. Compared literally, `read_products` reads as missing on a connection that
holds it, and reconnecting cannot fix that because the provider will never return the entry.
The rule lives on the adapter (`ChannelOAuth.holdsScope`) rather than in shared code, because
the next provider's will differ. It runs one way only: holding `read_x` is not holding
`write_x`. A connection that is short gets a
**Reconnect** on the channels card and a refusal before any call rather than a 403 at the end
of an activate. Reconnecting upserts on the same account and keeps the connection id, so the
listings hanging off it are untouched; a stored list that is *empty* means the column was
never populated for that row and is left alone, because forcing every such creator through a
reconnect to fix a problem most of them do not have is the more expensive mistake.

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
| `product: null` from a successful state read | `external_object_missing` | no |
| 5xx | `provider_unavailable` | yes |
| socket, DNS, timeout | `network` | yes |

The last two rows of the first half are not the same answer said twice, and the
difference is load-bearing rather than descriptive. `not_found` covers everything a
404 can mean: a store that has closed, an app that has been uninstalled, a request
that was never right. `external_object_missing` means one thing only — Shopify was
reached, was asked about this product id, and answered that there is no such product.

It is the only code the runner responds to by changing the listing, which is why it
is raised solely from a successful read and never inferred from a failure. Clearing
a listing's external id on a transient error would publish a second product the next
time the creator clicked, which is the duplicate §7 exists to prevent.

## 12. Data written

- `channels` — one row, `shopify`, `billable = false`.
- `channel_connections` — `external_account_id` is the shop domain,
  `external_account_name` the shop's display name, `metadata` the shop currency and plan.
- `channel_connection_secrets` — the sealed offline access token, with `key_version`.
- `channel_listings` — `external_listing_id` is the product GID,
  `external_url` the admin product URL, `status_source = verified`. `publish_generation`
  is incremented, and every one of those fields cleared, when a product is found deleted.
- `publication_jobs` — one row per logical publish, carrying the idempotency key.
- `listing_manual_steps` — one row, `attach_digital_file`.
- `listing_snapshots` — one `publish` snapshot per successful publication.

## 13. Open questions to resolve against a live shop

Nothing below is a guess about intent; each is a shape that only a 2xx can confirm.

1. `productSet` with `productOptions` + `variants` on a brand new product: **answered,
   6 September 2026.** Accepted. The live products carry one variant, option `Title` with
   value `Default Title`, and a price set by the same mutation. No second mutation.
2. `InventoryItemInput.requiresShipping: false` on a `productSet` variant: **answered,
   6 September 2026.** Honored at creation. A product created and never updated since reads
   `requiresShipping: false` and `tracked: false`, so no buyer is asked for a shipping
   address on a font.
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
   the product's media before writing and re-sends `files` when Shopify is holding fewer
   usable images than the listing sends, so the state is repairable rather than permanent.
   That comparison replaced "when Shopify holds none" on 6 September 2026: the older rule
   repaired a product with no image but froze one that had one, so a product created before
   Fanwise sent more than the cover could never receive the rest of its images. Whether the fetch succeeds against a public
   URL inside the TTL remains untested.
4. `onlineStoreUrl` on a DRAFT product: **answered 6 September 2026, and closed by ADR 0004
   on 7 September.** §16 is what the adapter does about it; the note below is what the run
   found.

   **answered, 6 September 2026, and not as expected.**
   It is null on ACTIVE products too. §12's decision to store the admin URL is right, and for
   a stronger reason than anticipated: there is no storefront URL to store, because
   `status: ACTIVE` does not put a product on a sales channel. Both live products read
   `publishedAt: null`, meaning they are on none, so no buyer can reach them.

   This adapter cannot change that. `productSet` sets status, not channel publication, which
   needs `publishablePublish` and a publications scope this app does not request. See the
   blocker note in `docs/roadmap.md`: it decides whether Fanwise publishes to a sales channel
   or declares it a manual step, and until it is decided the UI must not say a product is
   available to buy.
5. The exact `code` values on `ProductSetUserError`, so §11's `validation_rejected` messages
   can name the offending field rather than repeating Shopify's sentence.
6. Whether an unlisted app install without App Store review grants `write_products` in full,
   which is the alpha path named in `docs/channel-feasibility.md`.
7. `ProductSetInput.category` with a taxonomy id from §14's table. The ids are checked
   against Shopify's published taxonomy, not against a 2xx, and a shop pinned to an older
   taxonomy release is the case that would reject one. What the run has to confirm is which
   way it fails: a `userErrors` entry naming the field, which the creator can act on, or a
   silently ignored input, which they cannot.
8. `seo.title` on `productSet`. `seo.description` has been sent since the first publish and
   is known to be accepted; the title half has not.
9. Whether `product(id:)` returns null rather than erroring for an id that was deleted
   rather than never existing. §15 depends on it, and it is asserted against a recorded
   fake. A GraphQL error instead of a null would normalize to `unknown` and leave the
   listing stuck in exactly the way §15 was written to end — visibly, at least, rather than
   silently.

## 14. Category, product type, and the two SEO fields

Three fields on a Shopify product that Fanwise was not filling, and one of them was not
being filled because it was being confused with another.

### Category is not product type

Shopify has two fields that look like a category and only one of them is:

| Field | What it is |
|---|---|
| `productType` | Free text. No taxonomy, no validation, whatever the merchant types |
| `category` | An id from Shopify's Standard Product Taxonomy. The field the admin labels **Category** |

The adapter sent only the first, derived from `listing.category`, so every product Fanwise
created arrived in Shopify with the Category field empty. That is not cosmetic: `category`
is what drives Shopify's category-specific attributes, its category fields and its product
feeds.

Both are sent now, from different sources. `productType` comes from the canonical
`product_type`, title-cased, which is what it always meant. `category` comes from
`listing.category`, which is now a Shopify taxonomy label rather than a Fanwise slug.

### Why a curated table rather than the taxonomy

The taxonomy has roughly 14,000 categories, almost all of them describing physical objects.
Offering a creator who sells fonts the whole tree would be worse than offering none of it,
so `lib/channels/adapters/shopify/categories.ts` holds the leaf set a digital product can
honestly sit in, and nothing else:

| Fanwise `product_type` | Default label | Taxonomy id |
|---|---|---|
| `font` | Fonts | `so-2-5` |
| `template`, `mockup` | Document Templates | `so-2-4` |
| `graphic`, `illustration`, `brush`, `three_d` | Digital Artwork | `so-2-3` |
| `photo` | Stock Photographs & Video Footage | `so-2-6` |
| `icon` | Computer Icons | `so-2-1` |
| `theme` | Web Design Software | `so-1-10-10` |
| `other` | Digital Goods & Currency | `so-2` |

The picker offers those plus Desktop Wallpapers, SVG & Cut Files, Photo Editing Presets &
LUTs, E-Books, Printables, Sheet Music, Digital Music Downloads, Video Digital Downloads,
Online Courses and Digital Video Games.

Every id was checked against the published `v2026-05` taxonomy, the release preceding the
`2026-07` Admin API version this adapter is pinned to, and against `unstable`.

`channel_listings.category` holds the **label**, not the id. The label is what the creator
picked, what the editor renders and what a snapshot records; the id is a Shopify
implementation detail with no business in a column shared with every other channel. The
risk that buys is drift between a label and its id, and a unit test closes it: every label
the picker offers must resolve, and every product type's default must be a label the picker
offers.

A label that does not resolve sends **no** `category`, which is not the same as sending
null. `productSet` leaves an omitted field alone and overwrites a supplied one, so clearing
the category because a label drifted here would turn a naming problem into data loss on a
category the creator set in the Shopify admin.

### The SEO pair

`seo` has two halves and the adapter was sending one of them, derived from
`short_description`. There was no meta title at all, and no way to make the search result
read differently from the product blurb.

Both are now real listing fields, `seo_title` and `seo_description`, and both are
**overrides**. Left empty they fall back to the listing title and the short description
respectively, which is the behaviour that existed before them plus the half that was
missing.

Empty is sent as absent rather than as `""`. Shopify stores a blank and stops deriving the
field from the product, so a creator who never touched these would end up with a search
result that has no title at all.

Truncation is at 70 and 320, the two numbers Shopify's own admin counts to. Neither is
enforced by the Admin API — an overlong value is accepted and then cut off in a search
result, where the creator will never see it happen — so the adapter cuts it where they were
already warned it would be cut.

## 15. A product that is gone

A creator deleted a product in the Shopify admin. Fanwise went on holding its id and its
admin URL, the URL returned Not Found, and there was no way back.

Everything that made a second click safe worked against them. The publish key was claimed,
so a fresh Publish collided and reported "already published". The runner's second guard
found an earlier succeeded publish job and skipped. And no write said anything a creator
could act on, because each one failed differently against the dead identifier.

The fix has three parts and each is deliberately narrow:

1. **The adapter notices.** §5's pre-write read is unconditional, and `product: null` from a
   successful read is normalized to `external_object_missing`.
2. **The listing stops claiming otherwise.** `runPublication` clears `external_listing_id`,
   `external_url`, `last_sent_fingerprint` and the `externalState` metadata, returns the row
   to `draft` / `self_reported`, and increments `publish_generation`. `published_at` stays:
   it is history, and the listing *was* published. The snapshots describing that publication
   are immutable and are not touched.
3. **Publish works again**, because §7's generation makes it a genuinely new operation
   rather than a repeat the key refuses.

**It does not re-create the product.** A product is usually gone because somebody deleted it
on purpose, and quietly putting it back would overrule that decision with a background job.
The creator is told what happened, in the card's own error line, and the button is theirs to
press.

## 16. The sales channel

ADR 0004. **`status: ACTIVE` does not make a product purchasable**, and A5's exit test found
three products that proved it: active, `publishedAt: null`, on no sales channel, no
storefront page, no buyer able to reach them. Status and channel publication are separate
facts on Shopify, `productSet` sets only the first, and Fanwise was reporting the result as
"Live".

`activate` now does both, in this order:

```
productSet identifier:{id} status ACTIVE      the status half, and it converges
publications                                  which channel is the Online Store
publishablePublish id input:[{publicationId}] the placement half
  → resourcePublicationsCount asserted        the answer, not the absence of errors
```

The status write goes first deliberately. `productSet` with an identifier is an update, so a
retry after a failed placement costs nothing and changes nothing. If the placement then
fails, the product is ACTIVE and unreachable — which the listing now describes accurately
instead of describing as live.

**The count is what decides, not the empty `userErrors`.** A publication the product could
not be added to, for a reason Shopify expresses as something other than a userError, would
otherwise be reported to the creator as "Live". The whole of this section exists because a
mutation reported success about a fact nobody checked.

### Which publication, and when the adapter refuses

Harder than it should be. On `2026-07` both obvious identifiers are deprecated:

| Field | State |
|---|---|
| `Publication.name` | deprecated |
| `Publication.app` | deprecated |

What is left is `Publication.channels` and `Channel.handle`, documented as "a unique,
human-readable identifier for the channel within the shop" — with no statement anywhere on
shopify.dev of what the Online Store's handle actually is. `online_store` is a convention
this adapter relies on and does not trust.

So `resolvePublication` returns one of three outcomes and the third is the point:

| Outcome | When |
|---|---|
| matched | exactly one publication's channel handle looks like the Online Store |
| only | the shop has exactly one publication, so there is nothing to be ambiguous about |
| **refused** | neither — several channels and no match, or more than one match |

A refusal is a `validation_rejected` telling the creator to publish it in Shopify themselves.
The alternative is putting a font on Point of Sale, or into a wholesale catalog with its own
price list, because a handle this adapter guessed at did not match — on a channel the creator
may not know they have. An error someone can act on beats a product quietly appearing
somewhere nobody asked for.

`autoPublish` is read and recorded on the job row, and deliberately **not** acted on. It
would be reasonable to skip the publish call for a publication that auto-publishes, and it is
not skipped: it is the merchant's setting, it can change between one publish and the next,
and publishing something already published is the cheaper of the two ways to be wrong.

### What the listing records

`PublishResult.purchasable`, persisted to `channel_listings.metadata.purchasable`, and read
by `liveness`. Three values and all three are meant:

| Value | Meaning |
|---|---|
| `true` | the channel confirmed the product sits on at least one publication |
| `false` | it does not, so `liveness` withholds `live` |
| absent | nothing established it — every listing published before this, and every channel with no such concept |

Absent is **not** false. Rendering it as false would report every listing on every other
channel as unbuyable in order to fix this one.

It is separate from `externalState` because `externalState` cannot answer it. That field
records the provider's own status, and it has to: `update()` reads it back to decide whether
to send ACTIVE or DRAFT, which is what stops an ordinary edit taking a live product off sale.
One field cannot mean both "the object is active" and "a buyer can reach it" on a provider
where those come apart, and this is a provider where they do.
