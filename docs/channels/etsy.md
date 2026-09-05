# Channel spec: Etsy

The second real channel, the first **billable** one, and the first that can receive the
buyer's file through its own API. Written against Etsy Open API v3, verified against
developers.etsy.com in September 2026.

Read this before writing any A6 code. Etsy differs from Shopify in four ways that each cost
a migration or a service if they are discovered during implementation rather than before it:
PKCE, expiring tokens, a required category taxonomy, and a rate limit that is shared across
every Fanwise customer at once.

> **A6 has not started.** This document is step 1 of "Adding a channel" in
> `docs/channel-adapters.md`, written while the Etsy applications sit in a queue. Nothing
> here is implemented, and no line of it should be taken as describing code that exists.

## 1. The dependency that decides the schedule

A6 cannot be finished without **Etsy commercial access**, which is a discretionary upgrade
request with no published SLA. Applicants report waiting weeks to over a month.

`docs/roadmap.md` still records both Etsy applications as *in progress, none confirmed
submitted*. Until they are filed, the calendar cost of A6 is unbounded and unknowable, and
every hour of implementation is an hour spent ahead of an approval that may not come.

**File before writing code**, and record the real submission dates in the roadmap table.

### 1a. Three tiers, not two, and the order is a scheduling decision

The roadmap's dependency table lists two Etsy rows. There are actually three tiers, and they
are sequential rather than parallel:

| Tier | Scope | Approval |
|---|---|---|
| **Seller app** | Your own shop only | **Minutes, no manual queue** |
| **Personal app** | Beyond your own shop, limited scale | Deeper review |
| **Commercial access** | Many sellers via OAuth consent | Longest; requires an approved personal app |

Commercial access cannot be requested until a personal app is approved, so the slow clock
does not start until the medium one finishes. Both are queues; neither is instant.

**Register a seller app as well, and first.** It is approved in minutes, it reaches every
public and OAuth-authenticated endpoint, and it uses the same OAuth 2.0 + PKCE flow — the
only restriction is which shop may consent. So A6 can be built and its exit test run against
your own development shop on a seller app, faithfully, while the personal and commercial
reviews sit in their queues. The multi-tenant code path is identical; a seller app simply
means the only seller who can authorize is you.

That turns Etsy's approval latency from a blocker into a background process, which is the
single most valuable thing this section has to say.

The commercial access application also has to answer a ToS clause aimed squarely at products
like this one: Etsy bars apps that "charge Etsy sellers a fee for features Etsy provides
free", and Etsy's listing manager is free. The defensible answer is that Fanwise charges for
cross-channel canonical catalog management, not for Etsy listing creation. Make that argument
explicitly in the application. Describing Fanwise as an Etsy listing tool invites a refusal.

## 2. Adapter definition, proposed

```ts
key: "etsy"
name: "Etsy"
integrationType: "api"

capabilities: {
  automaticPublish: true,
  automaticUpdate: true,
  metrics: false,           // exists; B6 has not arrived
  transactions: false,      // exists; B5 has not arrived
  digitalFileUpload: true,  // uploadListingFile. THE difference from Shopify
  imageUpload: true,        // uploadListingImage
  drafts: true,             // listings are created as drafts and activated
}
```

`digitalFileUpload: true` is the headline. Etsy hosts the buyer's file itself, so **A6 has
no manual step**: `manualSteps` is empty, nothing gates activation, and ADR 0001's assisted
handoff does not apply here at all. The capability matrix earns its keep — two api channels,
one of which needs a human and one of which does not, and the UI derives that difference
rather than being told it.

## 3. OAuth, and the three things it forces

Etsy's OAuth is not Shopify's, and each difference has a consequence in Fanwise.

| | Shopify (A5) | Etsy (A6) |
|---|---|---|
| PKCE | not used | **required**, `S256` |
| Redirect URI | `http://localhost` allowed | **HTTPS only** |
| Access token | offline, does not expire | **1 hour** |
| Refresh token | none | **90 days** |

- Authorize: `https://www.etsy.com/oauth/connect`, with `response_type=code`, `client_id`,
  `redirect_uri`, `scope` (space separated), `state`, `code_challenge`,
  `code_challenge_method=S256`.
- Token: `POST https://api.etsy.com/v3/public/oauth/token`, grant types `authorization_code`
  and `refresh_token`.
- Scopes: `listings_r`, `listings_w`. `transactions_r` arrives at B5 and will force a
  re-authorization, which is correct.

**Every request carries `x-api-key` as well as the bearer token.** The header holds the
application's keystring and is required on top of `Authorization: Bearer`, independent of it.
This has no analogue in the Shopify adapter, which sends one header and nothing else, so it
is exactly the kind of thing a developer copying A5's client will omit. It is reported as the
single most common cause of unexplained 401s on Etsy v3. Put it in the client from the first
line rather than discovering it against a live shop.

### 3a. `channel_oauth_states` needs a `code_verifier` column

A5 created that table without one, deliberately, and recorded that A6 would add it. PKCE
requires generating a verifier at authorization time and presenting it at exchange, so it has
to be persisted between the two, in the same single-use row that already holds the workspace,
the user and the account hint. That is a migration, and it is the first thing A6 writes.

### 3b. HTTPS breaks the local development loop

Etsy refuses a plain `http://localhost` redirect. Shopify accepted one, so A5 never had to
solve this. A6 needs a public HTTPS URL pointing at a local server — a tunnel, or a deployed
preview — and `NEXT_PUBLIC_APP_URL` has to match it exactly, since `callbackUrl()` builds the
redirect from that variable and Etsy compares it byte for byte.

Decide the tunnel before implementation. Discovering it at the first Connect click costs an
afternoon and looks like an OAuth bug.

### 3c. Credentials must refresh, and the service does not do that yet

`lib/credentials` seals and opens a credential. It has no concept of one expiring, because
Shopify's offline token does not. Etsy's dies in an hour.

`docs/security.md` already lists "token refresh" among the credentials service's
requirements, so this is filling in a stated gap rather than changing a decision. The shape:

- The sealed blob holds `accessToken`, `refreshToken` and `expiresAt`.
- A read refreshes when the access token is expired or within a small margin of it, re-seals,
  and returns the fresh one. The re-seal path already exists for key rotation.
- `channel_connections.expires_at` already exists and should carry the **refresh** token's
  expiry, because that is the one a human has to act on.

**The 90-day refresh window is a product consequence, not just a technical one.** A creator
who does not publish to Etsy for 90 days has a dead connection, and Fanwise finds out at the
worst moment — mid-publish. The connection status enum already has `expired`; something has
to set it, and the UI has to offer a reconnect before a publish fails rather than after.

## 3d. Two obligations commercial access imposes on the product

Etsy reviews commercial access against criteria that are not only answers on a form. Two of
them are things Fanwise has to build, and both are A6 scope rather than application text:

1. **The trademark attribution, shown prominently.** Etsy requires the wording "The term
   'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed
   or certified by Etsy, Inc." It belongs on every surface where Etsy data or an Etsy listing
   appears — the channels page, the listing editor, any future analytics view — not buried in
   a footer. An application that promises it and a product that does not show it is a
   revocation waiting to happen.
2. **The caching policy.** Etsy limits how long its data may be retained. That constrains
   `listing_snapshots` and, at B5, `sales_events`. Read the current policy before deciding
   what Fanwise stores from an Etsy response, because invariant 4 makes snapshots immutable
   and a snapshot that may not legally be kept is a snapshot that should never have been
   written.

Etsy also requires that an application "clearly distinguish itself from Etsy" and never
sidestep the API to retrieve or post Etsy data. Both are satisfied by the architecture
already — Fanwise is a channel-neutral catalog and the adapter is the only path to any
provider — but they are worth stating in the application rather than leaving to inference.

## 4. Canonical product to listing field map

| Fanwise | Etsy | Notes |
|---|---|---|
| `canonical_title` or `name` | `title` | **140 chars.** Must start with a letter or digit |
| `canonical_description` | `description` | Plain text; Etsy does not take HTML |
| `base_price` | `price` | With `currency_code` from the shop |
| `product_type` | `taxonomy_id` | **A mapping, not a passthrough.** §5 |
| — | `who_made` | Fixed: `i_did` |
| — | `when_made` | Fixed: `made_to_order` |
| — | `type` | Fixed: `download` |
| — | `quantity` | Fixed: `999`. A digital listing does not deplete |
| `deliverable` asset | `uploadListingFile` | **5 files, 20 MB each.** §6 |
| `cover_image`, `preview_image` | `uploadListingImage` | Separate calls, one per image |
| tags | `tags` | 13 max, 20 chars each |

Four fields have no canonical source and are constants for every Fanwise listing. That is
worth stating rather than leaving to the adapter, because a constant nobody documented is a
constant nobody can question later: `who_made: i_did` and `when_made: made_to_order` are the
honest answers for a creator selling their own digital work, and both are required by Etsy.

## 5. Taxonomy is a required field with no canonical answer

`taxonomy_id` is **required** on `createDraftListing`, and Fanwise has nothing that maps to
it. `docs/data-model.md` is emphatic that `product_type` is deliberately coarse and is *not*
a channel category tree:

> "If a marketplace's taxonomy ever appears in this enum, the model has started drifting
> toward whichever marketplace shouted loudest."

So the adapter owns a `product_type -> taxonomy_id` table, the way `creative-market.md` §4
owns its category schema. Build it from Etsy's `getSellerTaxonomyNodes`, pin the ids, and
treat an unmapped product type as an **error-severity requirement** rather than guessing a
category. A listing filed under the wrong Etsy category is invisible to the buyers who would
have wanted it, and the creator cannot tell that is why.

## 6. The file limits are the real constraint

Etsy accepts the deliverable, which is the whole reason it needs no manual step. But:

- **5 files per listing, 20 MB each.** 100 MB total.
- **Filenames capped at 70 characters, not editable after upload.**
- Accepted types include `.zip` and `.pdf`. `.otf` is *not* on Etsy's published list, which
  matters for a font marketplace and needs confirming against a real upload.

A font family with desktop, web and variable packages will exceed 20 MB as one zip. So Etsy
needs a **packaging strategy**, not a generic passthrough of whatever the creator uploaded:
either the creator supplies Etsy-sized parts, or Fanwise splits a bundle across up to five
files, or the listing carries fewer formats than the canonical product does.

**This is the largest undecided question in A6** and it is a product decision, not a
technical one. Decide it before implementation, and record it as an ADR: splitting a bundle
silently changes what a buyer receives relative to every other channel, which is the kind of
divergence the canonical model exists to prevent.

## 7. Publish sequence

Unlike Shopify's single `productSet`, Etsy is several calls, and that changes the
idempotency story:

```
1  createDraftListing            -> listing_id        ONE creating call
2  uploadListingImage  x N       -> image_ids         repeatable
3  uploadListingFile   x 1..5    -> file_ids          repeatable
4  updateListing state=active    -> live
```

Only step 1 brings an object into existence, so it is the only step guarded by the publish
idempotency key. Record `listing_id` the moment it is known — architecture invariant 3's
"record the provider object ID the moment it is known, so a retry continues rather than
duplicates" is doing real work here, because steps 2 to 4 will fail independently and a
retry must resume rather than restart.

A partial publish is therefore a real state on Etsy in a way it never was on Shopify: a draft
listing with two of four images. The runner must be able to re-enter at the right step.

**The draft-then-activate shape matches A5**, but for a different reason. On Shopify it
exists because Fanwise cannot attach the file. Here it exists because Etsy requires images
before a listing can go active. Same mechanism, unrelated cause; do not collapse them.

## 8. Rate limits are shared across every customer

**10,000 requests per 24 hours and 10 queries per second, per application** — not per seller.
That ceiling is Fanwise's in total, across every creator who ever connects Etsy.

A listing with five files and ten images costs roughly 16 calls, so the default ceiling is
about **600 listings per day for all of Fanwise combined**. A limit increase has to be
requested from Etsy, and needs asking for well before there are customers who need it.

Two consequences A5 was allowed to skip:

- A **token bucket** is no longer optional. A5's client retries a throttle and calls it done,
  which is fine when one creator publishes one product. It is not fine when the ceiling is
  shared, because one creator's bulk import starves everyone else's publish.
- The limit belongs to the **adapter**, not the workspace, so it cannot live in an
  entitlement. It is a property of Fanwise's relationship with Etsy.

`429` responses carry a `retry-after` header; honour it rather than guessing.

## 9. Requirements, proposed

| Key | Rule | Severity |
|---|---|---|
| `title` | 1–140 chars, starts with a letter or digit | error |
| `description` | present | error |
| `price` | set, > 0 | error |
| `taxonomy` | product type maps to an Etsy category | error |
| `deliverable` | 1–5 ready files, each ≤ 20 MB | error |
| `filename_length` | every deliverable filename ≤ 70 chars | error |
| `image` | ≥ 1 ready image | error |
| `tags` | ≤ 13 tags, ≤ 20 chars each | error |

Note how many are errors compared with Shopify, where only four were. Etsy rejects rather
than truncates, and a rejection arrives as a failed publish the creator has to interpret.
The requirements engine is the difference between finding out in Fanwise and finding out
from Etsy.

## 10. Open questions to resolve against a live shop

Everything below needs commercial access, which is why §1 says file first.

1. Whether `shipping_profile_id` is genuinely required for a `type=download` listing. It is
   marked required in the API spec, and a digital listing has nothing to ship.
2. Whether `.otf` uploads succeed, given it is absent from the published accepted-types list.
   Decisive for fonts as the wedge.
3. The real behaviour when a deliverable exceeds 20 MB: a clean error, or a truncated upload.
4. Whether `updateListing state=active` fails when no image has been uploaded, and what the
   error looks like, since §7 depends on that ordering.
5. Whether image uploads over 1 MB fail as sellers report, and what the practical ceiling is.
6. Whether a refresh token really survives 90 days of disuse, and what a dead one returns.
7. Actual QPS behaviour under a burst, and how `retry-after` is populated.
8. Whether Etsy's taxonomy ids are stable across time, or need periodic refresh.
