-- Importing a product from a public link.
--
-- One table, two enums, two columns on products, and nothing else. The
-- canonical product is created by the same action that creates the import, so
-- an import is always about a product that exists; what this table holds is
-- everything that would otherwise have to land on `products` and must not.
--
-- Three things here are load-bearing:
--
--   1. **The provider's payload never reaches `products`.** `evidence` holds
--      what the page said, as it was read, and `suggestions` holds what a model
--      proposed from it. A value moves onto the product when a person accepts
--      it on the review screen and not before. Architecture invariant 5 is the
--      reason: an unreviewed suggestion on the canonical record enters the
--      FactSheet, and every later generation for every other channel is then
--      free to restate a claim Fanwise invented here.
--   2. **`accepted` is what the creator has settled.** A re-import refreshes
--      `evidence` and `suggestions` and never touches it, so re-reading a page
--      cannot undo an edit. The application enforces that; this column is what
--      makes it possible to.
--   3. **One live import per URL per workspace**, by partial unique index.
--      Re-importing the same link opens the import that already exists rather
--      than making a second product, and the index is what makes that true
--      under a double click and two tabs rather than only under a happy path.
--
-- RLS repeats the A2 pattern exactly: policies delegate to is_workspace_member,
-- auth.uid() is never called here because the helper wraps it, and the table is
-- not FORCE row level security so the service role can write a job's outcome.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- Deliberately generic. Which real service each one means lives in
-- lib/imports/sources/registry.ts and nowhere else, the way a channel key does
-- — including here, because this enum is generated into
-- lib/supabase/database.types.ts, which the provider-name sweep reads.
create type public.import_provider as enum ('hosted_artifact', 'webpage');

-- pending: the row exists and a job has been queued, nothing has been read.
-- retrieving: a job claimed it and is reading the page.
-- analyzing: the page was read and a model is proposing a draft from it.
-- ready: there is evidence, and suggestions if a model was configured.
-- unavailable: the source refused to be read. `error_code` says how.
-- failed: Fanwise broke. Distinct from unavailable, and retryable.
-- discarded: the creator abandoned it. Frees the URL for a fresh import.
create type public.import_status as enum (
  'pending',
  'retrieving',
  'analyzing',
  'ready',
  'unavailable',
  'failed',
  'discarded'
);

-- ---------------------------------------------------------------------------
-- product_imports
-- ---------------------------------------------------------------------------

create table public.product_imports (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid not null,
  provider public.import_provider not null,
  status public.import_status not null default 'pending',

  -- What the creator pasted, after the shape check normalized it. Provenance,
  -- and never a deliverable: a link is not a file a buyer receives.
  source_url text not null,
  -- The dedupe key. Same page, same value, whatever the tracking parameters
  -- and the trailing slash said. lib/imports/url.ts owns the normalization and
  -- a unit test holds it to this column's meaning.
  normalized_url text not null,
  -- Where the body actually came from, after any redirects were followed and
  -- each one re-validated. Null until a read succeeds.
  resolved_url text,

  -- SHA-256 of the extracted evidence. Two reads of an unchanged page produce
  -- the same value, which is what lets a refresh skip a second model call and
  -- leave a creator's edits alone.
  content_hash text,

  -- What the page said, as it was read. Never model output.
  evidence jsonb not null default '{}'::jsonb,
  -- What a model proposed from `evidence`. Never promoted without a person.
  suggestions jsonb not null default '{}'::jsonb,
  -- Which suggested fields the creator has settled, and what they settled them
  -- to. A refresh reads this and refuses to overwrite what it names.
  accepted jsonb not null default '{}'::jsonb,

  -- Normalized, from lib/imports/errors.ts. Never a provider's own words, and
  -- never a status code (rule 8). The original goes to the server log.
  error_code text,
  error_message text,

  -- What composed `suggestions`, so a draft can be reproduced or explained.
  prompt_version text,
  schema_version text,

  requested_by uuid references auth.users (id) on delete set null,
  retrieved_at timestamptz,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_imports_source_url_shape check (
    source_url ~ '^https://' and length(source_url) between 8 and 2048
  ),
  constraint product_imports_normalized_url_shape check (
    normalized_url ~ '^https://' and length(normalized_url) between 8 and 2048
  ),
  constraint product_imports_resolved_url_shape check (
    resolved_url is null or (resolved_url ~ '^https://' and length(resolved_url) <= 2048)
  ),
  constraint product_imports_content_hash_shape check (
    content_hash is null or content_hash ~ '^[0-9a-f]{64}$'
  ),
  -- The closed set the UI chooses a recovery from. A code outside it would
  -- reach a screen with no way out, which is the failure this whole feature is
  -- most likely to have and the one worth refusing at the database.
  constraint product_imports_error_code_known check (
    error_code is null or error_code in (
      'login_required',
      'organization_only',
      'not_found',
      'expired',
      'unsupported_source',
      'not_html',
      'too_large',
      'timeout',
      'unreachable',
      'blocked_address',
      'too_many_redirects',
      'provider_error',
      'ai_unavailable',
      'internal'
    )
  ),
  -- An unhappy status has to say why, and a happy one may not pretend to.
  constraint product_imports_error_matches_status check (
    (status in ('unavailable', 'failed')) = (error_code is not null)
  ),
  -- One import per product. A second read of the same product replaces this
  -- row's evidence rather than adding a row beside it.
  constraint product_imports_product_unique unique (product_id),
  -- The tenant boundary as a foreign key, per docs/security.md: a policy that
  -- checks workspace_id alone still permits attaching a row carrying your own
  -- workspace_id to somebody else's product.
  constraint product_imports_product_fk
    foreign key (product_id, workspace_id)
    references public.products (id, workspace_id)
    on delete cascade
);

comment on table public.product_imports is
  'One attempt to build a product from a public link. Holds what the page said and what a model proposed, so that neither reaches products unreviewed.';

comment on column public.product_imports.accepted is
  'Creator-settled values. A re-import never overwrites what this names.';

comment on column public.product_imports.content_hash is
  'SHA-256 of the extracted evidence. Equal hashes mean the page has not changed.';

create index product_imports_workspace_id_idx on public.product_imports (workspace_id);
create index product_imports_status_idx on public.product_imports (workspace_id, status);

-- Re-importing a link opens the import that exists instead of making a second
-- product. Partial, so discarding one frees its URL for a fresh attempt.
create unique index product_imports_workspace_url_idx
  on public.product_imports (workspace_id, normalized_url)
  where status <> 'discarded';

create trigger set_updated_at
  before update on public.product_imports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- products: the rights attestation
-- ---------------------------------------------------------------------------
--
-- Not a rights model, and the column names are chosen to say so. Who confirmed
-- they may sell this, and when. A licence catalogue and an ownership model are
-- each their own feature; readiness needs these two to be able to ask a
-- question whose answer is recorded rather than assumed.

alter table public.products
  add column rights_confirmed_at timestamptz,
  add column rights_confirmed_by uuid references auth.users (id) on delete set null;

comment on column public.products.rights_confirmed_at is
  'When a member confirmed they hold the right to sell this. Null until they do.';

-- Both or neither. A timestamp with nobody behind it records nothing.
alter table public.products
  add constraint products_rights_confirmation_complete check (
    (rights_confirmed_at is null) = (rights_confirmed_by is null)
  );

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.product_imports enable row level security;

revoke all on public.product_imports from anon, authenticated;

-- No delete grant. Abandoning an import sets `discarded`, which keeps the
-- record of what was attempted and still frees the URL.
grant select, insert, update on public.product_imports to authenticated;

create policy "imports are readable by workspace members"
  on public.product_imports for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "imports are insertable by workspace members"
  on public.product_imports for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "imports are updatable by workspace members"
  on public.product_imports for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
