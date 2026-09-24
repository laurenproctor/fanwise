# Channel spec: Polar

The third billable automatic channel, and the first that delivers the file to the buyer
itself. Written on 23 September 2026 against Polar's own documentation at `polar.sh/docs`:
the Products, File Downloads, OAuth 2.0, API overview, API versioning, Fees, Account reviews,
Webhooks and Sandbox pages, the `2026-04` OpenAPI reference for files, products, benefits,
checkout links, organizations and OAuth, and the Acceptable Use Policy effective 25 March
2026. The part declaration and completion shapes were checked against Polar's own upload
client, `clients/apps/web/src/components/FileUpload/Upload.ts` in `polarsource/polar`.
**Built the same day** as B13, in `lib/channels/adapters/polar`; the roadmap's B13 section
says what was built and what the exit still waits on. Items marked **[verify]** could not be
settled from the documentation and need a live organization, which is decision 32 in
`docs/decisions/0002`.

`docs/channel-feasibility.md` assessed Polar on 23 September 2026 under Tier 1. In one
sentence: a checkout, not a marketplace. There is no discovery surface, no category, no tags
and no product page; a buyer arrives through a checkout link Fanwise creates, and Polar, as
Merchant of Record, resells the product, collects the tax and hands the buyer the file.

## 1. What the step proves

| Claim | Where it is answered |
|---|---|
| A seller connects through OpenID Connect, to one organization, and the connection survives the ten-day token | §9 |
| A real product publishes with its images and its file, and the file reaches the buyer from Polar | §5, §6 |
| A second click creates nothing, and a failed publish is finished rather than repeated | §7 |
| The pinned API version is the current one, and the adapter knows when it has to move | §10 |

## 2. Adapter definition

```ts
key: "polar"
name: "Polar"
integrationType: "api"

capabilities: {
  automaticPublish: true,    // files, benefit, product as a draft, link, then public
  automaticUpdate: true,     // PATCH the product, repair the benefit's files and the images
  metrics: false,            // exists on the provider (metrics:read), arrives at B6
  transactions: false,       // orders and order.paid webhooks exist, arrive at B5 with orders:read
  digitalFileUpload: true,   // presigned multipart upload into a downloadables benefit
  imageUpload: true,         // presigned multipart upload, service product_media
  drafts: false,             // a publish goes live in one job, as on Gumroad
}
```

No manual steps. Polar takes the file and delivers it, so ADR 0001's assisted step does not
apply, and ADR 0012's download link is not needed. `metrics` and `transactions` are the
second kind of `false` in `docs/channel-adapters.md`: Polar can, Fanwise has not yet. No
`pace`: Polar's limit is per organization or OAuth client, not per source address.

## 3. Canonical product to listing field map

| Fanwise | Polar | Notes |
|---|---|---|
| `canonical_title` or `name` | `name` | Required, 3 to 64 characters. The shortest title limit of any channel |
| `canonical_description` | `description` | Markdown, rendered by Polar on the checkout page. Sent as written, §8 |
| `base_price`, `currency` | `prices[0]`, `{ amount_type: "fixed", price_currency, price_amount }` | Integer in the currency's smallest unit; `0` is free. One price per product |
| `cover_image`, then `preview_image` assets | `medias[]` | File ids, `service: product_media`, in channel order. JPEG, PNG, GIF, WebP or SVG, 10 MB each |
| `deliverable`, `archive` assets | a `downloadables` benefit's `properties.files[]` | File ids, `service: downloadable`, up to 10 GB each, §6 |
| listing `id` | `metadata.fanwise_listing_id` | The stamp §7 relies on, on the product and on the checkout link |
| — | `visibility` | `draft` on create, `public` once everything is attached, §5 |
| — | `recurring_interval: null` | Constant. A one-time purchase |
| `short_description`, `seo_title`, `seo_description`, `category`, `tags` | **nothing** | No fields. `fields` on the adapter lists title, description and price only |

Left alone: `attached_custom_fields`, `tax_behavior` (the organization's default applies),
the organization's other prices and benefits on a product Fanwise updates, §7.

## 4. Requirements

| Key | Rule | Severity | Why |
|---|---|---|---|
| `title` | 3–64 chars | error | Polar's limit. An AI title written for Etsy will not fit; the merchandising profile says so |
| `currency_supported` | one of Polar's 130 presentment currencies | error | Custom. Anything else is refused |
| `price` | 0, or at least the currency minimum | error | Custom. Per currency from Polar's table: 0.50 USD, 0.50 EUR, 0.40 GBP, 0.70 CAD, 80 JPY. 0 is free |
| `deliverable` | ≥ 1 ready `deliverable` or `archive` asset, each ≤ 10 GB | error | Custom. Polar does not require a file; Fanwise does, so nothing goes on sale with nothing behind it |
| `description` | ≥ 40 chars | warning | Publishes without one, sells badly |
| `cover_image` | ≥ 1 ready `cover_image` | warning | The checkout page shows the images beside the price |

No image count rule: Polar states none. No tag or category rule: there are no such fields.

## 5. The publish call

Six writes and two reads, one job. The product exists only from stage 4, and is reachable
only from stage 7:

1. **Search for the stamp.** `GET /v1/products?metadata[fanwise_listing_id]={listingId}&is_archived=false`.
   A hit means an earlier attempt created the product and failed later; the publish
   continues from it, §7. A miss means a fresh create.
2. **Upload each file.** `POST /v1/files` with `service: downloadable`, the name, MIME type,
   size and the parts as `{ number, chunk_start, chunk_end }` (end exclusive, 100 MiB
   parts) returns one presigned URL per part with the headers S3 expects. The worker streams
   the asset from its signed URL, `PUT`s each part with those headers, keeps every ETag,
   then `POST /v1/files/{id}/uploaded` with `{ id, path, parts: [{ number, checksum_etag,
   checksum_sha256_base64: null }] }`. The checksum is optional and not sent.
3. **Upload each image.** The same, with `service: product_media` and the MIME type Polar
   requires (`image/jpeg|png|gif|webp|svg+xml`). An image is read whole before the presign,
   because a rendition's size is not known until it exists and Polar presigns against the
   size.
4. **Create the benefit.** `POST /v1/benefits` with `type: downloadables`, a `description`
   of at most 42 characters ("Aster Grotesk files"), the `organization_id`, and
   `properties.files` as the file ids from stage 2. On a resumed publish that found a
   product with a downloadables benefit already, `PATCH /v1/benefits/{id}` replaces its
   file list instead.
5. **Create the product.** `POST /v1/products` with the fields in §3, `visibility: draft`,
   `medias` from stage 3, and the stamp in `metadata`. On a resumed publish, `PATCH` the
   product found in stage 1 with the same fields.
6. **Attach the benefit.** `POST /v1/products/{id}/benefits` with `benefits: [...]`, the
   benefit ids the product already holds plus the one from stage 4. The list replaces, so
   every existing id is resent.
7. **Create the checkout link.** `GET /v1/checkout-links?product_id={id}` first, because a
   resumed publish may have made one; then `POST /v1/checkout-links` with
   `payment_processor: stripe`, `products: [id]`, the name as `label`,
   `allow_discount_codes: true` and the stamp in `metadata`. The `url` in the answer is the
   buyer's address and the listing's `external_url`.
8. **Go live.** `PATCH /v1/products/{id}` with `visibility: public`, then
   `GET /v1/products/{id}` to read back `visibility`, `is_archived` and `benefits[]`.

Every request is JSON with `Authorization: Bearer` and `Polar-Version: 2026-04`; the OAuth
endpoints are form-encoded. Failures are HTTP statuses, §11.

`visibility: draft` on create is deliberate. A product is public by default, and although
no checkout link exists before stage 7, a public product with no benefit attached is a
product a buyer could conceivably pay for and receive nothing from. What `draft` and
`private` each mean to a checkout link is **[verify]**; the adapter only relies on `public`
meaning reachable.

## 6. Digital delivery, and the images

**The file.** Native, and better than native: Polar holds the upload, and on every paid
order grants the buyer the benefit and a signed, personal download URL, with SHA-256
checksums if the buyer wants them. Nothing in Fanwise's delivery machinery is involved.
Fanwise's storage caps an object at 4 GiB, under Polar's 10 GB, so the size rule in §4
never binds in practice.

**On update, the benefit's `properties.files` replaces the whole list.** The adapter keeps
`{ assetId, fileId }` for every file it sent on the listing (§12) and resends every known
id plus the new uploads. A file the creator removed in Fanwise stays on the benefit until
decision 21 says what removal means on a channel; a file replaced in Fanwise is a new asset
and is added. Polar says adding a file grants it to every existing customer retroactively,
which is the behaviour a creator fixing a broken archive wants.

**Images.** `medias` on the product is an ordered list of `product_media` file ids and
replaces on update, so the adapter sends every known id in channel order plus the new ones.
JPEG, PNG, GIF, WebP or SVG, 10 MB each. Images go as the source when it is one of those
within 2560 pixels and 10 MB, and as a rendition scaled inside 2560 (JPEG, or PNG for a PNG)
otherwise, through the shared image policy. The `medias` field has no alt text.

`purchasable` is true only when the read-back product is `public`, not archived, holds the
listing's benefit, and the listing knows at least one file on it. Whether an organization
that has not passed Polar's first review can sell at all, or only cannot be paid out, is
**[verify]**; the adapter cannot see review state.

## 7. Idempotency, and the stamp

Shared machinery for the job: the publish key is per listing and persisted before the job
runs; the update key carries a content, image and file fingerprint. Polar has no idempotency
key of its own, on any endpoint.

The runner's guarantee is one external write per job, and a publish here is six. Polar has
no product delete endpoint, and archiving would leave a retired product in the seller's
dashboard for every failed attempt, so this adapter does not clean up after itself. It
makes the publish **resumable**: every product it creates carries
`metadata.fanwise_listing_id`, Polar's list endpoint filters on metadata, and stage 1 of
every publish looks before it creates. A product a failed attempt left behind is found and
finished. The same reconciliation runs an update, with the listing's own record of what it
sent in place of an empty one.

This is the stamp-and-search guard ADR 0005 asks for, implemented inside the adapter
because Polar's metadata filter makes it one read. If the shared guard in PR #124 lands,
this adapter's search can move behind it.

What resuming does not recover: files a failed attempt uploaded before it failed. They sit
in the organization's file store unattached, the next attempt uploads again, and whether
Polar expires an unattached file is **[verify]**. The benefit a failed attempt created is
recovered when it was attached to the product, and orphaned when it was not.

**Adoption is safe on this channel.** Gumroad's guard refuses a collision because a creator
who already sells the product by hand holds the same slug. Polar's stamp is Fanwise's own
key in Fanwise's own metadata: nothing a seller made by hand carries it, so a hit is always
Fanwise's product. An archived product is never a hit, because archiving is how a seller
retires one on purpose.

An update reads before it writes: the product by id, raising `external_object_missing` on a
404, its prices, benefits and medias. It never changes `visibility`: that is the seller's,
and an edit must not put a private product on sale or a public one off it.

## 8. Description transform

None. Polar's description "supports Markdown", and the canonical description is Markdown.
It goes as written, trimmed, and an empty one goes as `null`. This is the first channel
that takes the canonical text without a rendering step (ADR 0011 covers the HTML channels).

## 9. OAuth

OpenID Connect, authorization code, through the shared `lib/channels/pkce.ts`. Polar
requires PKCE only for public clients; Fanwise is a confidential client and sends `S256`
anyway, and sends its client secret at the token exchange, which Polar requires.

```
https://polar.sh/oauth2/authorize
  ?response_type=code&client_id={id}&redirect_uri={callback}
  &scope=organizations:read products:read products:write files:write benefits:write checkout_links:read checkout_links:write
  &state={state}&code_challenge={S256}&code_challenge_method=S256
```

Token: `POST https://api.polar.sh/v1/oauth2/token` with `grant_type=authorization_code`, the
code, `client_id`, `client_secret`, `redirect_uri` and `code_verifier`. The answer carries
`access_token`, `expires_in` (864000, ten days), `refresh_token` and `scope`. Then
`GET /v1/organizations?limit=100` for the organizations the token can reach.

**Tokens are user-scoped.** The person authorizing grants access to their organizations, all
of them by default, or the ones they pick on the consent screen. A Fanwise connection is to
one organization, so the account hint is the organization's **slug**, the segment after
`polar.sh/`, and the exchange refuses unless an organization with that slug is among the
ones the token can reach. The connection then names that organization's id, and every
create sends it as `organization_id`.

**Seven scopes**, each the least that covers its calls. `openid` is not requested: the
id token is not used. `orders:read` arrives with B5 and means a reconnect then.

**Access tokens expire in ten days**, so the credential seals `{ accessToken, refreshToken,
expiresAt }` and the adapter refreshes with `grant_type=refresh_token` when fewer than ten
minutes remain, re-sealing what comes back. Whether the refresh token rotates is
**[verify]**; a refresh token in the answer replaces the old and its absence keeps it. How
long a refresh token lives is undocumented, so `expires_at` on the connection is null, and
a 401 reads as `credentials_invalid` and offers Reconnect. Disconnect revokes both tokens
through `POST /v1/oauth2/revoke`, refresh token first.

Registering the client is self-serve, in a Polar user's settings under OAuth, with a name,
the redirect URI `<NEXT_PUBLIC_APP_URL>/api/channels/polar/oauth/callback`, the scopes
above, and a homepage URL. Polar refuses `http://` except on `localhost`, so a local dev
server connects only as `http://localhost:<port>/...`. The client id and secret are parsed
by the adapter, not added to `lib/env.ts`. Whether Polar reviews an OAuth client used by
many sellers is **[verify]**; nothing in its documentation describes a review step.

**The sandbox.** `POLAR_ENVIRONMENT=sandbox` points every URL at `sandbox.polar.sh` and
`sandbox-api.polar.sh`, a fully isolated instance with its own accounts, its own OAuth
clients, Stripe's test cards and a 100-requests-a-minute limit. Polar asks sellers not to
test with real cards in production, so the exit run's first pass belongs there.

## 10. Rate limits, and the version clock

**500 requests a minute** per organization, customer or OAuth2 client in production, 100 in
the sandbox, answered with 429 and `Retry-After`, raisable through support. A publish is
about ten requests plus one per file part, so the limit is not a design constraint. Whether
"per OAuth2 client" means every Fanwise seller shares one allowance, as Etsy's does, is
**[verify]**; even so, 500 a minute is fifty publishes a minute platform-wide.

**The API contract expires on a schedule.** Versions are `YYYY-MM`, released in the first
week of January, April, July and October. Three exist at a time: Current, Deprecated
(stable until the next release, then removed), and Next. A removed version answers 404 to
everything. The adapter pins `Polar-Version: 2026-04` on every request, from one constant
in `config.ts`. Which of `2026-04` and `2026-10` is Current on the exit day is
**[verify]**: the response carries a `Polar-Version` header that says. Either way, the
adapter has to move to the next version at least twice a year, forever, and each move is a
diff of the schemas this adapter reads: `Product`, `FileUpload`, `Benefit`, `CheckoutLink`,
`TokenResponse`, `Organization`. No other channel here imposes a clock.

## 11. Error normalization

| Polar answers | Code |
|---|---|
| 401 `{ error: "invalid_token" }` | `credentials_invalid` |
| 403 `NotPermitted` | `permission_denied`, the scope was not granted or the organization was not allowed |
| 404 on the product read that opens an update | `external_object_missing` |
| 404 anywhere else | `not_found` |
| 422 `{ detail: [{ loc, msg }] }` | `validation_rejected`, with the first field and message: "Polar rejected this: name: String too long." |
| 400 | `validation_rejected` |
| 429 | `rate_limited`, retried after `Retry-After` |
| 5xx | `provider_unavailable`, retried |
| transport | `network`, retried |
| a `PUT` to storage that answers anything but 200 with an ETag | `unknown`, "Polar's storage did not accept part of the file", retried on the next publish |

## 12. Data written

`channel_connections.external_account_id` is the organization id; `external_account_name`
the organization name; `metadata.slug`, `metadata.currencyCode` (the organization's default
presentment currency) and `metadata.status`; `scopes` is the seven in §9; `expires_at` is
null. Credentials are `{ accessToken, refreshToken, expiresAt }`, sealed.

`channel_listings.external_listing_id` is the product id, a UUID; `external_url` and the
public URL are both the checkout link's `url`, since Polar has no product page.
`metadata.files` and `metadata.medias` as `[{ assetId, fileId }]`, `metadata.benefitId`,
`metadata.checkoutLinkId` and `metadata.checkoutUrl`. The file records are what lets an
update resend the benefit's whole list without re-uploading, and the benefit and link ids
are what lets it skip two reads.

## 13. Open questions to resolve against a live organization

1. Which API version is Current on the exit day, read from the `Polar-Version` response
   header, §10. Decides whether `API_VERSION` moves before the exit.
2. Whether `chunk_end` is exclusive, as Polar's own client sends it, and whether S3 accepts
   a 100 MiB part with the headers Polar returns, §5.
3. Whether a `draft` product can hold a benefit and a checkout link, and what a checkout link
   to a `draft` or `private` product shows a buyer, §5.
4. Whether `price_amount` for a zero-decimal currency (JPY, KRW) is the unit or a hundredth,
   §3. The adapter follows Stripe's list.
5. Whether the refresh token rotates, §9.
6. Whether an organization that has not completed its first payout review can sell, §6.
7. Whether unattached files expire, §7.
8. Whether the 500-a-minute allowance is per OAuth client across every seller, §10.
9. Whether Polar reviews an OAuth client used by many sellers, §9.
10. Whether the dashboard has a stable per-product URL worth holding as `external_url`
    instead of the checkout link, §12.
11. Whether the Acceptable Use Policy's "Polar serves software companies" framing survives a
    font foundry's first review, `docs/channel-feasibility.md`.
12. Whether a Polar storefront exists and lists public products, which would make
    `visibility: draft` during a publish matter more than §5 assumes.

## 14. Fees and terms

**Fees.** Starter is free with 5% plus 50¢ a transaction, plus 1.5% on non-US cards. Pro
($20 a month, 3.8% plus 40¢), Growth ($100, 3.6% plus 35¢) and Scale ($400, 3.4% plus 30¢)
trade a monthly fee for a lower rate. Organizations created before 27 May 2026 keep the
Early Member rate, 4% plus 40¢, until they upgrade. Sales tax is collected and remitted by
Polar as Merchant of Record. Disputes cost $15. Stripe's payout fees apply on withdrawal:
$2 a month of active payouts and 0.25% plus 25¢ a payout. Source: `polar.sh/docs/merchant-of-record/fees`.

**Terms.** The Acceptable Use Policy names "Templates, eBooks, PDFs, code, icons, fonts,
design assets, photos, videos, audio" as acceptable products. It prohibits marketplaces
that sell others' products and "any product or service that enables non-Polar Sellers to
sell"; neither describes Fanwise, since each creator is the seller on their own organization
and Fanwise sells nothing through Polar. The seller is reviewed before their first payout:
KYC through Stripe Identity and a review of up to 14 days, then continuous reviews at sales
thresholds, a 0.4% chargeback ceiling, and a 48-hour reply expected on any support thread
Polar loops the seller into. Fanwise can do none of this for the creator, and the channel
card should say so before Connect.

Polar has no generative-AI disclosure field on a product, and its policy has no AI clause.
Decision 24's product-level fact has nowhere to go on this channel and is not sent.
