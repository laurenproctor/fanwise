# Data model

Tables arrive with the step that needs them. This file is the plan, not the current schema;
run `pnpm db:types` for what actually exists.

## A1: tenancy

Built. Migration `20260904042945_workspaces_and_membership`.

**workspaces** — id, name, slug (citext, unique), owner_user_id, created_at,
updated_at. Check constraints on name length, slug format and slug length, so a
malformed slug cannot reach a row even if the app forgets to validate.

A workspace slug is the first path segment (`/best-night`), and a product slug the
second (`/best-night/facette-typeface`). Both therefore share a namespace with the
application's own routes, and `workspaces_slug_not_reserved` and
`products_slug_not_reserved` (migration `20260905173722_reserved_slugs`) keep a slug
off a word a route would shadow. A shadowed slug is not a broken link; it is a row
that inserts happily and a page nobody can open. The lists live in `lib/slug.ts` and
a unit test asserts they still cover every route that exists.

**workspace_members** — workspace_id, user_id, role, created_at.
Primary key (workspace_id, user_id), plus an index on `user_id` alone: the
composite key is workspace-id-leading and cannot serve "which workspaces does
this user belong to", which is the read the app performs on every authenticated
request.

Roles: owner, admin, editor, viewer. All four exist in the enum. V1 only ever
assigns owner, and the UI exposes nothing else.

RLS on both from the moment they are created, never added afterwards.

Two decisions that later tenant tables should copy:

- Membership checks go through the `security definer` functions
  `is_workspace_member()` and `is_workspace_owner()`. A policy on
  `workspace_members` that reads `workspace_members` directly recurses forever.
  For the same reason `workspace_members` is **not** `force row level security`:
  FORCE subjects the table owner to RLS, which re-applies the policy inside the
  helper and restores the recursion.
- `workspaces` has no INSERT policy. Rows are born only through two
  `security definer` functions, each writing the workspace and its owner
  membership in one statement. A brand new user is a member of nothing, so no
  policy could authorise their first insert, and no workspace can exist without
  an owner.
  - `provision_personal_workspace(name, slug)` is the one the application
    calls, from `app/onboarding/route.ts`. It gives a user with no workspace a
    personal one and returns their earliest workspace otherwise, serialized per
    user with an advisory lock, so a replayed or concurrent request cannot make
    a second. Migration `20260911203255_provision_personal_workspace`.
  - `create_workspace(name, slug)` predates it and creates unconditionally. The
    application no longer calls it; the tenancy harness does.

## A2: the canonical product

Built. Migrations `20260904160128_products_and_assets` and
`20260904160248_product_asset_storage`.

### Revision: the product_type enum, September 2026

`product_type` was previously unenumerated in this document. A2 fixed it as a
deliberately **coarse** enum:

    font, template, graphic, photo, illustration, icon, mockup, brush,
    three_d, theme, other

This is a revision, not an omission being filled in, and the reasoning matters
because it will be under pressure at A3:

- **`metadata.tags`** is the product's own search keywords, on every metadata kind since
  16 September 2026 (it was a font-only field before). Not a channel field: a listing keeps
  its own `tags` column and is offered these when it has none.
- **Per-type granularity now lives in `metadata`**, validated in the application
  by a discriminated union keyed on `product_type`
  (`lib/products/metadata.ts`). Serif versus sans, print versus web, variable
  versus static: all metadata, none of them enum members.
- A coarse enum stays stable. A fine one grows a member every time a creator
  ships something new, and every new member is a migration.
- **It is not a channel category tree.** Creative Market alone has nine top-level
  categories whose choice swaps the entire license and price schema
  (`docs/channels/creative-market.md` section 4). Mapping Fanwise's type to a
  channel's category belongs to the adapter, per architecture invariant 1. If a
  marketplace's taxonomy ever appears in this enum, the model has started
  drifting toward whichever marketplace shouted loudest.

**products** — id, workspace_id, name, slug, product_type, status, canonical_title,
canonical_description, short_description, brand_name, base_price, currency, version,
support_url, documentation_url, license_summary, metadata (jsonb), created_at, updated_at,
archived_at

Status: draft, incomplete, ready, publishing, published, archived.

No channel-specific column belongs here. Ever.

`canonical_description` is Markdown, as are `channel_listings.description` and
`public_product_pages.description_override` (ADR 0011). Every other text column is plain text.

Slugs are unique **per workspace**, not globally: two creators may both ship
`aster-grotesk`, and neither learns the other exists.

`(id, workspace_id)` carries a redundant unique constraint. It is the target of
the composite foreign key on `product_assets`, described below.

**product_assets** — id, workspace_id, product_id, asset_type, asset_state,
storage_path, filename, mime_type, byte_size, checksum, sort_order, derived_from,
spec_hash, failure_reason, metadata, created_at

`asset_state` is `pending`, `ready` or `failed`. A row is `pending` from the
moment a signed upload URL is issued until a background job has measured the
stored bytes. Nothing the client claims about size or type is trusted.

**Immutable once ready.** A trigger blocks changes to the content columns of a
ready asset; replacing a file creates a new row. `sort_order` and `metadata` stay
editable because they are presentation, not content. This is what makes the
derivative cache key sound, see below.

**Font products: detected versus canonical.** The finalize job reads every
upload that sniffs as a font (OTF, TTF, WOFF, WOFF2) and writes what the file
says onto that asset's `metadata.font` (family, style, PostScript name, weight,
width, italic, version, glyph count, variation axes, scripts, languages, Unicode
blocks, OpenType features, embedding permission), or `metadata.fontProblem`
when it cannot be read (`lib/fonts/detected.ts`). The reading lands in the same update
that makes the row ready, so a ready font with neither was settled by a worker built
before fonts were read (worker deploys are by hand and lag `main`). The font workspace
asks for each such row to be read (`readFontFileAction`, which queues `finalize_asset`
again); on a ready row the job writes `metadata` only, which the immutability trigger
permits, and a re-upload is never needed. Decodable images get
`metadata.width` and `height`; product images add `metadata.altText` and
`metadata.altTextSource` (`creator` or `generated`, ADR 0014), written by the creator from
the product page or the font workspace, or suggested by the `describe_image` job after the
image finalizes. The keys are named once in `lib/products/image-metadata.ts`. None
of this is on the product. The product's own `metadata` (the `font` member of
the union) holds what the creator stands behind: classification, scripts,
languages, features, axes, the style list, search tags, the licence types sold
and their limits, and a EULA link. The workspace seeds unanswered product fields
from the files once and never replaces a value the creator has set
(`adoptionPatch` in `lib/fonts/workspace.ts`). No migration was needed for any
of it: both are the existing jsonb columns, validated with Zod on write. The
workspace's Marketplace drafts section reads listing inheritance from the row, not
by comparing strings: an empty `title`, `description` or `price` column is shown as
"From the product" with the value being typed, a filled one as "Only this
channel", and the price review warning is raised only for a customized price.

**The tenant boundary is a foreign key, not just a policy.** `product_assets`
references `products (id, workspace_id)` as a pair, and `derived_from` references
`product_assets (id, workspace_id)` as a pair. Referencing `products(id)` alone
would let a member attach an asset carrying their *own* `workspace_id` to someone
else's product: the RLS policy checks `workspace_id` and would pass. This was
found by a tenancy test, not by inspection.

Asset types: deliverable, source_file, archive, cover_image, preview_image, thumbnail,
specimen, documentation, license, screenshot, promotional, other.

`derived_from` points at the source asset for generated derivatives, so a
re-render is cheap and traceable. Binaries live in object storage, never in
Postgres.

**The derivative cache is `(derived_from, spec_hash)`**, enforced by a unique
partial index, and that is the only cache key. There is deliberately no source
checksum in it: a ready asset's bytes are immutable, so `derived_from` already
pins the input exactly. A concurrent rebuild collides on the index rather than
duplicating work.

Storage is a private bucket, `product-assets`, path
`<workspace_id>/<product_id>/<asset_id><ext>`, capped at 4 GiB.

**Removing a buyer file is one transaction, on every screen.**
`remove_import_deliverable(product_id, asset_id)` locks the product row, refuses to
remove the last ready buyer file (`deliverable`, `archive` or `source_file`), and
otherwise deletes the row and its derivatives, returning their storage paths for the
action to delete after commit. The lock is the point: the check used to be a read and a
delete from the application, and two removals arriving together against a product with
exactly two ready files could both pass and leave none. Security invoker, so it runs
under the creator's RLS; another workspace's product is not found. Migration
`20260913010000_remove_import_deliverable`, proven under concurrency in
`tests/db/import-deliverable-removal.test.ts`. The import screen and the product page's
Files section both delete buyer files through it (`deleteAssetAction` routes those three
types there), so neither can remove a product's last ready buyer file; the name says
"import" only because that screen needed it first. Every other asset type still deletes
through `deleteAssetCascade`.

### Deleting a product draft

Added 13 September 2026, migration `20260913040000_delete_product_draft`.

**Deleting a draft is not retiring a product.** A product that has never left Fanwise — no
channel was asked to create it, no channel holds a reference to it, no activity was logged
about it, no public page was made for it — can be deleted outright, and nothing outside
Fanwise notices. A product that *has* been seen somewhere has buyers, links, indexed pages
and channel listings that outlive the row, and removing it is a different act with
obligations this does not meet. So permanent deletion is offered only for the first kind.
Archive, restore, and removing a listing from a marketplace are future work; none of them
exists yet, and none is implied by this.

`delete_product_draft(product_id)` is the only path by which a signed-in user deletes a
product. It returns `{ outcome, blocker, asset_paths, import_source_paths }`, where `outcome`
is `deleted`, `blocked` or `not_found`. `product_draft_deletion_blocker(product_id)` is the
same decision without the deletion, which the product page reads to decide what to show;
the deletion calls it again under lock, so the offer and the outcome have one definition.
Neither reads `products.status`, which is not the product's lifecycle (ADR 0005).

The product page shows its Danger zone only when there is something to do: Delete draft for
a product that may go now, or one sentence for a draft that will be deletable once an
upload, import or AI generation finishes. A product blocked for a reason that never clears
(a public page, an external reference, a live listing, publishing or activity history) gets
no section at all, since this feature can never delete it and a permanent notice at the
bottom of every published product is a dead end. That choice is `offeredDraftDeletion` in
`lib/products/draft-deletion.ts`. The import screen's discard still explains every blocker,
because there the creator did ask to remove the product.

Owner only. A product in another workspace, a product the caller is a member but not owner
of, and an id that does not exist all return `not_found`.

**What blocks**, as stable codes the application translates:

| Code | When |
|---|---|
| `public_page` | any `public_product_pages` row, whatever its status: a page that has existed may have been published and unpublished, linked or indexed |
| `listing_external_reference` | a listing with `external_listing_id` or `external_url` |
| `listing_live` | a listing `publishing` or `published`, or a completed manual step |
| `publication_history` | any `publication_jobs` row for one of its listings, in any state |
| `activity_history` | any `workspace_events` row about the product or its listings; the log's immutability trigger refuses even a cascaded delete, and is not bypassed |
| `import_in_progress` | the import is `pending`, `retrieving` or `analyzing`, or a source is `uploading`, `transcribing`, `pending` or `reading` |
| `generation_in_progress` | an AI generation `pending` or `running` |
| `upload_in_progress` | a product asset still `pending` |

**What cascades**, because none of it has left Fanwise: assets and their derivatives, draft
listings and their snapshots (the snapshot trigger already allows a delete whose listing is
gone), open manual steps, finished AI generations, and the import with its sources and
evidence. `public_profile_drafts.products` is jsonb and cannot cascade, so the function
removes the product from any draft arrangement first and moves that draft's `revision`, so
a builder tab holding the old arrangement conflicts rather than writing it back.

**Serialization.** The function locks, in order, the workspace's profile drafts, the product,
its listings, their manual steps, its import and the import's sources, then checks. A new
listing, asset, generation, event, public page or import references the product by foreign
key, and a new publication job or manual step references a listing; either way the insert
waits for the deletion and then fails its foreign key, or committed first and is seen. So a
publication and a deletion cannot both succeed.

**Storage is cleaned after the commit, never before.** The function collects every asset path
and every import-source path (the legacy `product_imports.source_path` and the per-source
`storage_path`, deduplicated) before deleting, and returns them. `deleteProductDraft` in
`lib/products/delete-draft.ts` removes those objects from the `product-assets` bucket once
the transaction has committed. Removing them first would leave visible rows pointing at
missing files whenever the database then refused; removing them after means a storage
failure costs only private bytes no row points at, which is logged and does not undo the
deletion.

The product page's Delete draft and the import screen's discard both go through
`deleteProductDraft`. Replacing an import's source never deletes the product.

## A3: channels

Built. Migration `20260904173000_channels_connections_listings`.

**channels** — id, key (citext, unique), name, integration_type, status, billable,
created_at

A global catalog, not tenant data: no `workspace_id`, and every signed-in user
sees the same list. Readable by `authenticated`, writable by nobody. Rows are
born in migrations.

**Capabilities are deliberately not stored here.** They are declared in
`lib/channels/registry.ts`, because a capability in an editable row is a
capability that can be made to lie, and the UI reads capabilities to decide what
to offer. A unit test asserts the registry and this table agree on key, name and
integration type, so drift fails CI rather than production.

`billable` ships now although billing is C1. It is false for an owned storefront
included in the base price and true for every external marketplace, per
`docs/billing.md` rule 4. Adding it later would mean backfilling live
connections.

**channel_connections** — id, workspace_id, channel_id, external_account_id,
external_account_name, status, scopes, metadata, connected_at, last_verified_at,
expires_at, created_at, updated_at

Unique on `(workspace_id, channel_id, external_account_id)`: one workspace
connects one external account once. `(id, workspace_id)` carries the redundant
unique constraint the composite foreign key from `channel_listings` needs.

### Revision: credentials are a table, not a column

`encrypted_credentials` was previously listed as a column on
`channel_connections`. It is not, and should not be.

**RLS filters rows, never columns.** A credential sitting beside readable
columns is protected only by every present and future query remembering to name
its columns instead of `select *`. One slip returns a marketplace token to the
browser.

**channel_connection_secrets** — channel_connection_id (pk), workspace_id,
encrypted_credentials, key_version, created_at, updated_at

The table has **no grant to `anon` or `authenticated` at all**, so it is
unreachable through PostgREST rather than merely policy-protected. RLS is
enabled with zero policies as a second layer, so a grant added by mistake later
still returns nothing. The only path is the service role, from server code.

`key_version` records which `CREDENTIALS_ENCRYPTION_KEY` sealed the row.
Rotation without it is a guess.

A3 creates this table and never writes to it. The credentials service arrives at
A5 with the first real connection.

**channel_listings** — id, workspace_id, product_id, channel_id,
channel_connection_id, external_listing_id, external_url, public_url, status, status_source,
title, description, short_description, price, currency, category, tags, metadata,
generated_at, approved_at, published_at, last_synced_at, created_at, updated_at

`title`, `description`, `short_description` and `price` are empty when the listing uses the
product's value, and hold a value only when customized for the channel (see
`docs/channel-adapters.md`, "Inheritance and declared fields").

`external_url` is the creator's address for the object and may be an admin page; `public_url`
is the buyer's. The publishing runner writes `public_url` only while the adapter reports the
object live and it is not known to be unpurchasable, and clears it otherwise. The public product
page reads `public_url` and nothing else: `anon` holds a column grant on it and none on
`external_url`, and the anonymous listing policy requires it to be set
(`20260913050000_listing_public_url`).

`status_source` is `verified` or `self_reported`. An assisted channel can only
ever produce `self_reported`, and nothing that implies verification may read
those rows as equal. This is enforced by the trigger
`enforce_listing_status_source()`, not by convention: `integration_type` lives on
`channels` and the claim lives here, which is further apart than a check
constraint can see.

**Unique on `(product_id, channel_connection_id)`, not `(product_id, channel_id)`.**
A creator with two shops on one marketplace has two connections, two listings and
two billable channels. Keying on the channel would have made that a migration
later.

A partial unique index on `(channel_id, external_listing_id)` where the external
id is not null makes a duplicate publication visible at the database rather than
in a support email.

Both tenant boundaries are composite foreign keys, repeating the A2 lesson: to
`products (id, workspace_id)` and to `channel_connections (id, workspace_id)`.

**listing_snapshots** — id, workspace_id, channel_listing_id, product_id,
channel_id, snapshot_type, payload, created_at

Insert only. `authenticated` holds `select` and `insert` and nothing else, and
`enforce_snapshot_immutability()` blocks the rest for everyone including the
service role.

### A4: what a save records

Every save from the listing editor writes one `update` snapshot alongside the
row it changed, carrying the field values *and* the readiness verdict at that
moment. A snapshot holding only the text would leave the more useful half of
"what changed before revenue moved" unanswerable.

The verdict written is the server's, recomputed at save. The browser computes
one too, so the creator sees readiness move while typing, but a verdict computed
only in the browser is a verdict the browser can lie about, and it is the
server's that reaches the snapshot.

**The trigger permits exactly one kind of delete: a cascade whose parent is
already gone.** Postgres removes a parent row before firing the cascade onto its
children, so a snapshot can tell the two apart. Without this, immutability would
block workspace deletion outright, and "never deleted" would be a promise the
product could not keep the first time someone asked for their account to be
removed. A direct delete is still refused.

## A5: publishing

Built. Migration `20260904190000_shopify_publishing`.

**channel_oauth_states** — state (pk), workspace_id, channel_id, user_id,
external_account_hint, expires_at, consumed_at, created_at

OAuth state is a **single-use row, not a cookie**. `docs/security.md` rule 6
requires state validated on every callback, and a cookie satisfies the letter of
that but not the point: the same callback URL opened twice validates twice. A row
can be *consumed*, so the replay fails because there is nothing left to consume.
The state itself is the primary key, because uniqueness is the anti-replay
property.

The row also carries what the callback must not choose for itself — which
workspace, which user, which account — so a valid callback cannot be steered at a
different workspace or a different shop. Like `channel_connection_secrets` it has
**no grant to `anon` or `authenticated`**, with RLS on and zero policies behind
that.

**publication_jobs** — id, workspace_id, channel_listing_id, kind,
idempotency_key, status, attempt_count, started_at, completed_at,
provider_response, normalized_error_code, normalized_error_message, created_at,
updated_at

Architecture invariant 3 lives here. `idempotency_key` is `not null` with a
**global unique constraint**, so "persisted before the call, in the same
transaction as the job row" is not a discipline anyone has to remember: the
insert that creates the job is the insert that claims the key, and a second click
loses at the database rather than in application code.

The two kinds differ on purpose. A **publish** key is derived from the workspace
and listing alone and deliberately excludes the content, because two clicks of
Publish are the same operation whatever was typed in between and must collide.
An **update** key includes a content fingerprint, because two different edits are
two operations and must not collide, while two identical edits are one and do.

Members hold `select` and `insert` only. The outcome of an external write is the
system's account of what happened, not a field a person edits.

**listing_manual_steps** — id, workspace_id, channel_listing_id, step_key,
completed_at, completed_by, created_at, updated_at

ADR 0001's assisted file step, and the reason **"fully published" is a derived
condition rather than a status value**: published, and no required manual step
incomplete. A live product with no deliverable attached can take money and give
nothing back, which is the one outcome worth engineering against.

The step's label, description and whether it is required live in the adapter, not
in this table, for the same reason capabilities do. There is no delete grant: a
step that was required does not stop having been required because someone would
rather it went away.

## A7: orchestration

Built. Migration `20260911224831_publish_everywhere_runs`.

**workspace_events** — append-only activity log: id, workspace_id, event_type, product_id,
channel_listing_id, run_id, actor_user_id, payload, created_at.

Never updated, never deleted, and not by the service role either. Three lines enforce that:
members hold `select` and `insert` only, no policy exists for the other two verbs, and a
trigger refuses both whatever the role. It is the shape `listing_snapshots` earned the hard
way, for the same reason — a log its own writer can edit afterwards is not evidence of
anything.

`event_type` is text with a format check rather than an enum, because the set of things worth
logging grows with every step and an enum puts a migration between a new event and the code
that writes it. `lib/publishing/events.ts` owns the vocabulary. Both tenant boundaries are
composite foreign keys, to `products (id, workspace_id)` and
`channel_listings (id, workspace_id)`.

**`publication_jobs.run_id`** — nullable, and permanently so. It groups the jobs one Publish
Everywhere click created, and a single-channel publish belongs to no run. Not a foreign key:
a run is not a row, it is the id those jobs share.

**There is no product-level publish status, by decision.** A product is never published; its
listings are (ADR 0005). A run reports per channel and counts the results, and a query that
wants to know how much of a product is live counts listings by liveness at read time.

## B1: AI

Built. Migration `20260907180000_ai_generations`.

**ai_generations** — id, workspace_id, product_id, channel_listing_id, generation_type,
status, requested_by, provider, model, prompt_version, input_hash, factsheet_hash,
structured_output, violations, input_tokens, output_tokens, cache_read_input_tokens,
cache_creation_input_tokens, estimated_cost, error_code, error_message, started_at,
completed_at, applied_at, created_at, updated_at

One row per model call. `factsheet_hash` is what lets a bad listing be traced back to the
facts that produced it, and `structured_output` is what B2's restore reads.

Status: pending, running, succeeded, failed, **rejected**. The last is the factuality
validator's verdict and is deliberately not `failed`: the model answered, the answer parsed,
and the validator refused it because it claimed something the FactSheet does not support.
That is the product working. `violations` is set only with `rejected`, by check constraint,
and holds `{kind, value, field}` for each unsupported claim.

Members hold `select` and `insert` only, as on `publication_jobs`: asking is theirs, the
outcome is the system's. A partial unique index on `channel_listing_id` where the status is
pending or running allows one generation in flight per listing, so a double click loses at
the database rather than paying twice.

Both tenant boundaries are composite foreign keys, to `products (id, workspace_id)` and
`channel_listings (id, workspace_id)`.

**`snapshot_type` gains `generate`.** A generation applied to a listing writes a snapshot
like a build or a save does, carrying the copy, the readiness verdict, and the generation's
id, provider, model, prompt version and FactSheet hash.

**On `channel_listings`, two existing columns take on meaning.** `approved_at` is stamped by
every save from the editor: a person vouching for the text as it stands. `metadata.composedAt`
is stamped when a generation lands. When the second is newer than the first, Publish refuses.
`composedAt` is in metadata rather than a column because a rebuild drops it, correctly: the
adapter's draft replaced the model's and there is nothing left to review.

### B2: one field, and the way back

Migrations `20260908010000_field_generations_and_restore` and
`20260908010001_field_generations_check`.

`generation_type` gains `field`, and `ai_generations.field` names which one, in the listing
output's own key names (`title`, `shortDescription`, `seoTitle` and so on) rather than column
names, because a row is read back into that shape and never joined on the value. A check
constraint ties the two: `field` is present exactly when the type is `field`. It lives one
migration after the enum value because Postgres cannot reference a value in the transaction
that added it.

`snapshot_type` gains `restore`. A restore is not a generation: no model was called, and a
history that recorded it as one would answer "what changed before revenue moved" with a call
that never happened. The payload's `restore` key names the generation put back and, for a
field generation, the field.

**Credentials are nowhere near this table.** The runner loads the listing, the product and
its assets; it never loads a connection or a secret, and the prompt is built from the
FactSheet and the channel's profile alone.

## B5: commerce

**sales_events** — id, workspace_id, product_id, channel_listing_id, channel_id,
external_order_id, external_transaction_id, event_type, quantity, gross_revenue,
discount_amount, refund_amount, net_revenue, currency, occurred_at, synced_at, metadata

Unique constraint on (channel_id, external_transaction_id) so re-ingestion cannot double
count.

## B8: WooCommerce

Built. Migration `20260908090000_woocommerce_channel`.

One row in `channels`: key `woocommerce`, `integration_type = api`, `billable = false`. No
new table. The authorization flow reuses `channel_oauth_states`; the store posts the consumer
key and secret to the grant route, and they are sealed into `channel_connection_secrets` as
`{ consumerKey, consumerSecret }` like any other credential.

What the existing columns hold for this channel: `external_account_id` is the normalized
store address, host or host/path with no scheme; `external_account_name` is the site name;
`metadata.currency` is the store currency, read at grant time and compared by the
`currency_matches_store` requirement; `scopes` is `["read_write"]`. On the listing,
`external_listing_id` is the numeric product id as a string and `external_url` the admin edit
URL, which resolves before the product is live; `public_url` is the product's `permalink`.

`billable = false` takes decision 23's recommended reading, and the migration says so in a
comment. Flipping it is one migration, and nothing bills before C1 either way.

## C1: billing

Built. Migration `20260908200000_billing`.

**workspace_billing** — workspace_id (pk), external_customer_id, external_subscription_id,
subscription_status, billing_interval, base_item_id, channel_item_id, channel_quantity,
period_peak_quantity, current_period_start, current_period_end, cancel_at_period_end,
created_at, updated_at

One row per workspace, a mirror of what the payment provider holds. Readable by members,
writable by nobody in the browser: every write is the server's account of an external fact,
from a webhook or the checkout action, through the service role. `period_peak_quantity` is
the one piece of Fanwise's own state on it: the highest channel quantity billed this period,
which is how a reconnection inside a paid period is not charged twice.

**billing_events** — id, workspace_id, channel_connection_id, channel_id, kind, billable,
idempotency_key, status, attempt_count, applied_at, provider_response,
normalized_error_code, normalized_error_message, created_at, updated_at

The ledger. Written by the trigger `record_channel_billing_event()` on every insert and
delete of `channel_connections`, in the same transaction, which is `docs/billing.md` rule 1
made structural. `channel_connection_id` is deliberately not a foreign key: the disconnection
is recorded as the row is deleted, and the ledger outlives what it describes. `billable` is
captured from the channel at the moment of the event so a later change to which channels
bill does not rewrite history. The idempotency key is NOT NULL and unique, per invariant 3.

The trigger is `security definer` because authenticated holds no insert on the ledger and
should not. On delete it checks the workspace still exists: Postgres removes a parent before
cascading onto its children, so a connection deleted by a workspace deletion arrives with
nothing to reference, and that case is skipped rather than failed.

**billing_webhook_events** — id (the provider's event id), type, received_at,
processed_at, error

No grant to anon or authenticated, RLS on with zero policies. A redelivered event collides
on the key; one recorded but never finished is applied again, one finished is acknowledged.

## B9: Behance

Planned 11 September 2026, not built. The migration lands with B9.

One row in `channels`: key `behance`, `integration_type = assisted`, `billable = true`, since
it is a marketplace and decision 16 governs what an assisted one costs. No new table, and
nothing in `channel_connection_secrets`: the adapter declares no `oauth`, so Connect writes
the connection row and nothing else, and no credential for this channel ever exists.

What the existing columns hold: `external_account_id` is the profile username, parsed from
`behance.net/{username}`; `external_account_name` is the display name the creator typed, if
any. On the listing, `external_url` is the project URL captured at mark submitted,
`external_listing_id` the numeric project id parsed from it, and `metadata` carries the
chosen Creative Fields, the asset category, the license type and `handoffMode`, `new` or
`existing`. `status_source` is `self_reported` on every row and the trigger that refuses
`verified` on an assisted channel applies unchanged.

One question this channel puts to the model and does not answer: a Behance project holds up
to five assets, so one product could be several priced downloads on one project. Listing
uniqueness is `(product_id, channel_connection_id)`, one listing per product per connection,
and v1 keeps it by mapping one product to one project with one asset. Item 12 of
`docs/channels/behance.md` §13 is where that gets revisited, with evidence.

## B10: Gumroad

Planned 11 September 2026, not built. The migration lands with B10.

One row in `channels`: key `gumroad`, `integration_type = api`, `billable = true`; decision 23
records why a Gumroad page bills when a WooCommerce store does not. No new table. The
authorization reuses `channel_oauth_states`, including `code_verifier` for PKCE.

What the existing columns hold: `external_account_id` is the Gumroad user id;
`external_account_name` the account name; `metadata.profileUrl`; `scopes` is
`["edit_products"]`; `expires_at` is null, because Gumroad's access tokens do not expire.
Credentials are `{ accessToken, refreshToken }`, sealed. On the listing,
`external_listing_id` is the product's external id, `external_url` its `short_url`, and
`metadata` holds the permalink, the cover ids, and the uploaded files as
`{ assetId, fileId, fileUrl }`.

That last has no precedent in this model. Gumroad returns a file's canonical URL once, at
upload, and an update that does not resend it deletes the file. So `metadata.files` is not a
cache: losing it would make the next update remove the buyer's download, and the adapter
refuses an update whose stored files disagree with the product's rather than guess.

## Public creator pages

Built. Migration `20260912010000_public_creator_pages`.

The first tables in Fanwise that `anon` may read. Everything else in this document
describes data one workspace can see; this section describes data the open web can
see, and the differences are the parts worth reading twice.

**public_profiles** — id, workspace_id, handle (citext, unique), display_name,
short_bio, about, city, country_code, location, avatar_path, contact_url, status,
seo_title, seo_description, published_at, created_at, updated_at; and the deprecated
website_url, instagram_url, behance_url (see below)

**public_profile_links** — id, workspace_id, public_profile_id, position (0–7, unique per
profile), url (https only), label (null derives one), created_at

**public_profile_drafts** — public_profile_id (pk), workspace_id, handle, display_name,
short_bio, about, city, country_code, location, links (jsonb), contact, avatar_path,
products (jsonb), revision, updated_by, created_at, updated_at; and the deprecated
website, instagram, behance

The profile builder's unpublished working copy, one per profile
(20260912220000). Autosave writes here and **never** to `public_profiles`; only
publication copies a draft onto the live row. `anon` holds no grant at all. Text
columns are stored as typed and bounded only by length, so a half-typed link survives
a refresh; validation is the builder's Continue and Publish, not a CHECK. `revision`
is optimistic concurrency: a save names the revision it read and a mismatch is a
conflict. The tenant boundary is the composite FK `(public_profile_id, workspace_id)`.

`products` is the builder's step 2: an array of `{ productId, visible }` in display
order, every arranged product included, so hiding one keeps its position. Order is
array position; there are no separate order numbers. Product ids cannot be foreign keys
inside jsonb, so `check_profile_draft_products` (20260912220100) refuses a malformed
entry, a repeated product, or a product outside the draft's workspace on every write,
including a direct PostgREST one. A product is **eligible** for a profile when it is not
archived and at least one of its listings is `live` by the catalog's `liveness()` rule
(`lib/public/product-arrangement.ts`); an arranged product that later becomes
ineligible keeps its entry and flag but is never previewed or published.

`location` and `contact` (20260913020000) are the two optional step 1 fields, added
back after the builder shipped without them. `contact` is a bare email address or a
web page; publication writes it to `public_profiles.contact_url` as `mailto:` or https,
and an empty field removes the Contact button. The migration backfilled both from the
live row into drafts that already existed, because an empty draft column would
otherwise have erased a creator's location or contact link on their next publish. A
publication recorded before that migration has no `location` or `contact_url` key in
its snapshot; both the publish function's no-op check and the builder's "changes to
publish" state fill those keys from the live row, which the previous publish function
never wrote.

**The storefront fields (20260913030000).** Four changes, each keeping every value a
creator already had.

- *Links a creator chooses.* The three fixed links became `public_profile_links`, up to
  eight rows in the creator's order, and `public_profile_drafts.links`, the same list as
  typed. A normalized table on the live side because the public route reads it as `anon`
  and each row carries its own https CHECK; jsonb on the draft side because a draft is
  stored as typed, the convention `products` set. Only `publish_public_profile()` writes
  link rows (no member holds a write grant); `anon` reads them only while the profile is
  published. The migration copied every live `website_url`, `instagram_url` and
  `behance_url` into rows, and every draft's typed values into `links` (a bare `@name`
  becomes its instagram.com or behance.net address; anything unparseable is carried as
  typed, never dropped). The six old columns stay in place and unread; publication nulls
  the three live ones so a removed link is not left readable signed out. A platform
  (Instagram, Behance, Dribbble, LinkedIn, X, YouTube, TikTok, Pinterest, Vimeo, Threads,
  Bluesky, GitHub) only chooses an icon and a default label; every other address is a
  website and draws a globe. Favicons are not fetched, for the visitor's privacy.
- *Structured location.* `country_code` is ISO 3166-1 alpha-2 (CHECK `^[A-Z]{2}$`); the
  display name is derived, never stored. `city` requires a country (CHECK) and is the
  location dataset's spelling, checked against that country on the server at Continue and
  at publish, so a mismatched pair cannot reach the live row. The legacy free-text
  `location` is kept untouched and shown until a country is chosen; publishing a country
  clears it. Nothing parses the old text. The dataset is `lib/location/data`, built by
  `scripts/build-location-data.mjs` from GeoNames `cities15000` and `countryInfo`
  (CC BY 4.0, https://www.geonames.org/): 252 countries and 34,014 places of 15,000 people
  or more, searched in memory on the server. A smaller town is not in it; its creator can
  choose the country alone or the nearest city. No provider, account or key is involved.
- *About.* `about`, up to 2,000 characters, shown in the profile's About section. Kinds of
  product ("Makes") are derived from the products shown, not stored.
- *Publish all products.* `publish_all_profile_products()` publishes named, unarchived
  products of the caller's own workspace onto an already-published profile (PT412
  otherwise), appends nothing it was not asked to, takes nothing down, updates the draft's
  arrangement and revision in the same transaction, records a publication, and returns
  `unchanged` when there is nothing to do. It shares `publish_profile_product_pages()` with
  `publish_public_profile()` (neither helper is executable by any browser role). Listing
  liveness is decided by the server action, as for the builder. It never reads or writes
  a listing, channel or connection: public Fanwise visibility only. It acts on the
  products that exist when pressed; there is no auto-publish preference.

Snapshots recorded before this migration carry `website_url`, `instagram_url` and
`behance_url` and lack `links`, `about`, `city` and `country_code`. The publish function's
no-op check and the builder's "changes to publish" state both drop the retired keys and
fill the missing ones from the live row and its links, so an unchanged profile still reads
as unchanged.

`profile` also joined `products_slug_not_reserved`, because the profile's management pages
moved from `/<workspace>/settings/public-profile` to `/<workspace>/profile` (old addresses
redirect permanently). A product already slugged `profile` is renamed `profile-xxxx`.

**public_profile_publications** — id, public_profile_id, workspace_id, handle,
draft_updated_at, snapshot (jsonb), published_by, published_at

One immutable row per successful publish (20260912220200), written only by
`publish_public_profile()`. **The live rows stay the published state**: the public route
still reads `public_profiles` and `public_product_pages` through anon RLS, and never a
draft. Publishing is that one security-definer function, one transaction: it locks the
profile and draft, refuses a draft changed since review (PT409), claims the handle (a
held one raises 23505 and rolls everything back), writes the profile columns, publishes
exactly the draft's shown products in order with `featured` cleared, sets every other page
under the profile back to draft, and records the snapshot. Publishing an unchanged draft
again returns the existing publication and writes nothing. A never-published profile's
old handle is not kept as a redirect; a published one's is. The builder is the only
authority for which product pages a profile publishes; the product editor edits a page's
copy, not its visibility.

A **public profile is not a workspace**. A workspace is an operational container with
a slug for `/<slug>`; a profile is a public identity with a handle for `/@<handle>`.
They are separate fields on separate tables, and the handle is never derived from a
name that can change underneath it.

One profile per workspace is a **V1 limit expressed as a droppable index**,
`public_profiles_one_per_workspace_idx`, not a modelling assumption. Nothing else in
the schema assumes it; drop that one index and a workspace owns several.

The handle character set is lowercase ASCII letters, digits and single internal
hyphens, and the narrowness is not tidiness. A handle is an identity claim rendered
in someone else's typeface, and a set that admits Unicode admits Cyrillic `а`, Greek
`ο`, a zero-width joiner between two letters — each producing a handle a reader
cannot distinguish from an existing one and a database treats as new. ASCII cannot
express that attack.

Note the cast in `public_profiles_handle_format`: `~` on a **citext** operand is the
case-*insensitive* match, so an uncast `handle ~ '^[a-z0-9...]'` accepts `NorthLine`.
The constraint reads as though it forbids uppercase and does not. `workspaces.slug`
and `products.slug` carry the same shape and are deployed; they are unaffected in
practice because `lib/slug.ts` lowercases before insert, but the constraint there is
weaker than it looks.

**public_handle_history** — id, public_profile_id, workspace_id, handle (unique),
created_at

A handle a profile has released. `/@old-handle` permanently redirects to the current
one, so a link printed in somebody's portfolio does not rot. That makes uniqueness a
rule **spanning two tables**, which no single unique index can express, so a trigger
enforces it from both sides. Rows are written only by `release_public_handle()`,
which changes the handle and records the old one in one transaction.

**public_product_pages** — id, workspace_id, public_profile_id, product_id, slug
(citext), status, featured, display_order, title_override, summary_override,
description_override, cover_asset_id, seo_title, seo_description, published_at,
created_at, updated_at

Inherits from `products`; the override columns are the deliberate exceptions rather
than a copy of the record. Unique on `(public_profile_id, slug)` and on
`(public_profile_id, product_id)`: one public page per product, so a product cannot
compete with itself for a search result.

The tenant boundary is a foreign key, as it is on `product_assets`. The profile, the
product and the cover asset are each referenced as an `(id, workspace_id)` pair, so a
member cannot point their own workspace's public page at another workspace's product.

**public_product_slug_history** — the same redirect model one level down, scoped to
the profile rather than globally.

**public_outbound_clicks** — id, workspace_id, public_profile_id,
public_product_page_id, channel_id, occurred_at, referrer_host, campaign

Deliberately thin, and the absences are the design: no IP, no user agent, no cookie,
no visitor or session identifier, and the referrer reduced to a bare host before it is
stored. Enough to tell a creator which channel a page drives; not enough to
reconstruct anybody's browsing. **No grant to `anon` at all** — a route handler writes
with the service role after checking the page is genuinely published, so a table that
accepts anonymous writes never exists.

### What `anon` may read, and how much of it

Nothing is public until somebody published it. Both tables are born `draft`, and a
published product page is additionally gated on its parent profile being published,
so unpublishing a profile takes every product beneath it — and their canonical
`products`, `product_assets` and `channel_listings` rows — out of public view in one
write.

A public product page renders facts from `products`, `product_assets` and
`channel_listings`, none of which had ever been readable by `anon`. A policy alone
would have been the wrong tool, for the reason recorded above about credentials:
**RLS filters rows, never columns**. So `anon` holds **column-level SELECT grants** —
a named list per table, which makes `select *` a permission error rather than a wide
read — and the policies then restrict those columns to genuinely published rows. Both
halves are load-bearing. `storage_path`, `channel_connection_id`, `status` and
`archived_at` are among the columns deliberately absent.

### The creator directory (20260914100000)

`/creators` lists public creators. It adds no copy of any profile or product: it reads
three **`security_invoker` views**, so `anon` sees through them exactly what `anon` sees
in the tables beneath, and nothing more. None is readable by `authenticated`, whose
member policies would let a creator's own drafts through.

**public_creator_directory**: one row per published profile with at least one published,
unarchived product. Carries product_count, latest_published_at, product_types (for
filtering), up to four representative products (featured page, has an image, the
creator's order, most recent, slug), `featured_rank`, and `search_text`: lowercase public
text only (name, introduction, About, place, published titles and types).
**public_creator_product_types**: published counts per creator and type, for each card's
primary types. **public_creator_locations**: distinct country and city pairs for the
filters.

**public_featured_profiles**: public_profile_id (pk), rank (unique, 1–1000),
created_at. Fanwise's editorial selection for "Featured creators · Selected by Fanwise".
`anon` may read a row only while its profile is published; `authenticated` has no grant,
so a creator cannot feature themselves. Written by the service role, by hand, with no
admin UI. Featuring grants no visibility.

The same migration adds `archived_at is null` to the `anon` policy on `products`, so an
archived product leaves every public surface (the directory, the profile catalog, the
product page), and reserves `creators` as a workspace slug.

Those policies are `to anon` and not `to anon, authenticated`, because `authenticated`
already holds all-column SELECT on those tables: adding that role to a permissive
policy would hand a signed-in member every column of another workspace's product the
moment it was published. The public read path never runs as `authenticated` —
`lib/supabase/public.ts` is cookie-less by construction.

`anon` executes **no function in `public`**. The published-ness gate is an inline
subquery naming `status = 'published'` explicitly, rather than the tidier security
definer helper, precisely so that stays true.

## Importing a product from sources

Off-roadmap, like the link importer it extends (`docs/product-link-import.md` §14 and §15).
Not B12: nothing here reads a connected channel.

`product_imports` is the **import session**: one per draft product, holding the combined
evidence, the suggestions, what the creator accepted, and the legacy URL columns that carry the
one-live-import-per-link index. `submission_id` (unique per workspace) is the composer's
idempotency key. `suggestions.draft` follows `draftOutputSchema` (`lib/imports/draft-output.ts`);
since schema version `2026-09-16.1` it carries `details`, the specifications a source stated in
one flat shape for every product type, each value kept only when the sources contain it
(`docs/product-link-import.md` §16). On save the surviving details and the tags land on
`products.metadata` in the chosen type's shape; the session row is never the source of truth.

`product_import_sources` is one row per source, `import_id` nullable only while a file or
recording is staged in the composer:

| Column | Notes |
|---|---|
| `source_type` | `public_url`, `pasted_text`, `pdf`, `html`, `audio`, `image` (a picture, copied to `product_assets` when read) |
| `status` | `uploading`, `staged`, `transcribing`, `pending`, `reading`, `ready`, `failed`, `unavailable`, `removed` |
| `position` | the creator's order, unique per live import |
| `source_url`, `normalized_url` | links only; at most one live link per import |
| `storage_path` | `<workspace_id>/import-sources/<uuid>.<ext>`, held to the row's workspace by check |
| `mime_type`, `byte_size`, `duration_ms` | sniffed and measured server-side |
| `text_content` | pasted text, or a recording's transcript |
| `evidence`, `content_hash` | what reading this source produced |
| `error_code`, `error_message` | normalized, from `lib/imports/errors.ts` |

`(import_id, workspace_id)` references `product_imports (id, workspace_id)`. RLS delegates to
`is_workspace_member`; no delete grant, removal is `removed`. `create_import_session` (security
invoker) creates the product, the session and every source in one transaction. Migration
`20260912230000_product_import_sources` backfilled one source for every existing import.
`20260916150000_import_image_sources` added `image` and the `png|jpg|gif|webp` paths.

## B12: importing a live listing

Planned 12 September 2026, not built. The migration lands with B12. The plan is
`docs/listing-import.md`.

**No new table, and no new column.** Import writes the rows publishing already writes, from
the other direction: one `products` row, one `channel_listings` row with its
`external_listing_id` claimed, `product_assets` rows for the images, and one snapshot. If
this step grows a table, something has been misread.

`snapshot_type` gains one member, `import`, and that is the whole migration. The snapshot
holds the provider's payload as it arrived, before any mapping, and it is insert-only like
every other: it is the only record of what the marketplace said on the day, and the answer to
every later question about where a canonical field came from.

`channel_listings.metadata.import` holds `{ importedAt, sourceUrl, unmappedFields, writes }`.
`unmappedFields` is what the review screen showed the creator as dropped — a marketplace
concept with no canonical home is named there rather than discarded silently. `writes` counts
the publishes and updates Fanwise has since made to the listing, and it is maintained by
those paths rather than derived afterwards, because it decides whether the listing may be
forgotten at disconnection: a listing imported and never written to can be, since forgetting
it restores the world to before the import. Decision 21.

The imported listing reads `status = published` and `status_source = verified`, which is
honest — Fanwise read it on the channel — and it is the first `verified` row in the model
that no publication produced. Nothing downstream needs to tell the two apart; anything that
did would be asking about provenance, and provenance is what the `import` snapshot is for.

**What import may not write is a canonical field nobody confirmed.** The provider payload
reaches `products` only through a person accepting it on the review screen, which is
architecture invariant 1 held at the one place in the plan where a marketplace's shape flows
inward. Imported copy that the creator does not promote stays on the listing, where it is
copy for one channel rather than a fact the FactSheet would let AI restate on another.
Decision 29.
