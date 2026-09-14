# ADR 0012: WooCommerce delivers through a Fanwise download link

**Status:** accepted, 13 September 2026, at the founder's request.
**Date:** September 2026
**Amends:** ADR 0001 for WooCommerce only. Shopify is unchanged: it still has no API that
attaches a buyer-downloadable file at all.
**Supersedes:** `docs/channels/woocommerce.md` §6 "the draft gate", and the "Fanwise hosts the
download URL" rejection in `docs/channel-feasibility.md` as it applies to WooCommerce.

---

## Context

B8 shipped WooCommerce with ADR 0001's shape: `publish` created a draft, the creator attached
the file in the WordPress admin, marked a manual step done, and `activate` put the product on
sale once it could see the file. The founder's first live run on 13 September 2026 ended on
"Published, not live" with that step outstanding, and the request was plain: make WooCommerce
publish automatically, like the other stores.

A downloadable WooCommerce product stores each file as an address and serves it to every buyer
for as long as the product sells. The three ways to give it an address were weighed in
`docs/channel-feasibility.md`:

1. **Fanwise hosts the address.** Rejected at the time because Fanwise becomes delivery
   infrastructure for every buyer.
2. **Upload to the WordPress media library.** Public by address, and needs a second credential
   the store authorization does not grant.
3. **An assisted step.** What B8 built.

Two variants of the first were put to the founder:

- **A long-lived storage signed URL.** Simplest. It can never be revoked, and anyone who obtains
  it downloads the paid file for years.
- **A permanent Fanwise address that mints a short-lived link per request.** Revocable, and it
  stops on its own when the listing or the file goes away.

## Decision

**The second variant.** Every deliverable on a WooCommerce listing gets one Fanwise address,
`/api/public/delivery/<token>`, and the product's `downloads` list carries those addresses.

- **The token** is 32 random bytes, base64url. `delivery_links` stores its SHA-256 for lookup and
  the token itself sealed by the credentials service, bound to the workspace, listing and asset,
  so a later publish re-sends the same address instead of minting a new one. The table has no
  grant to `anon` or `authenticated`; only the service role reaches it. One active link per
  listing and asset, by partial unique index. Composite foreign keys tie the link, the listing
  and the asset to one workspace.
- **Each request is re-checked**: the link is not revoked, the listing is still `published` with
  an external id, and the asset is still a ready `deliverable` or `archive` of the product the
  listing sells. Then a 302 to a five-minute storage link with `Content-Disposition`, uncached,
  with no referrer. Every refusal is the same 404.
- **The adapter** sends `downloads` on every write, reusing the store's own download id for an
  address it already holds, so an edit never changes a past buyer's download. `publish` creates
  the product with `status: publish`; `update` also sends `publish`. `purchasable` is read back:
  on sale, at least one download, not hidden. `digitalFileUpload` is true, `drafts` false, and
  the manual step and `activate` are gone.
- **Revocation** is **Replace download link** on the listing card: it revokes the listing's
  links, then starts an update that carries new addresses. Its idempotency key includes the
  revocation's timestamp, because the listing's words have not changed and an ordinary update
  key would answer "already has these changes".
- **Listings published before this** (a draft waiting on the old step) show **Publish changes**:
  a published listing known not to be purchasable, on a channel with no step that gates
  activation, is offered a resend, and the update puts it on sale with its download.

## What this does not protect

The address is a bearer capability. WooCommerce's download handler checks the buyer's order and
then sends them to the file's address, typically by redirect for a remote file, so a buyer can
see it and share it. A shared address downloads the file for anyone until it is replaced, exactly
as a shared file would. What this adds over a storage URL is that it can be withdrawn, and that
it stops by itself when the product stops being sold through Fanwise.

## Consequences

- Fanwise now serves every WooCommerce buyer's download. The route is small and stateless beyond
  one indexed read per request, and storage bandwidth is the real cost; revisit if a store's
  volume makes that material.
- Journey 11 changes: there is no step to refuse. The live exit is now that one Publish produces
  a purchasable product whose download works for a test buyer, and that Replace download link
  stops the old address.
- **[verify] on a live store:** whether WooCommerce's "Approved download directories" setting
  accepts the Fanwise host without an admin approving it, and which download method
  (redirect or force download) the store uses for a remote file.
- Shopify remains assisted (ADR 0001). Nothing here gives Shopify a way to attach a file.
