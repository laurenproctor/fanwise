# Data model

Tables arrive with the step that needs them. This file is the plan, not the current schema;
run `pnpm db:types` for what actually exists.

## A1: tenancy

Built. Migration `20260904042945_workspaces_and_membership`.

**workspaces** — id, name, slug (citext, unique), owner_user_id, created_at,
updated_at. Check constraints on name length, slug format and slug length, so a
malformed slug cannot reach a row even if the app forgets to validate.

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
- `workspaces` has no INSERT policy. Rows are born only through
  `create_workspace(name, slug)`, which writes the workspace and its owner
  membership in one statement. A brand new user is a member of nothing, so no
  policy could authorise their first insert, and no workspace can exist without
  an owner.

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
channel_connection_id, external_listing_id, external_url, status, status_source,
title, description, short_description, price, currency, category, tags, metadata,
generated_at, approved_at, published_at, last_synced_at, created_at, updated_at

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

**The trigger permits exactly one kind of delete: a cascade whose parent is
already gone.** Postgres removes a parent row before firing the cascade onto its
children, so a snapshot can tell the two apart. Without this, immutability would
block workspace deletion outright, and "never deleted" would be a promise the
product could not keep the first time someone asked for their account to be
removed. A direct delete is still refused.

## A5 to A7: publishing

**publication_jobs** — id, workspace_id, channel_listing_id, idempotency_key, status,
attempt_count, started_at, completed_at, provider_response, normalized_error_code,
normalized_error_message, created_at

**workspace_events** — append-only activity log. Never updated, never deleted.

## B1: AI

**ai_generations** — id, workspace_id, product_id, channel_listing_id, generation_type,
provider, model, prompt_version, input_hash, factsheet_hash, structured_output, status,
input_tokens, output_tokens, estimated_cost, created_at

`factsheet_hash` is what lets a bad listing be traced back to the facts that produced it.

## B5: commerce

**sales_events** — id, workspace_id, product_id, channel_listing_id, channel_id,
external_order_id, external_transaction_id, event_type, quantity, gross_revenue,
discount_amount, refund_amount, net_revenue, currency, occurred_at, synced_at, metadata

Unique constraint on (channel_id, external_transaction_id) so re-ingestion cannot double
count.
