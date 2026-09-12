-- A7: Publish Everywhere.
--
-- Two additions, both additive, and neither of them a status.
--
--   1. workspace_events, the append-only activity log the data model has
--      reserved for this step since A1. A run writes one event when it starts,
--      naming every connected channel and what it decided about each, and one
--      per job as it settles. That is what makes "what happened when I pressed
--      Publish Everywhere" answerable after the page was closed.
--
--   2. publication_jobs.run_id, which groups the jobs one click created.
--
-- What is deliberately absent is any product-level publish status. ADR 0005
-- decision 7: a product is never published, a listing is, and a run reports per
-- channel with a count rather than an adjective over the product. A column here
-- summarising channels would be the product taking a channel's shape, which
-- invariant 1 forbids, and it would be stale the moment a channel deleted a
-- product, which has happened once already.

-- ---------------------------------------------------------------------------
-- workspace_events
--
-- Append-only, enforced three ways: no update or delete grant to the browser
-- roles, no policy for either, and a trigger that refuses both even to the
-- service role. listing_snapshots earned that third line the hard way and this
-- table takes the same shape, because an activity log that can be edited
-- afterwards is not evidence of anything.
--
-- event_type is text with a format check rather than an enum. The set of things
-- worth logging grows with every step, and an enum would put a migration
-- between a new event and the code that writes it; the check keeps every value
-- to one shape so they stay greppable. The writer owns the vocabulary, in
-- lib/publishing/events.ts.
-- ---------------------------------------------------------------------------

create table public.workspace_events (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  event_type text not null,
  -- Both optional, and both composite foreign keys where they are set: a
  -- tenant boundary that can be a foreign key should be (docs/security.md).
  product_id uuid,
  channel_listing_id uuid,
  -- The run this event belongs to, when it belongs to one. Not a foreign key:
  -- a run is not a row, it is the id a set of jobs share.
  run_id uuid,
  -- Who asked. Null for an event a background job wrote on nobody's behalf,
  -- and null again if the account is later deleted; the event still happened.
  actor_user_id uuid references auth.users (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workspace_events_type_format check (event_type ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint workspace_events_product_fk
    foreign key (product_id, workspace_id)
    references public.products (id, workspace_id)
    on delete cascade,
  constraint workspace_events_listing_fk
    foreign key (channel_listing_id, workspace_id)
    references public.channel_listings (id, workspace_id)
    on delete cascade
);

comment on table public.workspace_events is
  'Append-only activity log. Never updated, never deleted, not even by the service role.';

comment on column public.workspace_events.run_id is
  'Groups the events of one Publish Everywhere run. Matches publication_jobs.run_id.';

create index workspace_events_workspace_idx
  on public.workspace_events (workspace_id, created_at desc);
create index workspace_events_product_idx
  on public.workspace_events (product_id, created_at desc)
  where product_id is not null;
create index workspace_events_run_idx
  on public.workspace_events (run_id)
  where run_id is not null;

create or replace function public.enforce_event_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'workspace_events is append-only'
    using errcode = '23514';
end;
$$;

comment on function public.enforce_event_immutability is
  'Refuses every update and delete on workspace_events, including the service role''s.';

create trigger workspace_events_are_immutable
  before update or delete on public.workspace_events
  for each row execute function public.enforce_event_immutability();

-- Trigger-only. Postgres checks EXECUTE at CREATE TRIGGER, not when the trigger
-- fires, so nobody needs a grant (ADR 0006).
revoke all on function public.enforce_event_immutability() from public, anon, authenticated;

alter table public.workspace_events enable row level security;

revoke all on public.workspace_events from anon, authenticated;
-- Select and insert only. There is no update or delete grant because there is
-- no honest reason for one, and the trigger above means a mistaken grant later
-- would still not open that door.
grant select, insert on public.workspace_events to authenticated;

create policy "events are readable by workspace members"
  on public.workspace_events
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "events are insertable by workspace members"
  on public.workspace_events
  for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- publication_jobs.run_id
--
-- Nullable, and permanently so: every job written before this migration
-- belonged to no run, and a single-channel Publish still does. A run is one
-- click and the jobs it started, which is exactly what a shared id expresses.
-- ---------------------------------------------------------------------------

alter table public.publication_jobs add column run_id uuid;

comment on column public.publication_jobs.run_id is
  'The Publish Everywhere run that started this job, when one did. Null for a single-channel publish.';

create index publication_jobs_run_idx
  on public.publication_jobs (run_id, created_at)
  where run_id is not null;
