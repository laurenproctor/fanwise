# Channel spec: WooCommerce

The second owned storefront, and the first channel with native digital products. Written
against the WooCommerce REST API `wc/v3` and the store authorization endpoint `wc-auth/v1`,
8 September 2026. Items marked **[verify]** could not be confirmed from the published
reference and need checking against a live store.

The assessment that preceded this is in `docs/channel-feasibility.md`. Read it first for the
one hard problem, which this spec inherits rather than solves: **the file**.

## 1. What the step proves

| Claim | Where it is answered |
|---|---|
| A store connects with nothing but its own address | §9 |
| A real product publishes as a draft and goes live only with the file on it | §5, §6 |
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
  digitalFileUpload: false,  // Fanwise will not, see §6. The provider can, badly
  imageUpload: true,         // images[].src, sideloaded by the store
  drafts: true,              // status: draft, and load-bearing
}
```

`digitalFileUpload` is false for the second of the two reasons `docs/channel-adapters.md`
names: not because the provider cannot, but because the one API path that can puts the file
somewhere public. That is a Fanwise decision, recorded in §6, and it could change.

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
| `deliverable` asset | **nothing** | §6 |
| — | `type: simple`, `virtual: true`, `downloadable: true`, `sold_individually: true` | Constants for a digital product |

No `slug` is sent, on the lesson Shopify taught: WordPress uniquifies a slug it derives and
would refuse one it is given that is taken.

## 4. Requirements

| Key | Rule | Severity | Why |
|---|---|---|---|
| `title` | 3–200 chars | error | A post title; 200 is a house limit |
| `price` | set, ≥ 0 | error | A digital product with no price is not a product |
| `deliverable` | ≥ 1 ready `deliverable` or `archive` asset | error | §6: there must be a file to attach, and activate checks for it |
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

## 6. Digital delivery, and the draft gate

WooCommerce has downloadable products: `downloadable: true` and a `downloads` array of name
and file URL. The API sets every part of that except the file's existence. `downloads[].file`
must be a URL the store can already serve, and:

- the WooCommerce API has no upload for one;
- the WordPress media API can upload a file, into `wp-content/uploads`, which is public by
  address, and it needs a second credential the authorization flow does not grant;
- the protected folder, `woocommerce_uploads`, is written only by the admin's product-file
  upload.

So the file step is assisted. `publish` creates the product as `status: draft`, the creator
attaches the file in Product data, Downloadable files, and marks the step done.

**Activate checks.** Unlike Shopify, the product read carries `downloads`. `activate` reads
the product first and refuses, with a message naming the admin screen, if the list is empty.
Only with a file present does it set `status: publish`. The step is still a person's claim,
but here the claim is verified before it has consequences.

`purchasable` is true only when the read-back product is `publish`, has at least one
download, and is not `catalog_visibility: hidden`.

**[verify]** whether a file attached in the admin appears in the API's `downloads` array with
its protected URL, and whether the store's download method setting affects that.

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

Requirements on the store: HTTPS, and pretty permalinks. Without permalinks the REST routes
answer 404 `rest_no_route`, which is normalized to a sentence that says so.

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

## 13. Open questions to resolve against a live store

1. The POST-versus-redirect order in §9.
2. Whether `downloads` reflects an admin-attached file, §6.
3. Whether the site name from the REST index is readable with WooCommerce keys alone, or
   needs no auth at all. The adapter falls back to the address.
4. Whether sideloading a Supabase signed URL completes inside the URL's lifetime on typical
   hosting. Shopify's did.
5. Billing: `docs/decisions/0002` item 23.
