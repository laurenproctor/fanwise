# ADR 0012: WooCommerce gets the file by a Fanwise address

**Status:** accepted, 13 September 2026. The founder chose Fanwise-hosted addresses over the
WordPress media library.
**Date:** September 2026
**Supersedes:** `docs/channels/woocommerce.md` §6 as written at B8, "the file step is assisted"

---

## Context

B8 shipped WooCommerce with `digitalFileUpload: false` and one manual step: publish created a
draft, the creator uploaded the deliverable in the store's admin, marked the step done, and
`activate` checked the product's `downloads` before setting it live. The spec recorded that
as a Fanwise decision that could change.

It changed on the first real product. Publishing Blimpie to WooCommerce ended at "No download
file is attached to this product in WooCommerce yet", which is the gate working and the
workflow failing: one click was meant to put a product on sale, and on this channel it put a
chore in the creator's queue.

What WooCommerce actually offers, confirmed against its source on 13 September 2026:

- A download is a name and a URL. The store fetches that URL itself when a buyer downloads.
  In its default mode (`Force downloads`) it streams the bytes through PHP, so the buyer
  never sees the address. It redirects the buyer only if the store owner turned that on.
- No REST endpoint writes into the protected `woocommerce_uploads` folder.
- The WordPress media endpoint can upload, but only with a WordPress application password,
  which the WooCommerce authorization flow does not grant, and it puts the file in
  `wp-content/uploads`, public by address, permanently.
- `WC_Product_Download::check_is_valid` refuses an address whose extension is not an allowed
  WordPress file type (an address with no extension is not type-checked), and, when
  Approved Download Directories is on, an address outside the list. A site administrator's
  key adds the directory automatically; a shop manager's adds it switched off.
- The buyer's saved filename is the address's basename, not the download's name.

## Options

**A. Fanwise hosts the file and hands the store a durable address.** No second credential,
works on any store, revocable. Fanwise serves the download bandwidth, and a store set to
redirect exposes the address to the buyer.

**B. Upload into the WordPress media library.** The file lives on the creator's host. It needs
a second credential per store, lands at a public address that cannot be revoked, and reverses
the reason §6 existed.

**C. Both, per connection.** Twice the work and a settings surface, for a preference nobody
has asked for yet.

## Decision

**A.** The address is `<app>/api/public/deliverable/<filename>?token=<token>`:

- The **filename** is the last segment so the buyer's download is named properly. The route
  ignores it.
- The **token** is in the query so every address shares one parent directory, and a store's
  allow-list needs one Fanwise entry, not one per product.
- A **stable** address per listing and asset. WooCommerce grants buyers access per download
  entry, so an address that changed on every update would churn those entries. The token is
  therefore recoverable: looked up by SHA-256, stored sealed with the credentials keyring and
  bound to its listing and asset. A copy of the table alone yields nothing usable.
- Table `listing_deliverable_links`, RLS on with no policies, no grant to `anon` or
  `authenticated`, composite foreign keys to the listing and the asset, cascading from both.
- The route re-derives on every request that the address is not revoked and the asset is
  still a ready buyer file, then redirects to a five-minute signed download link. Every
  refusal is the same uncached 404.

What changes for the channel:

- `digitalFileUpload: true`, `manualSteps: []`. Publish creates the product **live with its
  file in the same write**. The rule the draft gate enforced survives: if the store answers
  `publish` with no download, the adapter sets it back to `draft` by id before returning.
- The adapter edits only its own download entries, recognized by the token, and preserves
  every entry id, including the creator's own files added in the admin.
- A refused download is retried once with the extension removed, and a second refusal names
  the Approved Download Directories setting.
- `activate` stays, reached from a new **Take it live** button that appears on any listing
  that is on the channel, off sale and owes no step. It exists for drafts made before this
  change (Blimpie's) and for a store that answered without the file. It attaches the file on
  the way.

## Consequences

- A new public route that is a bearer capability for a paid file. Anyone who obtains the
  address gets the file. It is handed only to the store, lives in the store's product data,
  and in the default download mode never reaches a buyer. The residual risks are a store in
  redirect mode, and WooCommerce's own REST products endpoint, which shows `downloads` to
  anyone who can read the product through the API (woocommerce/woocommerce#21732). Neither
  is worse than a file in `wp-content/uploads`, and unlike that file this address can be
  revoked.
- Fanwise pays egress for every buyer download from WooCommerce, capped per request by the
  signed link, not by the function.
- A second table is sealed with `CREDENTIALS_ENCRYPTION_KEY`. It is re-sealed on read like
  `channel_connection_secrets` (ADR 0003), but only a listing that is written again gets
  re-sealed, so before retiring an old key version, check that no `listing_deliverable_links`
  row still carries it. The public route never opens a sealed token, so a request never
  needs the key.
- Replacing a deliverable does not show **Publish changes**, because the sent fingerprint
  covers copy and images, not files. The next write of any kind sends the new file. Changing
  the fingerprint would change every channel's update key, so it is left for its own change.
- `externalUrl` is still the admin edit URL. Pointing a live product at its storefront page
  is already in progress on another branch.

**[verify]** against the live store: the refusal code is `product_invalid_download`; a
store's force-download fetch follows the route's 307; the automatic directory approval under
the connecting user's key.
