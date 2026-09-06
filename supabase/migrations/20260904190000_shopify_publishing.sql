-- Step A5: publishing.
--
-- Three tables and one channel row. Everything here is provider-neutral by
-- construction: the only place the word "shopify" appears is the single seeded
-- catalog row, which is identity, not behaviour. Capabilities, OAuth, the
-- mutation and the error map all live in lib/channels/adapters/shopify.
--
-- What each table is for, and why it is shaped this way:
--
--   1. channel_oauth_states makes OAuth state a single-use database row rather
--      than a cookie. docs/security.md rule 6 requires state validated on every
--      callback; a row can also be *consumed*, which a cookie cannot, so a
--      replayed callback fails on the second attempt instead of succeeding
--      twice. It carries no grant to anon or authenticated at all, for the same
--      reason channel_connection_secrets does not.
--
--   2. publication_jobs is where architecture invariant 3 lives. The
--      idempotency key is a NOT NULL column with a global unique constraint, so
--      it is persisted in the same statement that creates the job row and a
--      second click loses at the database rather than in application code.
--
--   3. listing_manual_steps is ADR 0001's assisted file step. A channel that
--      cannot upload a deliverable still has to get one to the buyer, and the
--      outstanding work is a row rather than a status value so that "fully
--      published" stays a derived condition: published, and no required manual
--      step incomplete.
--
-- RLS repeats the A1/A2/A3 pattern exactly: policies delegate to
-- is_workspace_member, auth.uid() is always (select auth.uid()), no table is
-- FORCE row level security.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- A job is one logical external write. 'pending' is enqueued and not yet
-- picked up; 'running' is in flight; the other two are terminal for this
-- attempt. A retry reuses the row, so there is no 'retrying' member: the
-- attempt count says that.
create type public.publication_job_status as enum ('pending', 'running', 'succeeded', 'failed');

-- 'publish' creates the external object, 'update' changes it, 'activate' takes
-- it from a provider draft to live. They are separate kinds because they have
-- different idempotency keys: a publish is once per listing, an update is once
-- per distinct set of content.
create type public.publication_job_kind as enum ('publish', 'update', 'activate');

-- ---------------------------------------------------------------------------
-- channel_oauth_states
--
-- No grant to anon or authenticated, deliberately, and RLS enabled with zero
-- policies as the second layer. The only path is the service role from server
-- code. A row is written when a creator starts an authorization and consumed by
-- the callback; nothing in the browser ever needs to read one.
-- ---------------------------------------------------------------------------

create table public.channel_oauth_states (
  -- The state parameter itself is the key. Uniqueness is the anti-replay
  -- property, so it is the primary key rather than a column beside a uuid.
  state text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The account the flow was started against, so a callback cannot be steered
  -- at a different one. For an owned storefront this is the shop domain.
  external_account_hint text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint channel_oauth_states_state_length check (length(state) between 16 and 128)
);

comment on table public.channel_oauth_states is
  'Single-use OAuth state. No grant to anon or authenticated: service role only. Consumed by the callback so a replay fails.';

create index channel_oauth_states_expires_at_idx on public.channel_oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- publication_jobs
-- ---------------------------------------------------------------------------

create table public.publication_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_listing_id uuid not null,
  kind public.publication_job_kind not null,
  -- Architecture invariant 3. NOT NULL and globally unique: the key cannot be
  -- absent, and it cannot be reused by a second logical operation.
  idempotency_key text not null unique,
  status public.publication_job_status not null default 'pending',
  attempt_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  -- The provider's own words, kept so the original is recoverable after
  -- normalization. Never rendered, and never a credential: adapters persist
  -- responses, not requests, and no provider returns a token from a write.
  provider_response jsonb,
  normalized_error_code text,
  normalized_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_jobs_attempt_count_sane check (attempt_count >= 0),
  constraint publication_jobs_listing_fk
    foreign key (channel_listing_id, workspace_id)
    references public.channel_listings (id, workspace_id)
    on delete cascade
);

comment on table public.publication_jobs is
  'One row per logical external write. The idempotency key is persisted here, in the same statement as the row, before any provider call.';

comment on column public.publication_jobs.idempotency_key is
  'Unique across the whole table. A publish key is derived from the listing alone; an update key includes a content fingerprint.';

create index publication_jobs_listing_idx
  on public.publication_jobs (channel_listing_id, created_at desc);
create index publication_jobs_workspace_id_idx on public.publication_jobs (workspace_id);

create trigger set_updated_at
  before update on public.publication_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- listing_manual_steps
--
-- The step's label, description and whether it is required all live in the
-- adapter, not here, for the same reason capabilities do: a row can be edited
-- and code cannot. This table records only which step, on which listing, and
-- whether a human has done it.
-- ---------------------------------------------------------------------------

create table public.listing_manual_steps (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_listing_id uuid not null,
  step_key text not null,
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_manual_steps_key_format check (step_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  -- A step is outstanding once, not once per time it was looked at.
  constraint listing_manual_steps_unique unique (channel_listing_id, step_key),
  constraint listing_manual_steps_listing_fk
    foreign key (channel_listing_id, workspace_id)
    references public.channel_listings (id, workspace_id)
    on delete cascade
);

comment on table public.listing_manual_steps is
  'Work a channel cannot do through its API and a human must. Fully published is published plus no required step incomplete.';

create index listing_manual_steps_listing_idx
  on public.listing_manual_steps (channel_listing_id);
create index listing_manual_steps_workspace_id_idx on public.listing_manual_steps (workspace_id);

create trigger set_updated_at
  before update on public.listing_manual_steps
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.channel_oauth_states enable row level security;
alter table public.publication_jobs enable row level security;
alter table public.listing_manual_steps enable row level security;

-- Deliberately NOT forced, for the reason recorded in the A1 migration.

revoke all on public.channel_oauth_states from anon, authenticated;
revoke all on public.publication_jobs from anon, authenticated;
revoke all on public.listing_manual_steps from anon, authenticated;

-- channel_oauth_states: no grant at all. RLS is on with zero policies so that a
-- grant added by mistake later still returns nothing.

-- publication_jobs: a member may see their workspace's jobs and may start one,
-- because starting one is how Publish is authorized. A member may NOT update or
-- delete: the outcome of an external write is the system's account of what
-- happened, not a field a person edits. The job runner holds the service role
-- and scopes the workspace itself, per docs/security.md rule 4.
grant select, insert on public.publication_jobs to authenticated;

create policy "publication jobs are readable by workspace members"
  on public.publication_jobs for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "publication jobs are insertable by workspace members"
  on public.publication_jobs for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

-- listing_manual_steps: a member may see, create and complete a step. Completing
-- one is a human saying they did a human thing, which is exactly the claim this
-- table is for. There is no delete grant: a step that was required does not stop
-- having been required because someone would rather it went away.
grant select, insert, update on public.listing_manual_steps to authenticated;

create policy "manual steps are readable by workspace members"
  on public.listing_manual_steps for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "manual steps are insertable by workspace members"
  on public.listing_manual_steps for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "manual steps are updatable by workspace members"
  on public.listing_manual_steps for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Seed
--
-- The first real channel. billable is false: docs/billing.md and the pricing
-- model include one owned storefront in the $9 base, and the entitlement
-- service reads this column rather than a plan name or a channel key.
--
-- lib/channels/registry.ts remains the source of truth for what this channel
-- can do. A unit test asserts the registry and this table agree on key, name
-- and integration type across every migration, so drift fails CI.
-- ---------------------------------------------------------------------------

insert into public.channels (key, name, integration_type, status, billable) values
  ('shopify', 'Shopify', 'api', 'available', false);
