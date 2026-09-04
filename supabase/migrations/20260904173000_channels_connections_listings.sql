-- Step A3: the channel registry, connections, listings and snapshots.
--
-- The direction of travel is fixed by architecture invariant 1:
--
--     CANONICAL PRODUCT  ->  CHANNEL ADAPTER  ->  LISTING
--
-- Nothing here reaches back into products. No column on this schema is named
-- after a marketplace, and no marketplace string appears in it: the two seeded
-- rows are mocks, and every real provider arrives as an adapter in
-- lib/channels/adapters, not as a column.
--
-- Four things in this migration are load-bearing:
--
--   1. channels is a catalog, not tenant data. It is world-readable to signed-in
--      users and writable by nobody: rows are born in migrations. Capabilities
--      deliberately do NOT live here. They are declared in code
--      (lib/channels/registry.ts) because a capability stored in an editable row
--      is a capability that can be made to lie, and capability lying is how
--      tools in this space lose trust.
--   2. Credentials are a separate table with no grant to authenticated at all.
--      RLS filters rows, never columns, so an encrypted_credentials column on
--      channel_connections would sit one `select *` away from the browser. This
--      is a deliberate departure from the earlier sketch in docs/data-model.md.
--   3. An assisted channel can never claim verification. Enforced by a trigger,
--      because the fact lives on channels and the claim lives on
--      channel_listings, which is further than a check constraint can see.
--   4. listing_snapshots is insert-only against everyone, service role included.
--      Grants stop the app; the trigger stops everything else.
--
-- RLS repeats the A1 and A2 pattern exactly: policies delegate to
-- is_workspace_member, auth.uid() is always wrapped as (select auth.uid()), and
-- no table is FORCE row level security.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- api: Fanwise can act on the channel through its API.
-- assisted: Fanwise prepares, a human submits. There is no third mode, and an
-- adapter that cannot publish must be declared assisted rather than declared
-- api with a publish method that quietly does nothing.
create type public.channel_integration_type as enum ('api', 'assisted');

create type public.channel_status as enum ('available', 'coming_soon', 'unavailable');

create type public.connection_status as enum ('active', 'expired', 'revoked', 'error');

create type public.listing_status as enum (
  'draft',
  'ready',
  'publishing',
  'published',
  'failed',
  'archived'
);

-- verified: a provider API confirmed this state.
-- self_reported: a human told us. Nothing that implies verification may read
-- these as equal, which is why this is a type and not a boolean called
-- is_published.
create type public.listing_status_source as enum ('verified', 'self_reported');

create type public.snapshot_type as enum ('build', 'publish', 'update', 'unpublish');

-- ---------------------------------------------------------------------------
-- channels
--
-- A global catalog. Not tenant-scoped, so it carries no workspace_id and no
-- membership policy: every signed-in user sees the same list of destinations.
-- ---------------------------------------------------------------------------

create table public.channels (
  id uuid primary key default extensions.gen_random_uuid(),
  key extensions.citext not null unique,
  name text not null,
  integration_type public.channel_integration_type not null,
  status public.channel_status not null default 'available',
  -- Billing reads this column and never a plan name (docs/billing.md rule 4).
  -- The owned storefront is included in the base price; every external
  -- marketplace is billable. It ships now, unused, because backfilling it
  -- across live connections at C1 would be worse.
  billable boolean not null default true,
  created_at timestamptz not null default now(),
  constraint channels_key_format check (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint channels_name_not_blank check (length(btrim(name)) between 1 and 80)
);

comment on table public.channels is
  'Catalog of commerce destinations. Identity only: capabilities are declared in code, never stored here.';

comment on column public.channels.billable is
  'False for an owned storefront included in the base price. Read by the entitlement service at C2, never by a component.';

-- ---------------------------------------------------------------------------
-- channel_connections
-- ---------------------------------------------------------------------------

create table public.channel_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete restrict,
  external_account_id text,
  external_account_name text,
  status public.connection_status not null default 'active',
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The same external account is connected to a workspace once. A creator with
  -- two shops on one channel gets two rows, which is also two billable units.
  constraint channel_connections_account_unique
    unique (workspace_id, channel_id, external_account_id),
  -- Target for the composite foreign key from channel_listings.
  constraint channel_connections_id_workspace_unique unique (id, workspace_id)
);

comment on table public.channel_connections is
  'An authenticated relationship to a channel. Carries no secret: credentials live in channel_connection_secrets.';

create index channel_connections_workspace_id_idx
  on public.channel_connections (workspace_id);
create index channel_connections_workspace_channel_idx
  on public.channel_connections (workspace_id, channel_id);

create trigger set_updated_at
  before update on public.channel_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- channel_connection_secrets
--
-- Separated from channel_connections on purpose. RLS filters rows, not columns,
-- so a credential living beside readable columns is protected only by every
-- future query remembering to name its columns. This table instead has no grant
-- to anon or authenticated at all: it is unreachable through PostgREST, and the
-- only path to it is the service role, from server code, per docs/security.md.
--
-- A3 creates it and never writes to it. The credentials service arrives at A5
-- with the first real connection, and the key rotation plan is written before
-- the first real credential is stored, not after.
-- ---------------------------------------------------------------------------

create table public.channel_connection_secrets (
  channel_connection_id uuid primary key
    references public.channel_connections (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  encrypted_credentials text not null,
  -- Which CREDENTIALS_ENCRYPTION_KEY version sealed this row. Rotation reads
  -- it; without it, rotation is a guess.
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.channel_connection_secrets is
  'Encrypted marketplace credentials. No grant to anon or authenticated: service role only, read server-side, never logged, never in a prompt, never returned to the browser.';

create trigger set_updated_at
  before update on public.channel_connection_secrets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- channel_listings
-- ---------------------------------------------------------------------------

create table public.channel_listings (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid not null,
  channel_id uuid not null references public.channels (id) on delete restrict,
  channel_connection_id uuid not null,
  external_listing_id text,
  external_url text,
  status public.listing_status not null default 'draft',
  status_source public.listing_status_source not null default 'self_reported',
  title text,
  description text,
  short_description text,
  price numeric(12, 2),
  currency text not null default 'USD',
  category text,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_listings_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint channel_listings_price_non_negative check (price is null or price >= 0),
  -- One listing per product per connection, not per channel. Two shops on the
  -- same marketplace are two connections and therefore two listings, and the
  -- creator is billed for two channels.
  constraint channel_listings_product_connection_unique
    unique (product_id, channel_connection_id),
  -- Target for the composite foreign key from listing_snapshots. It has to
  -- exist before that table is created, not after.
  constraint channel_listings_id_workspace_unique unique (id, workspace_id),
  -- Tenant boundary as a foreign key, for the reason recorded in A2: a policy
  -- checking workspace_id alone still permits attaching a row carrying your own
  -- workspace_id to someone else's product.
  constraint channel_listings_product_fk
    foreign key (product_id, workspace_id)
    references public.products (id, workspace_id)
    on delete cascade,
  constraint channel_listings_connection_fk
    foreign key (channel_connection_id, workspace_id)
    references public.channel_connections (id, workspace_id)
    on delete cascade
);

comment on table public.channel_listings is
  'The channel-specific representation of a product. Every channel-shaped field lives here so that none of them ever lands on products.';

comment on column public.channel_listings.status_source is
  'verified only when a provider API confirmed it. An assisted channel can never produce verified; a trigger enforces it.';

create index channel_listings_workspace_id_idx on public.channel_listings (workspace_id);
create index channel_listings_product_id_idx on public.channel_listings (product_id);
create index channel_listings_connection_id_idx
  on public.channel_listings (channel_connection_id);

-- One external object is represented once. This is the constraint that makes a
-- duplicate publication visible at the database rather than in a support email.
create unique index channel_listings_external_id_unique_idx
  on public.channel_listings (channel_id, external_listing_id)
  where external_listing_id is not null;

create trigger set_updated_at
  before update on public.channel_listings
  for each row execute function public.set_updated_at();

-- The honesty constraint. integration_type lives on channels and the claim
-- lives here, which is further apart than a check constraint can see, so it is
-- a trigger.
create or replace function public.enforce_listing_status_source()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_integration public.channel_integration_type;
begin
  if new.status_source <> 'verified' then
    return new;
  end if;

  select c.integration_type into v_integration
  from public.channels c
  where c.id = new.channel_id;

  if v_integration = 'assisted' then
    raise exception 'an assisted channel cannot report a verified status; nothing confirmed it'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_listing_status_source is
  'Blocks status_source = verified on an assisted channel. Assisted status is self-reported by a human and must never be read as equal to an API confirmation.';

create trigger enforce_listing_status_source
  before insert or update on public.channel_listings
  for each row execute function public.enforce_listing_status_source();

-- ---------------------------------------------------------------------------
-- listing_snapshots
--
-- Immutable history. Cheap now, and the only way to answer "what changed before
-- revenue moved" later. Arriving at A3 rather than A7 so the constraint and its
-- test land with the schema instead of under publish-flow pressure.
-- ---------------------------------------------------------------------------

create table public.listing_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_listing_id uuid not null,
  product_id uuid not null,
  channel_id uuid not null references public.channels (id) on delete restrict,
  snapshot_type public.snapshot_type not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint listing_snapshots_listing_fk
    foreign key (channel_listing_id, workspace_id)
    references public.channel_listings (id, workspace_id)
    on delete cascade
);

comment on table public.listing_snapshots is
  'Immutable record of a listing at a moment. Never updated, never deleted, by anyone including the service role.';

create index listing_snapshots_listing_id_idx
  on public.listing_snapshots (channel_listing_id, created_at desc);
create index listing_snapshots_workspace_id_idx on public.listing_snapshots (workspace_id);

create or replace function public.enforce_snapshot_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- An edit is never legitimate. There is no cascade that rewrites a row.
  if tg_op = 'UPDATE' then
    raise exception 'listing_snapshots is insert-only; a snapshot is history and history is not edited'
      using errcode = '23514';
  end if;

  -- A delete is legitimate in exactly one case: the thing the snapshot
  -- describes is itself being deleted. Postgres removes the parent row before
  -- firing the cascade onto children, so if both parents are still present this
  -- is a direct delete and it is refused.
  --
  -- Without this, immutability would block workspace deletion entirely, which
  -- would make "never deleted" a promise the product could not keep the first
  -- time someone asked for their account to be removed.
  if exists (select 1 from public.channel_listings l where l.id = old.channel_listing_id)
     and exists (select 1 from public.workspaces w where w.id = old.workspace_id)
  then
    raise exception 'listing_snapshots is insert-only; delete the listing if the history should go with it'
      using errcode = '23514';
  end if;

  return old;
end;
$$;

comment on function public.enforce_snapshot_immutability is
  'Blocks every UPDATE, and every DELETE except a cascade from a parent that is already gone. Grants stop the app; this stops the service role too.';

create trigger enforce_snapshot_immutability
  before update or delete on public.listing_snapshots
  for each row execute function public.enforce_snapshot_immutability();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.channels enable row level security;
alter table public.channel_connections enable row level security;
alter table public.channel_connection_secrets enable row level security;
alter table public.channel_listings enable row level security;
alter table public.listing_snapshots enable row level security;

-- Deliberately NOT forced, for the reason recorded in the A1 migration.

revoke all on public.channels from anon, authenticated;
revoke all on public.channel_connections from anon, authenticated;
revoke all on public.channel_connection_secrets from anon, authenticated;
revoke all on public.channel_listings from anon, authenticated;
revoke all on public.listing_snapshots from anon, authenticated;

-- channels: readable by any signed-in user, writable by nobody. Rows are born
-- in migrations, so there is no INSERT, UPDATE or DELETE grant and no policy
-- that could authorise one.
grant select on public.channels to authenticated;

create policy "channels are readable by any signed-in user"
  on public.channels for select to authenticated
  using (true);

-- channel_connection_secrets: no grant at all, deliberately. The table has RLS
-- enabled and zero policies, so even if a grant were added by mistake later,
-- every row would still be filtered away.

grant select, insert, update, delete on public.channel_connections to authenticated;
grant select, insert, update, delete on public.channel_listings to authenticated;
-- Snapshots are insert-only at the grant level as well as the trigger level.
grant select, insert on public.listing_snapshots to authenticated;

create policy "connections are readable by workspace members"
  on public.channel_connections for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "connections are insertable by workspace members"
  on public.channel_connections for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "connections are updatable by workspace members"
  on public.channel_connections for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "connections are deletable by workspace members"
  on public.channel_connections for delete to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "listings are readable by workspace members"
  on public.channel_listings for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "listings are insertable by workspace members"
  on public.channel_listings for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "listings are updatable by workspace members"
  on public.channel_listings for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "listings are deletable by workspace members"
  on public.channel_listings for delete to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "snapshots are readable by workspace members"
  on public.listing_snapshots for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "snapshots are insertable by workspace members"
  on public.listing_snapshots for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Seed
--
-- Two mocks, and only mocks. A3's exit test is that one product yields two
-- independent listings with no marketplace string in the product domain, and
-- the pair below is chosen to make the capability matrix visible: one channel
-- that can publish and one that structurally cannot.
--
-- lib/channels/registry.ts is the source of truth for what these can do. A unit
-- test asserts the registry and this table agree, so drift fails CI rather than
-- production.
-- ---------------------------------------------------------------------------

insert into public.channels (key, name, integration_type, status, billable) values
  ('mock_api', 'Mock Storefront', 'api', 'available', false),
  ('mock_assisted', 'Mock Marketplace', 'assisted', 'available', true);
