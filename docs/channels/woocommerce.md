# Channel spec: WooCommerce

The second owned storefront, and the first channel with native digital products. Written
against the WooCommerce REST API `wc/v3` and the store authorization endpoint `wc-auth/v1`,
8 September 2026, and built as B8 the same day. Items marked **[verify]** could not be
confirmed from the published reference and need checking against a live store. The roadmap's
B8 section records what was built and what the exit still owes; the store itself is decision
25 in `docs/decisions/0002`.

The assessment that preceded this is in `docs/channel-feasibility.md`. Read it first for the
one hard problem, which this spec inherits rather than solves: **the file**.

## 1. What the step proves

| Claim | Where it is answered |
|---|---|
| A store connects with nothing but its own address | §9 |
| A real product publishes live with its file, and is never on sale without it | §5, §6 |
| A second click creates nothing | §7, shared with every channel |

## 2. Adapter definition

```ts
key: "woocommerce"
name: "WooCommerce"
integrationType: "api"

capabilities: {
  automaticPublish: true,    // POST /products, implemented
  automaticUpdate: true,     // PUT /products/{id}, implemented
  metrics: false,            // exists on the provider, arrives at B6
  transactions: false,       // GET /orders exists, arrives at B5
  digitalFileUpload: true,   // downloads[].file, a Fanwise address, §6
  imageUpload: true,         // images[].src, sideloaded by the store
  drafts: true,              // the fallback when a store drops the file, §6
}
```

`digitalFileUpload` was false at B8, by decision, and became true on 13 September 2026 (ADR
0012). It is not an upload in the store's own sense: the file stays with Fanwise and the
store is given a durable address it fetches from. §6 has the mechanism and its limits.

## 3. Canonical product to listing field map

| Fanwise | WooCommerce | Notes |
|---|---|---|
| `canonical_title` or `name` | `name` | House limit 200 |
| `canonical_description` | `description` | Plain text wrapped in paragraphs, shared transform |
| `short_description` | `short_description` | Shown beside the price |
| `base_price` | `regular_price` | Decimal string |
| `currency` | — | The store's currency wins, warning rule |
| `tags` | `tags[].id` | Created by name first, §5 |
| `seo_title`, `seo_description` | **nothing** | No native fields. Left null, profile says leave empty |
| `category` | **nothing** | Store-defined terms. Left null; the creator assigns in the admin |
| `cover_image`, then `preview_image` assets | `images[].src` | Sideloaded on create, resent only when the store is short |
| ready `deliverable` and `archive` assets | `downloads[]` of `{ name, file }` | `file` is a Fanwise address, §6 |
| — | `type: simple`, `virtual: true`, `downloadable: true`, `sold_individually: true` | Constants for a digital product |

No `slug` is sent, on the lesson Shopify taught: WordPress uniquifies a slug it derives and
would refuse one it is given that is taken.

## 4. Requirements

| Key | Rule | Severity | Why |
|---|---|---|---|
| `title` | 3–200 chars | error | A post title; 200 is a house limit |
| `price` | set, ≥ 0 | error | A digital product with no price is not a product |
| `deliverable` | ≥ 1 ready `deliverable` or `archive` asset | error | §6: never on sale without a file |
| `tags` | each ≤ 200 chars | error | WordPress term name limit |
| `description` | ≥ 40 chars | warning | Publishes without one, sells badly |
| `short_description` | ≤ 1000 chars when set | warning | Optional; house limit |
| `cover_image` | ≥ 1 ready `cover_image` | warning | Publishes without one |
| `currency_matches_store` | listing currency = store currency | warning | §3. Custom rule reading `connectionMetadata.currency` |

## 5. The publish call

`POST /wp-json/wc/v3/products` on create, `PUT /wp-json/wc/v3/products/{id}` after, both
with HTTP basic auth over HTTPS carrying the store's consumer key and secret. One product per
listing, `type: simple`, single price.

Tags are attached by id. Each name is `POST /products/tags` first; a name that exists answers
400 `term_exists` carrying the existing id in `data.resource_id`, which is the lookup.

The adapter reads `GET /products/{id}` before every write on an existing product, for three
reasons: whether the store holds fewer images than the listing sends, whether the product is
on sale (an update preserves that), and whether it exists at all (§15 of the Shopify spec, the
same rule).

## 6. Digital delivery

Rewritten 13 September 2026 by ADR 0012. Until then this section described an assisted file
step: publish made a draft, the creator uploaded the file in the admin and marked the step
done, and `activate` checked `downloads` before going live. The first real product stopped at
that step, and the ADR records why it went.

WooCommerce has downloadable products: `downloadable: true` and a `downloads` array of name
and file URL. The store fetches the URL itself whenever a buyer downloads. What it offers for
getting a file there:

- no WooCommerce endpoint writes into the protected folder, `woocommerce_uploads`;
- the WordPress media API can upload, into `wp-content/uploads`, which is public by address,
  and only with a second credential the authorization flow does not grant;
- **any URL the store can fetch is a valid download.** This is the path Fanwise takes.

**The address.** Each ready `deliverable` or `archive` asset gets one durable Fanwise address,
`<app>/api/public/deliverable/<filename>?token=<token>`, from
`lib/publishing/deliverable-links.ts` through `PublishContext.deliverableUrl`. The filename is
the last segment because the store names the buyer's download after the basename; the token
is in the query so every address shares one directory. The address is stable per listing and
asset, because the store grants buyers access per download entry. The token is stored as a
SHA-256 for lookup and sealed with the credentials keyring for reuse, in
`listing_deliverable_links`, which nobody signed in can read. The route checks, per request,
that the address is not revoked and the asset is still a ready buyer file, then redirects to
a five-minute signed download link. Every refusal is the same uncached 404.

**The write.** `publish` creates the product with `status: publish` and `downloads` in the same
body. `update` and `activate` send `downloads` only when the store's list differs from what
Fanwise would send, and they edit only Fanwise's own entries, recognized by the token. A
creator's own files added in the admin stay, and so does every entry id.

**Never on sale without a file.** If the store answers `publish` with an empty `downloads`,
the adapter sets the product back to `draft` by id at once. From `publish` that is reported as
a draft, not a failure, so the product is recorded and a second Publish cannot duplicate it.
From `activate` it is a failure with a sentence.

**The store's two checks.** `WC_Product_Download::check_is_valid` refuses an address whose
extension is not an allowed WordPress file type (fonts are outside the defaults; an address
with no extension is not type-checked), and, with Approved Download Directories on, an
address outside the list. The adapter retries a refusal once with the extension removed. A
second refusal is the directory list: a site administrator's key approves Fanwise's
directory automatically, a shop manager's adds it switched off, and the message names the
setting to turn on.

**Take it live.** `activate` remains, reached from a **Take it live** button on any listing
that is on the channel, off sale, and owes no step. It exists for drafts created under the
assisted step and for a store that dropped the file. It attaches the file on the way.

`purchasable` is true only when the product the store returns is `publish`, has at least one
download, and is not `catalog_visibility: hidden`.

**The download mode matters.** In the default, `Force downloads`, the store streams the file
and the buyer never sees the address. In `Redirect only` the buyer is sent to the address and
could share it. WooCommerce's REST products endpoint also shows `downloads` to anyone who can
read the product through the API (woocommerce/woocommerce#21732). Either way the address is
revocable, which a file in `wp-content/uploads` is not.

**[verify]** against the live store: the refusal code is `product_invalid_download`; a
force-download fetch follows the route's 307; the directory is approved automatically under
the connecting user's key.

## 7. Idempotency

Shared machinery. The publish key is per listing; the update key carries a content and image
fingerprint; the runner's three guards apply. A retried create that already returned an id
becomes an update of that id.

## 8. Description transform

`lib/channels/html.ts`, shared with Shopify: blank lines to paragraphs, newlines to breaks,
everything escaped. No Markdown.

## 9. Authorization

Not OAuth. The store's own endpoint:

```
GET {store}/wc-auth/v1/authorize
  ?app_name=Fanwise
  &scope=read_write
  &user_id={state}
  &return_url={callback}?state={state}
  &callback_url={grant}
```

The creator approves on their store. The store POSTs JSON `{ key_id, user_id, consumer_key,
consumer_secret, key_permissions }` to `callback_url`, and sends the creator to `return_url`
with `success=1` or `success=0` and `user_id`.

Two routes, both generic in the channel key:

- `POST /api/channels/{key}/oauth/grant` completes the connection. It parses the body,
  consumes the state (`user_id` is the state Fanwise minted), proves the keys by calling
  `GET /settings/general` on the store the state row names, reads the currency from it and
  the site name from the REST index, writes the connection, and seals the keys. A non-2xx
  response is shown to the creator on the store's own screen.
- `GET /api/channels/{key}/oauth/callback` reports. It peeks at the state rather than
  consuming it, because the documentation says the POST can trail the redirect. Connection
  present: done. State unconsumed: "give it a moment". Otherwise: start again.

`verifyCallback` checks only that the store said yes and named the same state; there is no
signature to verify, and the credential is proven in the grant route, which is the stronger
check.

Every request to the store leaves through the outbound boundary, §14.

Requirements on the store: HTTPS, and pretty permalinks. Without permalinks the REST routes
answer 404 `rest_no_route`, which is normalized to a sentence that says so.

Requirements on Fanwise, learned on 9 September 2026 from the first live attempt: **a public
HTTPS address.** The store refuses the authorization page outright when `callback_url` is
not `https://`, printing "The callback_url needs to be over SSL" on its own screen before
the creator sees an approve button. And an HTTPS callback is not enough if it is not
reachable: the keys arrive by a POST from the store's server to `callback_url`, so a Fanwise
on `localhost` never receives them, however the URL is spelled. Shopify and Etsy return
through the creator's browser and worked from a local dev server; this is the first channel
that does not. Set `NEXT_PUBLIC_APP_URL` to a public HTTPS origin, which means the hosted
deployment or a tunnel to the dev server, before pressing Connect. `.env.example` says the
same, beside the other channels' redirect URIs.

**[verify]** the order of the POST and the redirect on a current WooCommerce, and whether
`user_id` is echoed unchanged when it is a 43-character base64url string.

## 10. Rate limits

None documented. The API is the store's own WordPress, so the ceiling is the creator's
hosting. The client retries 429 and 5xx three times with bounded backoff.

## 11. Error normalization

| Store answers | Code | Sentence |
|---|---|---|
| 401 | `credentials_invalid` | rejected the keys, reconnect |
| 403 | `permission_denied` | approve read and write |
| 404 `rest_no_route` | `not_found` | check WooCommerce is active and permalinks are pretty |
| 404 `woocommerce_rest_product_invalid_id` on a read by id | `external_object_missing` | the product was deleted there |
| 400 with `data.params` | `validation_rejected` | names the first parameter |
| 429 | `rate_limited` | retried |
| 5xx | `provider_unavailable` | retried |
| transport | `network` | retried |

## 12. Data written

`channel_connections.external_account_id` is the normalized store address, `host` or
`host/path`, no scheme. `external_account_name` is the site's name. `metadata.currency` is
the store currency. `scopes` is `["read_write"]`. Credentials are `{ consumerKey,
consumerSecret }`, sealed.

`channel_listings.external_listing_id` is the numeric product id as a string;
`external_url` is the admin edit URL, which works before the product is live.

`listing_deliverable_links` holds one row per listing and buyer file: `token_hash`,
`token_sealed` and `key_version`, `revoked_at`, `last_downloaded_at`. No `listing_manual_steps`
row is created any more. Rows left from before 13 September 2026 are ignored, because the
adapter no longer declares the step.

## 13. Open questions to resolve against a live store

1. The POST-versus-redirect order in §9.
2. ~~Whether `downloads` reflects an admin-attached file, §6.~~ No longer decides code: Fanwise
   writes the download itself. Replaced by the three **[verify]** items at the end of §6.
3. Whether the site name from the REST index is readable with WooCommerce keys alone, or
   needs no auth at all. The adapter falls back to the address.
4. Whether sideloading a Supabase signed URL completes inside the URL's lifetime on typical
   hosting. Shopify's did.
5. Billing: `docs/decisions/0002` item 23.

Partly settled on 9 September 2026, before the first connection: `houseofproctor.com`
answers `GET /wp-json/wc/v3/` with the full route index and no credentials, so a store's
permalinks and WooCommerce activity can be checked from a browser before Connect is pressed.
Item 3 asks about the root index's `name`, which that read did not cover. The first Connect,
from a local dev server, never reached the approve screen; §9 records why.

## 14. The outbound boundary

The store address is the one thing in this adapter a creator typed, and Fanwise then sends
the store's keys to it from a server that can reach things a browser cannot. Since the
security hardening of 9 September 2026 every request the client makes goes through
`lib/net/outbound`, which is provider-neutral and knows nothing about WooCommerce:

- **HTTPS only, no credentials in the URL, no port but 443**, and a hostname that is a
  public DNS name (two labels at least, no `.local`, `.internal`, `.localhost` or
  `.arpa`) or a public address literal.
- **The name is resolved by the boundary**, once, and every address it yields is checked
  against the loopback, private, link-local, carrier-NAT, multicast, reserved,
  documentation and cloud-metadata ranges, IPv4 and IPv6, including the IPv4-mapped and
  NAT64 spellings. One bad address among several refuses the request.
- **The socket is opened to the address that was checked.** The transport is `node:https`
  with a `lookup` that answers the pinned address and nothing else, so a DNS record that
  changes between the check and the connect (rebinding) changes nothing. TLS still
  verifies the certificate against the hostname.
- **No redirect is followed.** A 3xx is refused, so the keys are never re-sent to a
  different origin. A store that redirects (`www.` to bare, say) has to be connected at
  the address it redirects to, and the message says so.
- **Deadlines and a cap.** Ten seconds to connect, sixty seconds for the whole exchange
  on this channel (the boundary's own default is thirty; a product create makes WordPress
  sideload every image inside the request), and five megabytes of body.

What a creator sees when the boundary refuses is one of three sentences in
`lib/channels/adapters/woocommerce/errors.ts`, and none of them is retried: the address is
what it is. A timeout or a socket error is `network`, retried three times as before.

**What changed for a valid store: nothing.** A public store answering directly on 443 is
served exactly as before. What changed for an invalid one: a redirecting store used to be
followed silently, including to `http://`, and now is not.

The client is loaded on demand, from `clientFor()` and from the grant's `verify()`, never at
the top of the adapter. The listing editor reads every adapter in the browser for its
requirement specs and its name, so the adapter modules are in the client graph; the client
reaches `node:net` and `node:dns`, which a browser has no version of. `next.config.ts`
aliases those, and `node:https`, to `lib/net/browser-stub.ts` under the `browser` condition
only, an inert module that throws if anything ever calls it. The server bundle gets the real
modules.

The store's own behaviour is out of scope here. It sideloads image URLs Fanwise hands it,
which are Supabase signed URLs; that is the store fetching, not Fanwise.

