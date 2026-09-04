-- Step A2: the canonical product, its assets, and private storage.
--
-- The record here is authoritative and stays Fanwise-shaped. No channel-specific
-- column belongs on products, ever (architecture invariant 1). Channel listings
-- arrive in A3 and carry their own table.
--
-- Three things in this migration are load-bearing:
--
--   1. product_assets is immutable once ready. The derivative cache is keyed on
--      (derived_from, spec_hash) alone, with no checksum in the key, and that is
--      only sound because the bytes behind derived_from can never change.
--      Replacing a file creates a new row. Enforced by a trigger, not a
--      convention.
--   2. Storage paths start with the workspace id, so one policy expression
--      covers every object in the bucket.
--   3. RLS repeats the A1 pattern exactly: policies delegate to
--      is_workspace_member / is_workspace_owner, auth.uid() is always wrapped as
--      (select auth.uid()), and neither table is FORCE row level security.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- Fanwise's own taxonomy, deliberately coarse. See docs/data-model.md: finer
-- distinctions (serif vs sans, print vs web) live in metadata, and a channel's
-- own category tree is the adapter's problem, not the product's.
create type public.product_type as enum (
  'font',
  'template',
  'graphic',
  'photo',
  'illustration',
  'icon',
  'mockup',
  'brush',
  'three_d',
  'theme',
  'other'
);

create type public.product_status as enum (
  'draft',
  'incomplete',
  'ready',
  'publishing',
  'published',
  'archived'
);

create type public.asset_type as enum (
  'deliverable',
  'source_file',
  'archive',
  'cover_image',
  'preview_image',
  'thumbnail',
  'specimen',
  'documentation',
  'license',
  'screenshot',
  'promotional',
  'other'
);

-- pending: the row exists and a signed upload URL was issued, but nothing has
-- been verified. ready: bytes are in storage and have been measured. failed: the
-- finalize job could not verify the object.
create type public.asset_state as enum ('pending', 'ready', 'failed');

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  slug extensions.citext not null,
  product_type public.product_type not null,
  status public.product_status not null default 'draft',
  canonical_title text,
  canonical_description text,
  short_description text,
  brand_name text,
  base_price numeric(12, 2),
  currency text not null default 'USD',
  version text,
  support_url text,
  documentation_url text,
  license_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint products_name_not_blank check (length(btrim(name)) between 1 and 200),
  constraint products_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_slug_length check (length(slug::text) between 3 and 64),
  constraint products_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint products_base_price_non_negative check (base_price is null or base_price >= 0),
  -- Slugs are unique per workspace, not globally. Two creators may both ship
  -- "aster-grotesk", and neither should learn that the other exists.
  constraint products_slug_unique_per_workspace unique (workspace_id, slug),
  -- Redundant against the primary key, but it is the target a composite foreign
  -- key needs. See product_assets below.
  constraint products_id_workspace_unique unique (id, workspace_id)
);

comment on table public.products is
  'The canonical product. Source of truth. Never shaped by a marketplace.';

comment on column public.products.metadata is
  'Type-specific facts, validated in the application by a discriminated union keyed on product_type. Never channel-specific.';

create index products_workspace_id_idx on public.products (workspace_id);
create index products_workspace_status_idx on public.products (workspace_id, status);

create trigger set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- product_assets
-- ---------------------------------------------------------------------------

create table public.product_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid not null,
  asset_type public.asset_type not null,
  asset_state public.asset_state not null default 'pending',
  storage_path text not null unique,
  filename text not null,
  mime_type text,
  byte_size bigint,
  checksum text,
  sort_order integer not null default 0,
  derived_from uuid,
  spec_hash text,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint product_assets_filename_not_blank check (length(btrim(filename)) between 1 and 255),
  constraint product_assets_byte_size_non_negative check (byte_size is null or byte_size >= 0),
  -- A derivative is exactly "a source plus a spec". Both columns travel together
  -- or neither does.
  constraint product_assets_derivative_pair check (
    (derived_from is null and spec_hash is null)
    or (derived_from is not null and spec_hash is not null)
  ),
  -- A ready asset has been measured. A pending one has not.
  constraint product_assets_ready_is_measured check (
    asset_state <> 'ready'
    or (checksum is not null and byte_size is not null and mime_type is not null)
  ),
  -- The composite foreign key is the point. Referencing products(id) alone would
  -- let a member attach an asset carrying their OWN workspace_id to someone
  -- else's product: the RLS policy checks workspace_id and would pass. Pairing
  -- the columns makes the tenant boundary a foreign key, which no policy can be
  -- talked out of.
  constraint product_assets_product_fk
    foreign key (product_id, workspace_id)
    references public.products (id, workspace_id)
    on delete cascade,
  -- Same reasoning for derivatives: a derivative cannot point at a source in
  -- another workspace.
  constraint product_assets_id_workspace_unique unique (id, workspace_id),
  constraint product_assets_derived_from_fk
    foreign key (derived_from, workspace_id)
    references public.product_assets (id, workspace_id)
    on delete cascade
);

comment on table public.product_assets is
  'Binaries live in object storage; this table is the index. Immutable once ready: replacing a file creates a new row.';

comment on column public.product_assets.spec_hash is
  'Stable hash of the ImageSpec that produced this derivative. With derived_from it forms the whole cache key.';

-- The derivative cache, expressed as a constraint rather than as lookup logic.
-- One source plus one spec can yield exactly one derivative, so a concurrent
-- rebuild collides here instead of duplicating work.
create unique index product_assets_derivative_cache_idx
  on public.product_assets (derived_from, spec_hash)
  where derived_from is not null;

create index product_assets_product_id_idx on public.product_assets (product_id);
create index product_assets_workspace_id_idx on public.product_assets (workspace_id);
create index product_assets_derived_from_idx on public.product_assets (derived_from);

-- Immutability. The derivative cache key omits the source checksum, so the bytes
-- behind derived_from must never change under it. sort_order and metadata are
-- presentation, not content, and stay editable.
create or replace function public.enforce_asset_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.asset_state <> 'ready' then
    return new;
  end if;

  if new.asset_state is distinct from old.asset_state
    or new.storage_path is distinct from old.storage_path
    or new.filename is distinct from old.filename
    or new.mime_type is distinct from old.mime_type
    or new.byte_size is distinct from old.byte_size
    or new.checksum is distinct from old.checksum
    or new.derived_from is distinct from old.derived_from
    or new.spec_hash is distinct from old.spec_hash
    or new.asset_type is distinct from old.asset_type
    or new.product_id is distinct from old.product_id
    or new.workspace_id is distinct from old.workspace_id
  then
    raise exception 'product_assets are immutable once ready; replace the file with a new row'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_asset_immutability is
  'Blocks content changes to a ready asset. This is what makes (derived_from, spec_hash) a sound cache key without a checksum in it.';

create trigger enforce_asset_immutability
  before update on public.product_assets
  for each row execute function public.enforce_asset_immutability();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.products enable row level security;
alter table public.product_assets enable row level security;

-- Deliberately NOT forced, for the reason recorded in the A1 migration.

revoke all on public.products from anon, authenticated;
revoke all on public.product_assets from anon, authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.product_assets to authenticated;

create policy "products are readable by workspace members"
  on public.products for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "products are insertable by workspace members"
  on public.products for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "products are updatable by workspace members"
  on public.products for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "products are deletable by workspace members"
  on public.products for delete to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "product assets are readable by workspace members"
  on public.product_assets for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "product assets are insertable by workspace members"
  on public.product_assets for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "product assets are updatable by workspace members"
  on public.product_assets for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "product assets are deletable by workspace members"
  on public.product_assets for delete to authenticated
  using (public.is_workspace_member(workspace_id));
