# Channel spec: Gumroad

The second billable automatic channel, and the first whose file goes up in parts. Written on
11 September 2026 against Gumroad's own source, which is public at `antiwork/gumroad`, read
at commit `409faee82934265236351992ac89bc8a31140cc1`: the API v2 controllers, the OAuth and
rate-limit initializers, the in-repo API documentation and help center, and the terms. Every
route named below was confirmed to exist in production by an unauthenticated request that
answered 401, against a made-up path that answered 404. Planned as B10 and not built; the
roadmap's B10 section says what it waits on. Items marked **[verify]** could not be settled
from source and need a live seller account, which is decision 27 in `docs/decisions/0002`.

`docs/channel-feasibility.md` carried Gumroad as "the near miss" until this was written. The
product endpoints it described as unimplemented shipped in spring 2026: file upload on
30 March, product creation on 6 April, and API-created products publishing by default on
6 September.

## 1. What the step proves

| Claim | Where it is answered |
|---|---|
| A seller connects through OAuth with PKCE, and the connection holds without a refresh | §9 |
| A real product publishes with its covers and its file, and is purchasable | §5, §6 |
| A second click creates nothing, and a failed publish leaves nothing behind | §7 |
| A shared, platform-wide create limit is never tripped by Fanwise's own traffic | §10 |

## 2. Adapter definition

```ts
key: "gumroad"
name: "Gumroad"
integrationType: "api"

capabilities: {
  automaticPublish: true,    // POST /v2/products as a draft, covers, then enable
  automaticUpdate: true,     // PUT /v2/products/{id}, and repairs covers and files
  metrics: false,            // exists on the provider, arrives at B6
  transactions: false,       // GET /v2/sales exists, arrives at B5 with view_sales
  digitalFileUpload: true,   // presigned multipart upload, then files[] on the product
  imageUpload: true,         // covers and thumbnail, by URL
  drafts: false,             // a publish goes live in one job, as on Etsy
}
```

No manual steps. Gumroad takes the file, so ADR 0001's assisted step does not apply.
`metrics` and `transactions` are the second kind of `false` in `docs/channel-adapters.md`:
Gumroad can, Fanwise has not yet.

## 3. Canonical product to listing field map

| Fanwise | Gumroad | Notes |
|---|---|---|
| `canonical_title` or `name` | `name` | Required, at most 255 |
| `canonical_description` | `description` | HTML, sanitized by Gumroad on render. Shared transform, §8 |
| `short_description` | `custom_summary` | The line shown beside the buy button |
| `base_price` | `price` | Integer in the currency's smallest unit |
| `currency` | `price_currency_type` | One of 19, lowercased, §4. Defaults to the account currency when omitted, so it is always sent |
| `category` | `category` | A taxonomy path such as `design/fonts`, §14. Gumroad defaults to `other` |
| `tags` | `tags[]` | Each 2 to 20 characters, no commas, no leading `#`, lowercased by Gumroad |
| product `slug` | `custom_permalink` | The buyer-facing address, and the stamp §7 relies on. Unique per seller |
| `seo_title`, `seo_description` | **nothing** | No fields |
| `cover_image`, then `preview_image` assets | `POST .../covers` | Up to 8, in order, cover first |
| `cover_image` asset | `POST .../thumbnail` | A square derivative, §6 |
| `deliverable`, `archive` assets | presigned upload, then `files[][url]` | Up to 20 GB each, §6 |
| — | `native_type: digital` | Constant. Gumroad refuses `physical`, `podcast`, `newsletter` and `audiobook` on create |

Update-only fields Fanwise leaves alone: `custom_receipt`, `custom_html`, `is_adult`,
`quantity_enabled`, review and sales-count display. Refund policy is left to the seller's
account default; sending `refund_period` is refused when an account-level policy is on.

## 4. Requirements

| Key | Rule | Severity | Why |
|---|---|---|---|
| `title` | 3–255 chars | error | Gumroad's limit is 255 |
| `price` | 0, or at least the currency minimum | error | Custom. The minimum is per currency: 0.99 USD, 0.79 EUR, 0.59 GBP, and so on from Gumroad's table. 0 is free |
| `currency_supported` | usd, gbp, eur, jpy, inr, aud, cad, hkd, sgd, twd, nzd, brl, zar, chf, ils, php, krw, pln, czk | error | Custom. Anything else is refused |
| `price_unverified_ceiling` | at most 5,000 USD equivalent | warning | Unverified sellers cannot price higher; Fanwise cannot see verification |
| `tags` | each 2–20 chars, no commas, no leading `#` | error | Refused otherwise. Count limit **[verify]** |
| `deliverable` | ≥ 1 ready `deliverable` or `archive` asset, each ≤ 20 GB | error | Custom. Gumroad does not require a file; Fanwise does, so nothing goes live with nothing behind it |
| `permalink_format` | `[A-Za-z0-9_-]`, ≤ 255 | error | Custom. Fanwise slugs already satisfy it |
| `description` | ≥ 40 chars | warning | Publishes without one, sells badly |
| `cover_image` | ≥ 1 ready `cover_image` | warning | Publishes without one, and the thumbnail is derived from it |
| `category` | one of §14 | warning | Gumroad files it under `other`, which keeps it out of Discover browsing |
| `covers_max` | ≤ 8 cover and preview images | info | The ninth onward is not sent |

## 5. The publish call

Four stages, one job. The product exists only from stage 2:

1. **Upload each file.** `POST /v2/files/presign` with `filename` and `file_size` returns an
   `upload_id`, a `key` and one presigned URL per 100 MB part, each valid for 900 seconds.
   The worker streams the asset from its signed URL and `PUT`s each part, keeping every
   ETag, then `POST /v2/files/complete` with the parts returns the file's canonical
   `file_url`. A failure before complete calls `POST /v2/files/abort`. Complete is never
   retried; Gumroad's documentation says so. The canonical URL is persisted on the job row
   before stage 2, because Gumroad never returns it again: a product read gives a
   time-limited signed URL instead.
2. **Create the draft.** `POST /v2/products` with the fields in §3, `files[][url]` for each
   uploaded file, and `draft=true`. Returns the product's external id, its `short_url`, and
   `files[]` with the ids Gumroad assigned.
3. **Covers and thumbnail.** `POST /v2/products/{id}/covers` with `url`, once per image,
   cover first; `POST /v2/products/{id}/thumbnail` with `url`. Both take a signed asset URL
   and Gumroad fetches it **[verify]**.
4. **Go live.** `PUT /v2/products/{id}/enable`, then `GET /v2/products/{id}` to read back
   `published` and `files[]`. Gumroad's own warning text and API docs say `POST .../enable`;
   the route is `PUT`, and `POST` answers 404.

`draft=true` is sent on purpose. Since 6 September 2026 a create without it publishes at
once, which would put a product on sale before its covers arrive, and a publish Gumroad
blocks inside a create comes back as `success: true` with a "Saved as a draft" warning,
which a client reading only the flag would record as live.

Every request is form-encoded or JSON with `Authorization: Bearer`. **Gumroad answers most
failures with HTTP 200 and `{ success: false, message }`**, so the client decides success
from the body, never from the status. §11.

## 6. Digital delivery, and the images

**The file.** Native. Gumroad holds the upload in the seller's own storage prefix and
delivers it to the buyer. `files[][url]` must point under that prefix; anything else is
refused. Fanwise's storage caps an object at 4 GiB, well under Gumroad's 20 GB, so the size
rule in §4 never binds in practice.

**On update, `files[]` replaces the whole list.** A file left out is deleted. The adapter
resends every file it knows as `id` plus its stored canonical `url`, and appends new
uploads. An entry with an id and no url is refused on the current code, and Gumroad's own
documentation still describes the older behaviour where it was silently dropped; the
adapter never sends one. If the files stored on the listing do not match the file ids the
product read returns, the update refuses rather than guessing, because a wrong guess deletes
the buyer's download.

**Whether the file reaches the buyer without rich content is [verify].** Gumroad's product
page content is a "rich content" document, and the file attach and the rich content are
separate parameters. If a file attached through `files[]` alone does not appear on the
buyer's download page, `publish` also sends a one-page `rich_content` document embedding
each file. This is §13 item 1, and it decides code before B10's exit.

**Covers.** JPEG, PNG or GIF, at most 50 MB each, at most 8 per product, shown in the order
added; `cover_ids[]` on an update reorders them. No cover dimension appears in the source
read, so the adapter sends the 2000-pixel long-edge derivative Etsy already uses rather
than adding a spec on a guess **[verify]**.

**Thumbnail.** Square, at least 600 × 600, under 5 MB, JPEG, PNG or GIF. This is a new
derivative: **1200 × 1200 JPEG, cropped from the cover**, keyed on source checksum plus spec
hash like every other.

`purchasable` is true only when the read-back product is `published` and holds at least one
file. Gumroad's own publish also requires a confirmed email and a payout method on the
account; a product that fails either is refused at stage 4, §11.

## 7. Idempotency, and the compensating delete

Shared machinery, and Etsy's pattern. The publish key is per listing and persisted before
the job runs; the update key carries a content, image and file fingerprint. Gumroad has no
idempotency key of its own.

The runner's guarantee is one external write per job, and a publish here is several. So a
failure at stage 3 or 4 deletes the draft from stage 2 with `DELETE /v2/products/{id}`
before the error is reported. Gumroad removes the files ten minutes later. A failure in
stage 1 aborts the upload in progress; parts already completed for other files sit in the
seller's prefix unattached, and whether Gumroad expires them is **[verify]**.

**The stamp is `custom_permalink`.** It is unique per seller, case-insensitively, so a
second create with the same permalink is refused with "already used by another one of your
products." A create whose response was lost is not retried automatically, per ADR 0005;
the next attempt that meets the collision reports it, with a link to the seller's product
list, and adopts nothing. Adoption would be wrong in the common case for this channel: a
creator who already sells the product on Gumroad by hand is exactly who connects it, and
their existing product holds the same slug.

An update reads before it writes: the product by id, raising `external_object_missing` when
Gumroad answers "The product was not found.", its cover count, and its files, and uploads
only what the product is short of. It never changes published state.

## 8. Description transform

`lib/channels/html.ts`, shared with Shopify and WooCommerce: blank lines to paragraphs,
newlines to breaks, everything escaped.

## 9. OAuth

Authorization code with PKCE, through the shared `lib/channels/pkce.ts`. Gumroad supports
PKCE and does not require it; Fanwise sends `S256` anyway, because the verifier costs nothing.
Fanwise also sends its client secret, which Gumroad accepts but does not insist on.

```
https://gumroad.com/oauth/authorize
  ?response_type=code&client_id={id}&redirect_uri={callback}
  &scope=edit_products
  &state={state}&code_challenge={S256}&code_challenge_method=S256
```

Token: `POST https://api.gumroad.com/oauth/token` with `grant_type=authorization_code`, the
code, `client_id`, `client_secret`, `redirect_uri` and `code_verifier`. Authorization codes
last ten minutes. Then `GET /v2/user` for the account id and name, which `edit_products`
alone is enough to read.

**One scope.** `edit_products` covers every call in §5. `view_sales` arrives with B5 and
means a reconnect then, the same trade Etsy made with its transactions scope.

**Access tokens never expire.** Gumroad issues a refresh token and rotates it on use, but no
call Fanwise makes needs one, so `expires_at` is null and the credential holds both tokens
sealed. A token that does not expire is valid until revoked, so disconnect calls
`POST /oauth/revoke` before it deletes the connection, and a 401 anywhere reads as
`credentials_invalid` and offers Reconnect.

Registering the application is self-serve, in the seller settings at
`gumroad.com/settings/advanced`, with a name and one redirect URI:
`<NEXT_PUBLIC_APP_URL>/api/channels/gumroad/oauth/callback`. Gumroad allows `http`, so unlike
WooCommerce a local dev server can connect. The client id and secret are parsed by the
adapter, not added to `lib/env.ts`. Whether Gumroad reviews an app used by many sellers
outside its code is **[verify]**; the code has no review step, and its documentation
describes apps "for general use."

## 10. Rate limits

Gumroad throttles with Rack::Attack, and **the create limit is keyed by IP address, not by
token**:

| Route | Limit | Keyed by |
|---|---|---|
| `POST /v2/products` | 10 per 60 s, escalating on repeat to a ceiling of 50 per 9 hours | IP |
| `PUT /v2/products/{id}` | 30 per 60 s | IP, and separately per token |
| `POST /oauth/token` | 3,000 per 60 s | IP |
| Presign, complete, covers, thumbnail, enable, delete, reads | no specific rule | — |

Separately, a seller may create at most **100 products in a rolling 24 hours**, or 10 if
Gumroad considers the account non-compliant.

The per-IP create limit is shared by every Fanwise workspace, because every create leaves
from Fanwise's own workers. One enthusiastic Publish Everywhere across a catalog could trip
the escalation and block creates for every creator for hours. So the Gumroad create runs on
**its own job queue with a concurrency of one and a pace of at most six creates a minute,
platform-wide**, and a 429 is retried after its `Retry-After` and never sooner. This is the
first provider limit that is not per connection; if A7's orchestration cannot express it,
B10 adds it. Decision 27 asks Gumroad what it wants from a multi-tenant app here.

## 11. Error normalization

| Gumroad answers | Code |
|---|---|
| 401, empty body | `credentials_invalid` |
| 403 | `permission_denied`, the scope was not granted |
| 200 `success: false`, "The product was not found." on a read by id | `external_object_missing` |
| 200 `success: false`, "already used by another one of your products" | `validation_rejected`, naming the permalink, not retried |
| 200 `success: false` from enable, confirmed email or payout method missing | `validation_rejected`, telling the creator what to finish on Gumroad **[verify]** the exact messages |
| 200 `success: false`, anything else | `validation_rejected`, with Gumroad's sentence normalized |
| 400 `{ status, error }` | `validation_rejected` |
| 429 | `rate_limited`, retried after `Retry-After` |
| 5xx | `provider_unavailable`, retried |
| transport | `network`, retried |

The in-repo error documentation lists 402 and 404 responses the controllers do not send.
The table above follows the code.

## 12. Data written

`channel_connections.external_account_id` is the Gumroad user id; `external_account_name`
the account name; `metadata.profileUrl`; `scopes` is `["edit_products"]`; `expires_at` is
null. Credentials are `{ accessToken, refreshToken }`, sealed.

`channel_listings.external_listing_id` is the product's external id, a string such as
`A-m3CDDC5dlrSdKZp0RFhA==`; `external_url` is `short_url`, the public product page.
`metadata.permalink`, `metadata.coverIds`, and `metadata.files` as
`[{ assetId, fileId, fileUrl }]`, the last because §5 says Gumroad will never give the
canonical URL back.

## 13. Open questions to resolve against a live seller account

1. Whether a file attached with `files[]` alone reaches the buyer's download page, or needs
   a `rich_content` embed, §6. Decides code.
2. Whether Gumroad fetches a Supabase signed URL for covers and the thumbnail inside the
   URL's lifetime. Shopify's did; WooCommerce's is still open.
3. Whether `published` reads false after a draft create and true after enable.
4. The exact messages enable returns for an unconfirmed email and a missing payout method.
5. The production category paths in §14. The paths below come from the repository's
   development seed, which may differ from production.
6. The fields `GET /v2/user` returns, in particular a stable id, the profile URL and the
   account currency.
7. The maximum tag count and the maximum number of files per product.
8. Whether uploaded files never attached to a product are deleted or expire.
9. Whether Gumroad reviews OAuth apps used by many sellers, and its guidance on the per-IP
   create limit. Decision 27.
10. Whether an API-created product is eligible for Discover with no further seller action.
11. Recommended cover dimensions, §6.

## 14. Categories

`category` takes a taxonomy path. From `db/seeds/010_development_staging_test/taxonomy_create.rb`
at the commit above, **[verify]** against production:

| Fanwise `product_type` | Gumroad path |
|---|---|
| `font` | `design/fonts` |
| `template` | `design/graphics/assets-and-templates` |
| `graphic` | `design/graphics/vector-graphics` |
| `icon` | `design/icons` |
| `mockup` | `design/graphics/mockups` |
| `theme` | `design/ui-and-web` |
| `three_d` | `3d/3d-assets` |
| `illustration` | the `digital-illustration` node, parent slug **[verify]** |
| `brush` | the `illustration-brushes` node under it, **[verify]** |
| `photo` | **[verify]**, not read |
| `other` | omitted, Gumroad's `other` |

The labels the requirement offers live in `lib/channels/adapters/gumroad/categories.ts` when
B10 is built, as Etsy's do.

## 15. Fees and terms

**Fees.** Gumroad takes 10% plus $0.50 on a direct sale, plus card processing at 2.9% plus
$0.30; a flat 30% on a sale that came through Discover, processing included; and 5% plus
$0.50 once a seller's paid sales in a month pass $20,000. Source: the in-repo help article on
fees and `gumroad.com/pricing`.

**Terms.** Updated 17 August 2026, binding on existing accounts from 16 September 2026. No
API-specific or third-party-application terms exist in the repository. Two clauses matter:
"You may not share your Account or password with anyone," which OAuth exists to satisfy and
which Fanwise never asks a creator to break; and a prohibition on commercially exploiting
the Services, which could be read against a paid tool built on the API, the same shape of
risk as Etsy's clause in `docs/channel-feasibility.md`. Fanwise's answer is Etsy's: it
charges for cross-channel catalog management, not for Gumroad product creation. Decision 27
puts the question to Gumroad directly rather than leaving it to a reading.

Gumroad has no generative-AI disclosure field on create, and its terms have no AI clause.
Decision 24's product-level fact has nowhere to go on this channel and is not sent.
