-- One import, many sources.
--
-- Until now a `product_imports` row held exactly one source: a link, or (since
-- 20260912210000) one pasted text or one uploaded file. The universal composer
-- lets a creator hand over any combination — one public link, pasted text,
-- PDFs, HTML files, a voice recording — and have Fanwise combine them into one
-- draft. So `product_imports` becomes the durable import session, and each
-- source becomes a row here.
--
-- Additive. Nothing is dropped, every existing import is backfilled with the
-- source it already had, and every existing detail link keeps working. The
-- legacy URL columns stay on `product_imports`, because they carry the
-- one-live-import-per-link index that makes re-importing a link open the
-- import that exists.
--
-- Load-bearing, in order of how badly they would fail:
--
--   1. **A source belongs to its import's workspace, by foreign key.** The
--      composite `(import_id, workspace_id)` reference means a row carrying a
--      member's own workspace id cannot point at another workspace's import,
--      which a policy checking workspace_id alone would allow.
--   2. **A stored object belongs to the row's workspace, by construction.** The
--      job reads `storage_path` with the service role, which ignores storage
--      policies, so the path must start with the row's own workspace id and
--      have exactly the shape the server builds.
--   3. **Creation is one transaction.** `create_import_session` inserts the
--      product, the session and its sources, and attaches the files uploaded
--      beforehand, or does none of it. A second call with the same submission
--      id returns the session the first one made.
--   4. **A source file is evidence, not a deliverable.** It lives under
--      `import-sources/`, never in `product_assets`, so it can never satisfy
--      the buyer-files readiness step or be offered for download.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- A session with no link: the sources are all handed over. Compared as text
-- below, since a value added in this transaction cannot be used as a constant.
alter type public.import_provider add value if not exists 'composed';

create type public.import_source_type as enum ('public_url', 'pasted_text', 'pdf', 'html', 'audio');

-- uploading:    the row exists and a signed upload was issued; no bytes confirmed.
-- staged:       bytes stored, measured and sniffed, not yet part of an import.
-- transcribing: a recording's audio is being transcribed.
-- pending:      part of an import, waiting for its reading job.
-- reading:      a job claimed it.
-- ready:        evidence extracted.
-- failed:       Fanwise or the network broke. Retryable.
-- unavailable:  the source refused to be read. Retrying changes nothing.
-- removed:      the creator took it out. Terminal, and ignored by composition.
create type public.import_source_status as enum (
  'uploading',
  'staged',
  'transcribing',
  'pending',
  'reading',
  'ready',
  'failed',
  'unavailable',
  'removed'
);

-- ---------------------------------------------------------------------------
-- product_imports: the session
-- ---------------------------------------------------------------------------

-- The target of the sources' composite foreign key.
alter table public.product_imports
  add constraint product_imports_id_workspace_unique unique (id, workspace_id);

-- The composer's idempotency key. Minted in the browser when the composer
-- opens, so a double click, a retried request and a redelivered action all
-- name the same session.
alter table public.product_imports
  add column submission_id uuid;

create unique index product_imports_submission_idx
  on public.product_imports (workspace_id, submission_id)
  where submission_id is not null;

-- The URL and its normalized form are both present or both absent. Half of
-- the pair is a row the dedupe index cannot reason about.
alter table public.product_imports
  add constraint product_imports_url_pair_complete check (
    (source_url is null) = (normalized_url is null)
  );

-- `composed` joins the kinds with no link and no single stored object.
alter table public.product_imports
  drop constraint product_imports_one_source;

alter table public.product_imports
  add constraint product_imports_one_source check (
    case
      when provider::text in ('pasted_text', 'pdf_document', 'html_document') then
        source_url is null and normalized_url is null and source_path is not null
      when provider::text = 'composed' then
        source_url is null and normalized_url is null and source_path is null
      else
        source_url is not null and normalized_url is not null and source_path is null
    end
  );

-- Every source failed. A session of one source carries that source's own
-- reason, so a single link reads as it always did; a session of several says
-- none could be read, and each source says why.
alter table public.product_imports
  drop constraint product_imports_error_code_known;

alter table public.product_imports
  add constraint product_imports_error_code_known check (
    error_code is null or error_code in (
      'login_required', 'organization_only', 'not_found', 'expired', 'unsupported_source',
      'not_html', 'too_large', 'timeout', 'unreachable', 'blocked_address',
      'too_many_redirects', 'provider_error', 'ai_unavailable', 'internal',
      'unreadable_file', 'no_text', 'no_readable_source', 'upload_incomplete',
      'unsupported_file', 'transcription_unavailable', 'audio_too_long'
    )
  );

-- ---------------------------------------------------------------------------
-- product_import_sources
-- ---------------------------------------------------------------------------

create table public.product_import_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Null only while a file or recording is staged in the composer, before
  -- "Create draft" attaches it.
  import_id uuid,
  source_type public.import_source_type not null,
  status public.import_source_status not null,
  -- The order the creator added them in, which is the order the draft reads them.
  position smallint not null default 0,
  -- What the screen calls it: a host and path, a file name, "Product notes".
  display_name text not null,

  source_url text,
  normalized_url text,

  -- Private, in the product-assets bucket, under import-sources/.
  storage_path text,
  -- Sniffed from the stored bytes, never the browser's claim.
  mime_type text,
  -- Measured from storage.
  byte_size bigint,
  -- A recording's length as the browser measured it. Bounded again here.
  duration_ms integer,

  -- What the creator pasted, or what a recording said once transcribed.
  text_content text,

  -- What reading this source produced. ProductSourceEvidence, validated on read.
  evidence jsonb not null default '{}'::jsonb,
  content_hash text,

  error_code text,
  error_message text,

  requested_by uuid references auth.users (id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_import_sources_import_fk
    foreign key (import_id, workspace_id)
    references public.product_imports (id, workspace_id)
    on delete cascade,
  constraint product_import_sources_position_range check (position between 0 and 49),
  constraint product_import_sources_display_name_length check (
    length(display_name) between 1 and 255
  ),
  constraint product_import_sources_text_length check (
    text_content is null or length(text_content) <= 200000
  ),
  constraint product_import_sources_byte_size_range check (byte_size is null or byte_size >= 0),
  constraint product_import_sources_duration_range check (
    duration_ms is null or duration_ms between 0 and 600000
  ),
  constraint product_import_sources_content_hash_shape check (
    content_hash is null or content_hash ~ '^[0-9a-f]{64}$'
  ),
  -- A source outside an import may only be on its way in, or out.
  constraint product_import_sources_staged_without_import check (
    import_id is not null or status in ('uploading', 'staged', 'transcribing', 'failed', 'removed')
  ),
  constraint product_import_sources_storage_path_in_workspace check (
    storage_path is null
    or storage_path ~ (
      '^' || workspace_id::text
      || '/import-sources/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(txt|html|pdf|webm|ogg|m4a|mp4|wav)$'
    )
  ),
  -- Each type carries exactly what it needs, and nothing that would let it be
  -- read two ways. Every branch is null-safe: a CHECK passes on NULL, so a
  -- regex match against a missing path would otherwise let the row through.
  constraint product_import_sources_shape check (
    coalesce(case source_type
      when 'public_url' then
        import_id is not null
        and source_url is not null and normalized_url is not null
        and source_url ~ '^https://' and length(source_url) between 8 and 2048
        and normalized_url ~ '^https://' and length(normalized_url) between 8 and 2048
        and storage_path is null
      when 'pasted_text' then
        source_url is null and normalized_url is null
        and (text_content is not null or (storage_path is not null and storage_path ~ '\.txt$'))
      when 'pdf' then
        source_url is null and normalized_url is null
        and storage_path is not null and storage_path ~ '\.pdf$'
      when 'html' then
        source_url is null and normalized_url is null
        and storage_path is not null and storage_path ~ '\.html$'
      when 'audio' then
        source_url is null and normalized_url is null
        and storage_path is not null and storage_path ~ '\.(webm|ogg|m4a|mp4|wav)$'
    end, false)
  ),
  constraint product_import_sources_error_matches_status check (
    (status in ('failed', 'unavailable')) = (error_code is not null)
  ),
  constraint product_import_sources_error_code_known check (
    error_code is null or error_code in (
      'login_required', 'organization_only', 'not_found', 'expired', 'unsupported_source',
      'not_html', 'too_large', 'timeout', 'unreachable', 'blocked_address',
      'too_many_redirects', 'provider_error', 'internal', 'unreadable_file', 'no_text',
      'upload_incomplete', 'unsupported_file', 'transcription_unavailable', 'audio_too_long'
    )
  )
);

comment on table public.product_import_sources is
  'One source of one import: a link, pasted text, a PDF, an HTML file or a recording. Evidence only; never a buyer file.';

create index product_import_sources_workspace_idx on public.product_import_sources (workspace_id);
create index product_import_sources_import_idx on public.product_import_sources (import_id);

-- One position per source within a live import.
create unique index product_import_sources_position_idx
  on public.product_import_sources (import_id, position)
  where import_id is not null and status <> 'removed';

-- At most one link per import. The session's own URL columns mirror it, and
-- the dedupe index lives there.
create unique index product_import_sources_one_link_idx
  on public.product_import_sources (import_id)
  where source_type = 'public_url' and status <> 'removed';

create trigger set_updated_at
  before update on public.product_import_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Backfill: every existing import gets the source it already had
-- ---------------------------------------------------------------------------

insert into public.product_import_sources (
  workspace_id, import_id, source_type, status, position, display_name,
  source_url, normalized_url, storage_path, byte_size, evidence, content_hash,
  error_code, error_message, requested_by, processed_at, created_at, updated_at
)
select
  i.workspace_id,
  i.id,
  (case i.provider::text
    when 'pasted_text' then 'pasted_text'
    when 'pdf_document' then 'pdf'
    when 'html_document' then 'html'
    else 'public_url'
  end)::public.import_source_type,
  (case
    when i.status::text = 'discarded' then 'removed'
    when i.status::text = 'pending' then 'pending'
    when i.status::text = 'retrieving' then 'reading'
    -- A model that was missing or failed does not make the source unread.
    when i.status::text = 'failed' and i.error_code = 'ai_unavailable' then 'ready'
    when i.status::text in ('failed', 'unavailable') then i.status::text
    else 'ready'
  end)::public.import_source_status,
  0,
  left(coalesce(
    i.source_filename,
    i.source_url,
    case i.provider::text when 'html_document' then 'Pasted HTML' else 'Pasted text' end
  ), 255),
  i.source_url,
  i.normalized_url,
  i.source_path,
  i.source_byte_size,
  i.evidence,
  i.content_hash,
  case
    when i.status::text in ('failed', 'unavailable') and i.error_code <> 'ai_unavailable'
      then i.error_code
  end,
  case
    when i.status::text in ('failed', 'unavailable') and i.error_code <> 'ai_unavailable'
      then i.error_message
  end,
  i.requested_by,
  i.retrieved_at,
  i.created_at,
  i.updated_at
from public.product_imports i
where not exists (
  select 1 from public.product_import_sources s where s.import_id = i.id
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.product_import_sources enable row level security;

revoke all on public.product_import_sources from anon, authenticated;

-- No delete grant, as for imports: removing a source sets `removed`, which
-- keeps the record and frees its position.
grant select, insert, update on public.product_import_sources to authenticated;

create policy "import sources are readable by workspace members"
  on public.product_import_sources for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "import sources are insertable by workspace members"
  on public.product_import_sources for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "import sources are updatable by workspace members"
  on public.product_import_sources for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- create_import_session: the composer's one write
-- ---------------------------------------------------------------------------
--
-- Security invoker, so every insert and update below passes the caller's RLS
-- policies exactly as the same statements would from the application. The
-- function adds atomicity and nothing else: it cannot reach a row the caller
-- could not reach one statement at a time.
--
-- Returns the session and whether it already existed. Raises:
--   23505 on the link's dedupe index or a slug collision (the caller retries
--         the slug, or opens the existing import);
--   P0002 when a staged source is missing, not staged, or not this workspace's.

create or replace function public.create_import_session(
  p_workspace_id uuid,
  p_submission_id uuid,
  p_product_name text,
  p_product_slug text,
  p_product_metadata jsonb,
  p_provider public.import_provider,
  p_source_url text,
  p_normalized_url text,
  p_url_display_name text,
  p_pasted_text text,
  p_staged_source_ids uuid[]
)
returns table (import_id uuid, product_slug text, existing boolean)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_product_id uuid;
  v_import_id uuid;
  v_position smallint := 0;
  v_attached integer;
  v_expected integer := coalesce(array_length(p_staged_source_ids, 1), 0);
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- The same submission twice is the same session.
  return query
    select i.id, p.slug::text, true
    from public.product_imports i
    join public.products p on p.id = i.product_id
    where i.workspace_id = p_workspace_id and i.submission_id = p_submission_id;
  if found then
    return;
  end if;

  if p_source_url is null and p_pasted_text is null and v_expected = 0 then
    raise exception 'an import needs at least one source' using errcode = '22023';
  end if;

  insert into public.products (workspace_id, name, slug, product_type, metadata)
  values (p_workspace_id, p_product_name, p_product_slug, 'other', p_product_metadata)
  returning id into v_product_id;

  insert into public.product_imports (
    workspace_id, product_id, provider, status, source_url, normalized_url,
    requested_by, submission_id
  )
  values (
    p_workspace_id, v_product_id, p_provider, 'pending', p_source_url, p_normalized_url,
    v_user_id, p_submission_id
  )
  returning id into v_import_id;

  if p_source_url is not null then
    insert into public.product_import_sources (
      workspace_id, import_id, source_type, status, position, display_name,
      source_url, normalized_url, requested_by
    )
    values (
      p_workspace_id, v_import_id, 'public_url', 'pending', v_position,
      left(coalesce(p_url_display_name, p_source_url), 255),
      p_source_url, p_normalized_url, v_user_id
    );
    v_position := v_position + 1;
  end if;

  if p_pasted_text is not null then
    insert into public.product_import_sources (
      workspace_id, import_id, source_type, status, position, display_name,
      text_content, byte_size, requested_by
    )
    values (
      p_workspace_id, v_import_id, 'pasted_text', 'pending', v_position, 'Pasted text',
      p_pasted_text, octet_length(p_pasted_text), v_user_id
    );
    v_position := v_position + 1;
  end if;

  if v_expected > 0 then
    update public.product_import_sources s
    set import_id = v_import_id,
        status = 'pending',
        position = v_position + (ids.ordinality - 1)::smallint
    from unnest(p_staged_source_ids) with ordinality as ids(id, ordinality)
    where s.id = ids.id
      and s.workspace_id = p_workspace_id
      and s.import_id is null
      and s.status = 'staged';

    get diagnostics v_attached = row_count;
    if v_attached <> v_expected then
      raise exception 'a staged source is not available' using errcode = 'P0002';
    end if;
  end if;

  return query
    select v_import_id, p.slug::text, false from public.products p where p.id = v_product_id;
end;
$$;

comment on function public.create_import_session is
  'Creates a draft product, its import session and every source in one transaction. Security invoker: RLS applies to every statement.';

revoke all on function public.create_import_session(
  uuid, uuid, text, text, jsonb, public.import_provider, text, text, text, text, uuid[]
) from public, anon;
grant execute on function public.create_import_session(
  uuid, uuid, text, text, jsonb, public.import_provider, text, text, text, text, uuid[]
) to authenticated;
