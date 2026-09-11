# Channel spec: Etsy

The first billable automatic channel, and the first that takes the buyer's file. Written
against the Open API v3 on 8 September 2026, the day the developer app and commercial
access were approved, from the authentication guide, the listings tutorial and the live
taxonomy read with the app's own keystring. The reference itself renders only in a browser,
so the request shapes below that could not be read from a document are marked **[verify]**
and the exit test settles them.

## 1. What the step proves

| Claim | Where it is answered |
|---|---|
| A shop connects through OAuth with PKCE, and the token refreshes | §9 |
| A real product publishes with its images and its file, and is purchasable | §5, §6 |
| A second click creates nothing, and a failed publish leaves nothing behind | §7 |

## 2. Adapter definition

```ts
key: "etsy"
name: "Etsy"
integrationType: "api"

capabilities: {
  automaticPublish: true,    // createDraftListing, uploads, then active
  automaticUpdate: true,     // updateListing, and repairs images and files
  metrics: false,            // B6
  transactions: false,       // getShopReceipts, B5, needs transactions_r
  digitalFileUpload: true,   // uploadListingFile. The first channel with it
  imageUpload: true,         // uploadListingImage
  drafts: false,             // a publish goes to active in one job
}
```

No manual steps. Etsy takes the file, so ADR 0001's assisted step does not apply here.

## 3. Canonical product to listing field map

| Fanwise | Etsy | Notes |
|---|---|---|
| `canonical_title` or `name` | `title` | Max 140 |
| `canonical_description` | `description` | Plain text; Etsy strips formatting |
| `base_price` | `price` | Number, shop currency, minimum 0.20 |
| `currency` | — | The shop's currency wins, warning rule |
| `category` | `taxonomy_id` | A label from §14, required |
| `tags` | `tags` | ≤ 13, ≤ 20 chars, sanitized |
| `short_description`, `seo_*` | **nothing** | No fields |
| `cover_image`, then `preview_image` assets | `uploadListingImage` | Up to 10, multipart, cover first |
| `deliverable`, `archive` assets | `uploadListingFile` | Up to 5 of 20 MB, multipart |
| — | `type: download`, `quantity: 999`, `who_made: i_did`, `when_made: made_to_order`, `is_supply: false`, `should_auto_renew: true` | Constants. `when_made: made_to_order` was accepted on a download listing, 11 September 2026 |

`should_auto_renew: true` means Etsy renews the listing every four months at its own fee,
which is what a seller expects of a live listing; the alternative is a listing that
silently expires. Recorded here because it is a charge.

## 4. Requirements

| Key | Rule | Severity | Why |
|---|---|---|---|
| `title` | 3–140 chars | error | Etsy's limit |
| `description` | set | error | Required |
| `description_length` | ≥ 40 chars | warning | Sells badly short |
| `price` | ≥ 0.20 | error | Etsy's minimum |
| `category` | one of §14 | error | `taxonomy_id` is required |
| `tags` | ≤ 13, each ≤ 20 chars | error | Rejected above |
| `cover_image` | ≥ 1 ready | error | Etsy will not activate without an image |
| `deliverable` | ≥ 1 ready, each ≤ 20 MB | error | Custom rule; Fanwise uploads it |
| `currency_matches_shop` | listing currency = shop currency | warning | Custom, reads `connectionMetadata.currencyCode` |

## 5. The publish call

Four calls, one job:

1. `POST /v3/application/shops/{shop_id}/listings` with the fields above. Creates a draft
   and returns `listing_id`. No fee.
2. `POST .../listings/{listing_id}/images`, multipart `image`, `rank`, `alt_text`, once per
   image, cover first. Bytes are read from the asset's signed URL and forwarded; Etsy does
   not fetch URLs.
3. `POST .../listings/{listing_id}/files`, multipart `file`, `name`, `rank`, once per
   deliverable.
4. `PATCH .../listings/{listing_id}` with `state: active`. Etsy charges its listing fee
   here.

The bodies of 1 and 4 are JSON, and Etsy accepted both on 11 September 2026. The client also
has the form-encoded shape, which the token endpoint uses.

## 6. Digital delivery

Native. `type: download` and the file uploaded in step 3 are the whole of it; Etsy delivers
to the buyer. The limits, five files of 20 MB, are the custom requirement's job to catch
before the job runs.

## 7. Idempotency, and the compensating delete

The runner's guarantee is built around one external write per job, and a publish here is
four. So the adapter keeps the runner's world true: a failure at step 2, 3 or 4 deletes the
draft from step 1 before the error is reported. The listing then has no external id, the job
is failed, and a retry starts from nothing. A draft costs nothing to delete; an orphaned one
would be a duplicate on the next click.

If the delete itself fails, the original error is reported and the orphan's id is on the
job row under `cleanup`. `listings_d` is in the scopes for this reason.

An update reads before it writes: the listing by id (raising `external_object_missing` on a
404 from that read only), its image count, and its file list, and uploads only what the
listing is short of.

## 8. Description transform

None beyond normalizing line endings. Etsy strips formatting.

## 9. OAuth

Authorization code with PKCE, and the first use of the shared PKCE support in
`lib/channels/pkce.ts`: the verifier is minted when the flow starts, kept on the state row
(`channel_oauth_states.code_verifier`, service role only), and presented at the exchange.

```
https://www.etsy.com/oauth/connect
  ?response_type=code&client_id={keystring}&redirect_uri={callback}
  &scope=listings_r listings_w listings_d shops_r
  &state={state}&code_challenge={S256}&code_challenge_method=S256
```

Token: `POST https://api.etsy.com/v3/public/oauth/token`, form-encoded, with
`code_verifier`. Then `GET /v3/application/users/me` for the shop id and
`GET /v3/application/shops/{shop_id}` for the name and currency.

Every v3 call carries `x-api-key: {keystring}:{shared secret}`, and the shop's calls carry
`Authorization: Bearer` as well. Access tokens last an hour; the credential holds the pair and
the expiry, and the adapter refreshes with two minutes' margin and re-seals what Etsy hands
back. The refresh token lasts ninety days, which is the connection's `expires_at`.

The redirect URI is registered on the app, exactly and case-sensitively:
`<NEXT_PUBLIC_APP_URL>/api/channels/etsy/oauth/callback`.

## 10. Rate limits

10,000 requests per rolling day and 10 per second **per application**, across every
connected shop. A publish is about 4 + images + files calls. The client honours
`Retry-After` on a 429. `docs/channel-feasibility.md` already names this as the ceiling that
needs a limit increase before there are customers who reach it.

## 11. Error normalization

| Etsy answers | Code |
|---|---|
| 401 | `credentials_invalid` |
| 403 | `permission_denied` |
| 404 on a read by id | `external_object_missing` |
| 404 elsewhere | `not_found` |
| 400 | `validation_rejected`, with Etsy's sentence |
| 409 | `validation_rejected` |
| 429 | `rate_limited`, retried |
| 5xx | `provider_unavailable`, retried |

## 12. Data written

`external_account_id` is the shop id; `external_account_name` the shop name;
`metadata.currencyCode` and `metadata.shopUrl`. Credentials: `accessToken`, `refreshToken`,
`expiresAt`, `shopId`, `userId`, sealed. `external_listing_id` is the listing id;
`external_url` the public listing URL once active.

## 13. Questions settled against a live shop, 11 September 2026

Listing `4573259073` in shop `67895664`, from one publish job; the record is in
`docs/roadmap.md` under "The A6 exit run".

1. JSON bodies. `createDraftListing` and the activating `PATCH` both accepted
   `application/json`; form encoding is not required, §5. `updateListing` sends the same
   shape and was not exercised.
2. `when_made: made_to_order` is accepted on a `download` listing, §3.
3. A non-leaf `taxonomy_id` is accepted: Graphic Design, 1875, with three children, created
   and went active, §14.
4. `PATCH state: active` on a draft holding images and a file activates it in one step. The
   response reads `state: active` with the public URL, and there is no separate step.
5. **Open.** Whether the refresh token rotates on every refresh. The connection was under a
   minute old when it published, so no refresh ran. It settles the first time a publish or
   update runs more than an hour after the connect, or at B5 when scheduled ingestion
   refreshes routinely: the test is whether a second refresh with an already-used token is
   refused.

## 14. Categories

Read from `GET /v3/application/seller-taxonomy/nodes` on 8 September 2026. There is no node
named Fonts anywhere in the 3,065; fonts default to Graphic Design, where the marketplace's
own font sellers list. Graphic Design is not a leaf, and Etsy accepted it, §13. The labels the requirement offers, with their ids and paths, are in
`lib/channels/adapters/etsy/categories.ts`.
