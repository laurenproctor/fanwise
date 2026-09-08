-- Step B1: AI merchandising.
--
-- One table and one enum member. Everything about which model, which vendor and
-- what the prompt said lives in lib/ai; this schema records that a generation
-- happened, what it cost, what it produced, and — the column the step exists
-- for — the hash of the facts it was allowed to state.
--
--   ai_generations   One row per call to a model. Written pending by the member
--                    who asked, claimed and completed by the background job.
--                    `factsheet_hash` is what lets a bad listing be traced back
--                    to its inputs, and `structured_output` is what B2's
--                    restore-an-earlier-generation reads.
--
-- RLS repeats the A5 pattern: members select and insert, the system writes the
-- outcome. A person does not edit the record of what a model said any more than
-- they edit the record of what a provider answered.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- `rejected` is the status the factuality validator produces and the reason it
-- is not `failed`: the model answered, the answer parsed, and the validator
-- refused it because it claimed something the FactSheet does not support. That
-- is the product working, not the product breaking, and a creator should be
-- told which of the two happened.
create type public.ai_generation_status as enum (
  'pending',
  'running',
  'succeeded',
  'failed',
  'rejected'
);

-- One kind at B1: the whole listing. B2 adds a per-field regeneration.
create type public.ai_generation_type as enum ('listing');

-- A generation that was applied to a listing writes a snapshot, like a build,
-- a save or a publication does. Added rather than reusing `build`, because a
-- history that could not tell a model's draft from an adapter's would answer
-- "what changed before revenue moved" with the wrong author.
alter type public.snapshot_type add value if not exists 'generate';

-- ---------------------------------------------------------------------------
-- ai_generations
-- ---------------------------------------------------------------------------

create table public.ai_generations (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid not null,
  channel_listing_id uuid not null,
  generation_type public.ai_generation_type not null default 'listing',
  status public.ai_generation_status not null default 'pending',
  -- Who asked. Nullable because a user can be deleted and the record of what
  -- was generated for a listing should outlive them.
  requested_by uuid references auth.users (id) on delete set null,
  -- Written by the job, from the provider module, when the call is made. Null
  -- until then: a pending row has not chosen a model yet.
  provider text,
  model text,
  prompt_version text,
  -- SHA-256 of the full prompt as sent, so an identical request is recognisable.
  input_hash text,
  -- SHA-256 of the FactSheet. The column this table exists for.
  factsheet_hash text,
  -- The parsed, schema-valid output. Present on succeeded and rejected rows;
  -- a rejected row keeps its output precisely so the violation can be read
  -- beside the text that caused it.
  structured_output jsonb,
  -- What the factuality validator objected to. Only ever set with `rejected`.
  violations jsonb,
  input_tokens integer,
  output_tokens integer,
  cache_read_input_tokens integer,
  cache_creation_input_tokens integer,
  -- USD, estimated from the provider's published rates at the time of the
  -- call. An estimate, and named as one.
  estimated_cost numeric(12, 6),
  -- Rule 8: the normalized message is what a creator sees; the original goes
  -- nowhere near a row, because a provider error can quote the request.
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  -- When the output was written onto the listing. A succeeded generation that
  -- was never applied is possible in principle and impossible at B1, but the
  -- column says which happened rather than leaving it to be inferred.
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_generations_tokens_sane check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and (cache_read_input_tokens is null or cache_read_input_tokens >= 0)
    and (cache_creation_input_tokens is null or cache_creation_input_tokens >= 0)
  ),
  constraint ai_generations_cost_sane check (estimated_cost is null or estimated_cost >= 0),
  -- Violations belong to a rejection and nothing else.
  constraint ai_generations_violations_only_when_rejected check (
    violations is null or status = 'rejected'
  ),
  -- Both tenant boundaries are composite foreign keys, per the A2 lesson: a
  -- policy checking workspace_id alone would let a member attach a generation
  -- carrying their own workspace to another workspace's listing.
  constraint ai_generations_product_fk
    foreign key (product_id, workspace_id)
    references public.products (id, workspace_id)
    on delete cascade,
  constraint ai_generations_listing_fk
    foreign key (channel_listing_id, workspace_id)
    references public.channel_listings (id, workspace_id)
    on delete cascade
);

comment on table public.ai_generations is
  'One row per model call. factsheet_hash traces a listing back to the facts the model was allowed to state.';

comment on column public.ai_generations.factsheet_hash is
  'SHA-256 of the FactSheet the prompt carried. The only factual source the model received.';

comment on column public.ai_generations.violations is
  'What the factuality validator refused, as {kind, value, field}. Set only with status = rejected.';

create index ai_generations_listing_idx
  on public.ai_generations (channel_listing_id, created_at desc);
create index ai_generations_workspace_idx
  on public.ai_generations (workspace_id, created_at desc);

-- One generation in flight per listing. A double click races on this index
-- rather than on a read followed by a write, which is the same shape the
-- publication key takes and for the same reason.
create unique index ai_generations_one_in_flight
  on public.ai_generations (channel_listing_id)
  where status in ('pending', 'running');

create trigger set_updated_at
  before update on public.ai_generations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.ai_generations enable row level security;

-- The local stack grants anon and authenticated everything on a new table by
-- default. Revoked first, as every migration before this one does, so the
-- grants below are the whole of what a member may do.
revoke all on public.ai_generations from anon, authenticated;

-- Members may see and ask. The outcome — status, tokens, output, cost — is the
-- system's account of what happened and is written by the service role only.
grant select, insert on public.ai_generations to authenticated;

create policy "ai generations are readable by workspace members"
  on public.ai_generations for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "ai generations are insertable by workspace members"
  on public.ai_generations for insert to authenticated
  with check (public.is_workspace_member(workspace_id));
