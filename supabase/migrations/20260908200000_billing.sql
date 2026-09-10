-- Step C1: billing.
--
-- Three tables, one trigger, and no plan name anywhere. docs/billing.md is the
-- model: one subscription per workspace with two items, a fixed base and a
-- per-unit channel item whose quantity is the count of connected billable
-- channels. What this migration adds is the record of that on Fanwise's side,
-- and the mechanism that makes rule 1 of that document structural rather than
-- remembered.
--
--   1. workspace_billing is the one row per workspace that says what the
--      payment provider currently holds: the customer, the subscription, its
--      two items and their state. It is written by the server only, from
--      webhooks and the checkout action, because it is Fanwise's account of an
--      external fact and not a field a person edits.
--
--   2. billing_events is the ledger. docs/billing.md rule 1 says connecting or
--      disconnecting a channel is a billing event in the same transaction as
--      the channel_connections write. Rather than ask every path that writes a
--      connection to remember that — the mock connect action, the OAuth
--      callback, the grant route, and whatever A7 adds — a trigger on
--      channel_connections writes the event. A connection cannot exist without
--      its billing event because the database will not let it.
--
--      The idempotency key lives here too, NOT NULL and unique, for the same
--      reason it does on publication_jobs: architecture invariant 3 says the
--      key is persisted in the same transaction as the job row, and the
--      trigger is what makes that the same statement.
--
--   3. billing_webhook_events records every provider event by its own id, so a
--      redelivered webhook is recognised at the database rather than
--      re-processed. No grant to anon or authenticated: nothing in the
--      browser has any business reading a provider's event stream.
--
-- RLS repeats the A1 pattern: policies delegate to is_workspace_member,
-- auth.uid() is never called per row, and no table is FORCE row level
-- security.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- The provider's own subscription statuses, held as an enum so that a status
-- Fanwise does not know about fails at the write rather than propagating as a
-- string nobody handles. Null on workspace_billing means no subscription.
create type public.subscription_status as enum (
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
);

create type public.billing_event_kind as enum ('channel_connected', 'channel_disconnected');

-- pending: recorded, not yet sent. applied: the provider holds it. skipped:
-- nothing to send — the channel is not billable, or the workspace has no
-- subscription for it to land on. failed: the provider refused and a person
-- should look; the row keeps the normalized error and the original.
create type public.billing_event_status as enum ('pending', 'applied', 'skipped', 'failed');

-- ---------------------------------------------------------------------------
-- workspace_billing
-- ---------------------------------------------------------------------------

create table public.workspace_billing (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- The provider's customer. Created the first time a workspace starts a
  -- checkout and kept for its lifetime, so a workspace that subscribes,
  -- cancels and subscribes again is one customer with one history.
  external_customer_id text unique,
  external_subscription_id text unique,
  subscription_status public.subscription_status,
  billing_interval text,
  -- The two subscription items. The channel item is absent while the count
  -- of billable channels is zero, because the provider will not carry an
  -- item at quantity zero; it is created on the first billable connection and
  -- removed on the last disconnection.
  base_item_id text,
  channel_item_id text,
  -- What the provider holds, as of the last webhook or the last write. This
  -- is a mirror, never the source: the count of connected billable channels
  -- is, and the sync job reconciles the two.
  channel_quantity integer not null default 0,
  -- The highest channel quantity billed so far in the current period.
  --
  -- This is how docs/billing.md rule 3 is kept: a unit is paid for through the
  -- end of the period it was connected in, so a reconnection that brings the
  -- quantity back up to a number already paid for this period is not charged
  -- again. Reset to the current quantity when the period rolls.
  period_peak_quantity integer not null default 0,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_billing_interval_known
    check (billing_interval is null or billing_interval in ('month', 'year')),
  constraint workspace_billing_quantity_sane check (channel_quantity >= 0),
  constraint workspace_billing_peak_sane check (period_peak_quantity >= channel_quantity)
);

comment on table public.workspace_billing is
  'What the payment provider holds for a workspace. A mirror written by the server from webhooks and checkout; the count of connected billable channels is the source.';

comment on column public.workspace_billing.period_peak_quantity is
  'Highest channel quantity billed in the current period. A reconnection up to this number is not prorated again, per docs/billing.md rule 3.';

create trigger set_updated_at
  before update on public.workspace_billing
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- billing_events
-- ---------------------------------------------------------------------------

create table public.billing_events (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Not a foreign key. A disconnection is recorded as the connection row is
  -- deleted, and the ledger outlives what it describes.
  channel_connection_id uuid not null,
  channel_id uuid not null references public.channels (id) on delete restrict,
  kind public.billing_event_kind not null,
  -- Captured from channels.billable at the moment of the event, so a later
  -- change to which channels bill does not rewrite history.
  billable boolean not null,
  -- Architecture invariant 3. Written by the trigger in the same statement
  -- as the row, before any provider call, and unique across the table.
  idempotency_key text not null unique,
  status public.billing_event_status not null default 'pending',
  attempt_count integer not null default 0,
  applied_at timestamptz,
  -- The provider's own words after a write, so the original is recoverable
  -- after normalization. Never a credential: a subscription item carries no
  -- secret.
  provider_response jsonb,
  normalized_error_code text,
  normalized_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_events_attempt_count_sane check (attempt_count >= 0)
);

comment on table public.billing_events is
  'The billing ledger. One row per channel connection or disconnection, written by a trigger in the same transaction as the channel_connections row.';

comment on column public.billing_events.idempotency_key is
  'Persisted with the row, before the provider call. Unique across the whole table.';

create index billing_events_workspace_pending_idx
  on public.billing_events (workspace_id, created_at)
  where status = 'pending';
create index billing_events_workspace_id_idx on public.billing_events (workspace_id);

create trigger set_updated_at
  before update on public.billing_events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- billing_webhook_events
-- ---------------------------------------------------------------------------

create table public.billing_webhook_events (
  -- The provider's event id is the key, so a redelivery collides here.
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

comment on table public.billing_webhook_events is
  'Every provider webhook event, by its own id. No grant to anon or authenticated: service role only. A redelivered event collides on the key.';

-- ---------------------------------------------------------------------------
-- The trigger: a connection row and its billing event are one statement.
--
-- security definer, because authenticated holds no insert grant on
-- billing_events and should not: the ledger is written by the system, never
-- by a person. search_path is emptied so every name here is schema-qualified
-- on purpose, the same discipline the membership helpers follow.
--
-- On delete, the workspace may already be gone: Postgres removes a parent
-- before cascading onto its children, so a connection deleted by a workspace
-- deletion arrives here with no workspace to reference. That case is skipped
-- rather than failed, because a workspace that no longer exists has nothing
-- left to bill.
--
-- An upsert that lands on an existing row is an UPDATE and fires nothing
-- here. That is right: reconnecting the same account keeps the same
-- connection id and is not a second unit.
-- ---------------------------------------------------------------------------

create or replace function public.record_channel_billing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := extensions.gen_random_uuid();
  v_connection_id uuid;
  v_workspace_id uuid;
  v_channel_id uuid;
  v_kind public.billing_event_kind;
  v_billable boolean;
begin
  if tg_op = 'INSERT' then
    v_connection_id := new.id;
    v_workspace_id := new.workspace_id;
    v_channel_id := new.channel_id;
    v_kind := 'channel_connected';
  else
    v_connection_id := old.id;
    v_workspace_id := old.workspace_id;
    v_channel_id := old.channel_id;
    v_kind := 'channel_disconnected';

    if not exists (select 1 from public.workspaces where id = v_workspace_id) then
      return old;
    end if;
  end if;

  select billable into v_billable from public.channels where id = v_channel_id;

  insert into public.billing_events (
    id, workspace_id, channel_connection_id, channel_id, kind, billable, idempotency_key
  ) values (
    v_id,
    v_workspace_id,
    v_connection_id,
    v_channel_id,
    v_kind,
    coalesce(v_billable, false),
    'billing_event:' || v_id::text
  );

  if tg_op = 'INSERT' then
    return new;
  end if;
  return old;
end;
$$;

comment on function public.record_channel_billing_event is
  'Writes a billing_events row for every channel_connections insert and delete, in the same transaction. docs/billing.md rule 1, made structural.';

create trigger record_channel_billing_event
  after insert or delete on public.channel_connections
  for each row execute function public.record_channel_billing_event();

-- Trigger-only, so no role needs to execute it: Postgres checks EXECUTE at
-- CREATE TRIGGER, not when the trigger fires. Stated rather than left to the
-- default, per docs/decisions/0006-explicit-function-privileges.md. The
-- service role keeps execute through the A5 default privilege, and the
-- catalog test in tests/db/function-privileges.test.ts holds this line.
revoke all on function public.record_channel_billing_event() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.workspace_billing enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_webhook_events enable row level security;

-- Deliberately NOT forced, for the reason recorded in the A1 migration.

revoke all on public.workspace_billing from anon, authenticated;
revoke all on public.billing_events from anon, authenticated;
revoke all on public.billing_webhook_events from anon, authenticated;

-- workspace_billing: a member may read their workspace's row and nothing
-- else. Every write is the server's account of what the provider holds, and
-- it comes through the service role from a webhook or the checkout action.
grant select on public.workspace_billing to authenticated;

create policy "billing is readable by workspace members"
  on public.workspace_billing for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- billing_events: readable, so a creator can see what they were charged for
-- and when. Never writable from the browser; the trigger writes as its owner
-- and the sync job writes as the service role.
grant select on public.billing_events to authenticated;

create policy "billing events are readable by workspace members"
  on public.billing_events for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- billing_webhook_events: no grant at all. RLS is on with zero policies so
-- that a grant added by mistake later still returns nothing.
