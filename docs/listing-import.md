# Importing a live listing

The build plan for B12: pulling a listing a creator already sells on a connected channel
back into Fanwise, as a canonical product and a listing Fanwise did not compose.

**Status: planned 12 September 2026 at the founder's request. Not opened.** What opens it is
section 3. The decision it needs answered first is 29 in `docs/decisions/0002`.

---

## 1. What this is

Every path into Fanwise today starts with an empty product. The creator uploads files, types
or composes copy, connects a channel and publishes. That is the loop Gate A exists to close,
and it is the right first loop: it is the one that proves the product.

It is also the wrong first ten minutes for a creator who already sells. They have eleven
fonts on Etsy with descriptions they wrote, priced, tagged, with images they made. Asking
them to retype the eleventh one into a new tool to see whether the tool is any good is asking
them to do the work twice before they learn anything.

**Import is the arrow reversed.** Every adapter built so far maps Fanwise outward: canonical
product, channel draft, provider write. Import maps one listing inward: provider read,
channel listing, a canonical product proposed from it and confirmed by a person.

**The product has already promised this.** Since the first-run screen landed on 11 September
2026, every new workspace sees **Import a live listing** beside the primary action, disabled,
labelled *Coming soon*:

    components/onboarding/import-listing-action.tsx

That component takes `href: string | null` and `href` is the whole switch, deliberately, so
the day a route exists the page passes it and the control becomes a link. This file is what
is behind the promise. A promise with a disabled button and no plan is a promise that gets
either built badly in a hurry or quietly deleted.

---

## 2. Why this is not a channel step

B8, B9 and B10 each add a marketplace. B12 adds none. It needs no new `channels` row, no new
credential, no OAuth application, no marketplace approval, and it is billable to nobody: the
connection is the billing event and it already happened. A creator who imports thirty Shopify
listings has connected one channel and pays for one.

What it does add is a direction the adapter contract has never had. Reading a provider is not
new — Shopify reads the product before every write since `docs/channels/shopify.md` §15,
WooCommerce does the same in `readProduct`, Gumroad's spec reads back after enable — but
every one of those reads exists to check a write Fanwise is about to make, against an object
Fanwise created. None of them parses a stranger's listing into Fanwise's own model, and that
is the whole of B12's difficulty.

---

## 3. What opens this step

| Condition | Where it comes from | State on 12 September 2026 |
|---|---|---|
| Gate A passes | an outside creator, unassisted, empty workspace to three listings | not run |
| At least two `api` channels live | A5, A6 | true since 11 September 2026 |
| Decision 29 answered | `docs/decisions/0002` | open, recommendation written |
| Decision 21 answered, or B12 answers its own half | `docs/decisions/0002` | open, see section 10 |

**Gate A first, and this is the condition worth defending.** The first-run screen would
otherwise offer two doors of equal weight, and the door Fanwise is being built to prove is
the other one. Import is how a creator who already sells gets started faster; it is not how
anyone learns whether Fanwise composes a listing worth leaving up. Building the fast door
before the gate closes would mean the first honest test of the slow one never gets run,
because nobody would choose it.

Nothing else here is a schedule. If the founder wants B12 sooner, B8 is the precedent for
opening a step ahead of its gate, and the cost is stated above rather than hidden.

---

## 4. The one invariant this step leans on, and how it does not break it

Architecture invariant 1: the canonical product is the source of truth, and it never becomes
Shopify-shaped or Etsy-shaped. Publishing cannot break that rule, because it only ever reads
the canonical model and writes outward. **Import is the only step in the plan where a
marketplace's shape flows inward**, and what it flows into is the exact table the invariant
protects.

Four rules, and they are what the code review of this step should check first.

1. **The provider's payload never lands on `products`.** It lands in an `import` snapshot as
   it arrived, and on `channel_listings`, which is where channel-shaped values already live.
2. **Nothing reaches `products` without a person confirming it.** Import proposes a canonical
   product; the creator accepts it. An import that silently created a canonical record from a
   marketplace payload would make that marketplace the source of truth for that product
   forever, which is invariant 1 broken by a background job.
3. **No field is invented to hold a marketplace concept.** A value with no canonical home goes
   into `channel_listings.metadata` under its channel's key, or it is dropped — and a dropped
   field is named on the review screen rather than discarded silently. The creator is the only
   one who knows whether the thing Fanwise could not map mattered.
4. **`product_type` stays the coarse A2 enum.** A channel category maps into it through the
   adapter's own table, read backwards, and where the table has no answer the creator picks
   from the enum. A marketplace taxonomy never adds an enum member. `docs/data-model.md` A2
   says why, and import is the pressure it was written against.

---

## 5. The shape of one import

```
  IMPORT A LIVE LISTING

  Paste the listing's URL          [ https://www.etsy.com/listing/…        ]
                                                              [ Look it up ]
```

```
   ┌─ What Etsy has ───────────┐  ┌─ What Fanwise will store ────┐
   │ Kerf Display              │  │ Product   Kerf Display       │
   │ $24.00 USD                │  │ Type      font  ▾            │
   │ Digital download          │  │ Price     $24.00 USD         │
   │ 5 images                  │  │ Images    5, cover first     │
   │ Category  Craft Supplies  │  │ Listing   Etsy · published   │
   │           › Fonts         │  │ Deliverable  — you upload it │
   │ 13 tags                   │  │ Not mapped  occasion, holiday│
   └───────────────────────────┘  └──────────────────────────────┘
                                    [ Cancel ]  [ Import product ]
```

1. **Resolve.** The creator pastes a listing URL. Each adapter parses the URLs of its own
   provider and answers with an external listing id or a reason it cannot. A URL that matches
   no connected channel says so, naming the channels that are connected.
2. **Fetch.** The adapter reads the listing through the connection's credential, in a
   background job, and validates the response with Zod before anything looks at it. Rule 6
   and rule 7 both apply: an external response is validated, and a provider call does not run
   inside the interactive request.
3. **Propose.** A pure function per adapter maps the validated response to a channel listing
   draft plus a canonical product proposal, with an explicit list of what it could not map.
   Pure, so the whole mapping is unit-testable against recorded fixtures with no network.
4. **Review.** The creator sees both columns, edits the canonical side, and confirms. This is
   the screen rule 2 of section 4 exists for, and it is also where the sentence in section 7
   about the deliverable has to appear.
5. **Write, once.** One transaction: the product, the listing with its external id claimed,
   the `import` snapshot, and the image fetch jobs enqueued.
6. **Land somewhere honest.** The product page opens with readiness already computed. On an
   imported product it will say the deliverable is missing, because it is.

---

## 6. What the contract gains

```ts
interface ChannelAdapter {
  // …
  /** Present only where a listing can be read back and mapped inward. */
  import?: ChannelImport
}

interface ChannelImport {
  parseListingUrl(raw: string): ParsedListingRef | ParseFailure
  fetchListing(context: ImportContext): Promise<ImportedListing>
  toProposal(listing: ImportedListing): ImportProposal
}
```

One new capability key, `importListing`, with its label and its `CAPABILITY_ABSENCES` line,
which is typed per key so the consequence of not having it has to be written down before it
compiles. The honesty tests extend unchanged and in both directions: a declared capability
must have its method, an implemented method must be declared, and an assisted adapter may
never declare this one.

**URL parsing belongs to the adapter, and this is not a stylistic preference.** A regular
expression containing a marketplace hostname, living in a shared util so that one function
can recognise every channel's URLs, is a provider name outside `lib/channels/adapters` and
the tree test fails on it — correctly. The generic layer asks each connected adapter in turn
and takes the first that answers.

`ImportedListing` is channel-shaped and Zod-inferred. `toProposal` is the only place it
becomes Fanwise-shaped, and it is pure.

---

## 7. What import cannot bring, and must therefore say

**The deliverable.** This is the important one and it is easy to get wrong quietly.

| Channel | The file, on a read | Consequence |
|---|---|---|
| Shopify | none exists to read. ADR 0001: there is no digital-file API at all | the creator uploads it |
| WooCommerce | the product carries download URLs; whether the bytes are fetchable with the store credential is **[verify]** | assume not, until verified |
| Etsy | `listings/{id}/files` returns metadata; a download of the bytes is **[verify]** and probably absent | the creator uploads it |
| Gumroad | the product carries file URLs; fetchability **[verify]** | the creator uploads it |

The rule holds whatever those verifications say: **Fanwise never fabricates a deliverable,
and never marks one present that it has not measured.** An imported product has no
`deliverable` asset until the creator uploads one. Readiness says so, and Publish Everywhere
refuses the channels that require it, because the `asset` requirement counts only `ready`
rows and a fetched file is `pending` until a job has weighed it.

The honest sentence the review screen carries: *importing a listing you already sell does not
make it publishable somewhere else. Fanwise still needs the file.*

**Variants.** Fanwise is one product, one price. A listing with five variants is not a
Fanwise product, and flattening it to the first one would be Fanwise inventing a fact about
what the creator sells. Import refuses, names the variants it saw, and says the model does
not hold them yet. If that refusal turns out to be common, it is evidence for a variant
decision, and evidence is worth more than a silent flatten.

**Physical listings.** A shipped product is not a digital product. Whatever the channel's
signal is — `requiresShipping`, `is_digital`, a download-less Woo product — the import refuses
rather than importing a chair into a digital-product operating system. **[verify]** per
channel.

**Assisted channels can never import.** No read API exists for Creative Market, Behance,
Adobe Stock or MyFonts; their rows are `no` of the permanent kind. `importListing` is false
for them, no surface offers the action, and invariant 8 is satisfied the way it always is, by
the capability rather than by a hidden button. The thing that already exists for those
channels is mark submitted with URL capture, it writes `self_reported`, and it is not called
import — calling it that would put two very different claims behind one word.

---

## 8. Images

Fetched server-side into `product_assets` through the pipeline A2 already built: a row is
written `pending`, a job stores the bytes and measures them, checksums dedupe, and
derivatives are built per spec from `derived_from`. Nothing the provider says about size or
type is trusted, exactly as nothing the browser says is.

The provider's first image becomes `cover_image`; the rest become `preview_image` in the
provider's order. An image the fetch cannot retrieve is a failed asset row with a reason, not
a missing row: the creator needs to know which one to re-upload.

**Import is the first feature that could reach the storage ceiling**, which is decision 17
and unanswered. One import is bounded by the channel's own image maximum, which is small. A
creator importing thirty listings is not, and that is the case to watch rather than to solve
speculatively.

---

## 9. Idempotency, and the second import

The partial unique index on `(channel_id, external_listing_id)` already exists, and it is
what makes this cheap: a second import of the same listing loses at the database rather than
producing a second product. The claim is written in the same transaction as the listing row,
which is invariant 3 read for a step whose external call is a read.

**The second import is not an error.** The action catches the collision, reads the existing
listing and navigates to its product. "You already have this, here it is" is a destination.
A retried job, two tabs and a double-click all land in the same place.

What must never happen is the shape this index does not cover: two imports of *different*
listings that are the same product, producing two canonical products. V1 does not try to
detect that by cleverness. It warns when a product with a matching name or slug already
exists, and lets the creator cancel. Matching listings to products automatically is a
guess, and a wrong guess merges two products that a creator sells separately.

---

## 10. What the rows are allowed to claim

An imported listing is genuinely on the channel — Fanwise read it there — so `status` is
`published`, `status_source` is `verified`, `published_at` comes from the provider
(**[verify]** per channel; null where it does not give one), and `last_synced_at` is the read.

**Purchasable is read, never assumed.** A5's blocker is the whole lesson of this project on
that point: three Shopify products were ACTIVE, on no sales channel, and unbuyable, and
Fanwise was reporting them live. Import reads the same fact `publish` learned to read, and
where a provider does not expose it, the answer stays unknown and `liveness` keeps its
existing behaviour rather than claiming `live`.

**Import takes a photograph, not a subscription.** There is no polling, no scheduled re-read,
no drift detection, and no two-way sync. After the import the listing is an ordinary listing:
the creator edits it in Fanwise and `update` pushes it, on the channels that declare
`automaticUpdate`.

### The disconnection trap, which import makes worse before it makes it better

`disconnectChannelAction` refuses while any listing on a connection carries an external id.
That refusal is right for a listing Fanwise published: forgetting the row would strand a live
marketplace product with nothing pointing at it. Decision 21 is open precisely because
nothing can currently remove a listing from a channel, so publishing once makes a connection
permanent — and at C1, permanent means billed forever.

Import walks straight into it. A creator who imports eleven Etsy listings to try Fanwise out
would, under today's rule, be unable to disconnect Etsy again.

**But an imported listing Fanwise has never written to is the one case where forgetting is
honest.** Fanwise did not create the marketplace object, has not changed it, and deleting the
row restores the world to exactly what it was before the import. Nothing is stranded, because
nothing was ever attached.

So B12 either waits for decision 21, or it answers this much of it: **a listing that was
imported and never published or updated from Fanwise may be forgotten, and the refusal
applies to every other listing unchanged.** The flag that makes that decidable is
`metadata.import.writes === 0`, maintained by the publish and update paths rather than
computed after the fact. This is written into decision 21 in the register as a consequence,
not as a resolution.

---

## 11. Imported copy is not a fact

Invariant 5: AI may transform positioning, tone, phrasing and structure, and may never
introduce a factual claim absent from the FactSheet. The FactSheet is derived from the
canonical product.

Import is the first way for text nobody at Fanwise has ever validated to reach a canonical
field. If an imported description lands in `canonical_description`, then the next generation
for a different channel may restate every claim in it as fact — "236 glyphs", "includes a
commercial license", "works in every app" — and the validator will pass, because the claim is
in the FactSheet now. It got there from a marketplace.

**Recommendation, which is decision 29:** imported text lands on the channel listing it came
from, where it is copy for that channel and nothing more. The canonical product receives the
structured facts — name, price, currency, type — plus whatever copy the creator explicitly
accepts on the review screen, with the screen saying plainly that accepted text becomes
something Fanwise may restate elsewhere. The default on that control is off.

This is the cheapest possible answer and it holds the invariant. The expensive alternative —
running the factuality validator inward against an imported description — cannot work, since
there is no FactSheet to validate against until the product exists.

---

## 12. Data, migration and routes

No new table. Import writes rows the model already has.

- `snapshot_type` gains `import`. The provider payload is stored as it arrived, and it is
  immutable like every other snapshot. It is the only record of what the marketplace said on
  the day, and the answer to every later "where did this come from".
- `channel_listings.metadata.import` holds `{ importedAt, sourceUrl, unmappedFields, writes }`.
  `unmappedFields` is what the review screen showed as dropped; `writes` is section 10's
  counter.
- One migration, with the enum member and nothing else.
- One route, `/[slug]/import`, added to `routes` in `lib/routes.ts` **and** to
  `RESERVED_PRODUCT_SLUGS` in `lib/slug.ts` in the same commit, because a workspace's second
  path segment is the product-slug namespace and a collision there is a page nobody can
  reach.
- `components/onboarding/first-run.tsx` passes the href instead of `null`. That is the
  entire UI change on the first-run screen, which is what that component was built for.

---

## 13. What is not built

- **No bulk import.** One listing, one URL, one product. A catalog import is a different
  feature with a different failure mode — thirty products half-created — and no evidence yet
  asks for it.
- **No picker.** Listing a connection's recent listings to choose from is friendlier than
  pasting a URL and is a second read path with pagination, rate limits and its own empty
  state. It is the obvious V2 and it waits for someone to have used V1.
- **No sync, in either direction.** Section 10.
- **No import into an existing product.** Section 9.
- **No sales history.** That is B5 and it ingests transactions, not listings.
- **No CSV.** That is B7.
- **No import from a channel that is not connected**, and no channel connected for the
  purpose of reading only. Connecting is what bills; a read-only connection would be a second
  kind of connection and a billing question nobody has asked.

---

## 14. Testing

**Unit.** `parseListingUrl` accepts the URL shapes each provider actually uses and refuses
the rest, including a URL from a different marketplace. The Zod parse runs against recorded
fixtures of each provider's real response. `toProposal` maps a known listing to a known
proposal, refuses variants, refuses a physical listing, and reports unmapped fields rather
than dropping them. The capability honesty tests cover `importListing` in both directions.
The provider-name tree test covers the new files, which is the check that the URL patterns
stayed inside the adapters.

**Database.** A second import of the same listing collides on the partial unique index,
creates no second product and no second snapshot. The `import` snapshot cannot be updated or
deleted. Imported rows obey RLS: workspace B cannot read a product workspace A imported. The
disconnection rule behaves as section 10 settles it.

**Integration.** Each provider mocked at its read endpoint, including the failure cases that
matter: a listing that is gone, a listing on another shop, an expired credential, and a rate
limit.

**E2E, journey 15.** Added to `docs/testing.md` when this was planned. It is a genuinely new
path and not a variation of an existing one: it starts at a marketplace listing rather than
at an upload, and it is the only journey where a product enters Fanwise already sold
somewhere. B11 added no journey for the opposite reason, and the two arguments are the same
argument.

---

## 15. Exit test

A creator imports a listing **Fanwise did not create**, and publishes the imported product to
a second channel.

The clause in bold is the whole test. Importing a listing Fanwise published earlier reads
Fanwise's own shape back and proves only that the round trip closes. A listing composed by a
person outside this system, with their category, their tag habits, their line breaks and
their idea of a description, is what the mapping either survives or does not. The
WooCommerce store at `houseofproctor.com` and any real Etsy shop both qualify.

The run has to show, in order: the listing resolved from its URL, the proposal reviewed with
the unmapped fields visible, the product created with its images, readiness saying the
deliverable is missing, the file uploaded, and a second channel published with a live URL.
Then the same URL imported again, which opens the product that already exists and creates
nothing.

If the mapping needs hand-correction on every field, that is not a failing test, it is the
finding: import is worth less than it looks and the review screen is the product.

---

## 16. Open questions, to answer at build

1. Can a digital file's bytes be fetched on a read, on any of the four `api` channels?
   Section 7. The plan assumes no everywhere.
2. What is each provider's signal for "this is a digital product", and is it reliable enough
   to refuse on? Section 7.
3. Does each provider return a creation or publication timestamp on a read, and is it the
   marketplace's or the seller's? Section 10.
4. Is purchasability readable on each channel, or only on Shopify where A5 had to learn it?
5. What do the four read endpoints cost against each provider's rate limit, and does a single
   import take one call or several? Etsy's images and files are separate resources; Shopify's
   is one GraphQL query.
6. How does each provider represent a listing that is gone, and does the adapter's existing
   `external_object_missing` mapping already cover a read that was never a write?
7. What proportion of a real listing's fields actually map? Count it on the first import
   rather than estimating it here.
8. Does the review screen change anything a creator cares about, or do they accept the
   proposal unchanged every time? If they always accept, the screen is ceremony and the
   answer is a smaller confirmation; if they always edit, it is the feature.

---

## 17. What this changes elsewhere

- **`docs/roadmap.md`** gains B12 under Gate B, opening after Gate A passes.
- **`docs/testing.md`** gains journey 15, and the count in `CLAUDE.md` moves with it, as it
  did for journey 11.
- **`docs/decisions/0002`** gains item 29, and item 21 gains the consequence in section 10.
- **`docs/channel-adapters.md`** gains the import capability, when the step opens rather than
  now.
- **`docs/data-model.md`** gains the B12 section describing the snapshot member and the
  metadata shape.
- **A7 is untouched.** Publish Everywhere publishes what is in Fanwise and does not care how
  it arrived.
- **Gate A does not widen.** B12 is in Gate B and is not in the gate's exit test.
