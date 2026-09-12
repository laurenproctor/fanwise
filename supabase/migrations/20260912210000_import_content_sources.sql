-- Importing a product from text, a PDF or an HTML file.
--
-- The link importer reads a page Fanwise fetches. These three read something
-- the creator hands over instead: text they paste, or a file they upload. The
-- rest of an import is unchanged — the same row, the same job, the same
-- evidence and suggestions columns, the same review screen — so what this
-- migration adds is only where the handed-over bytes are and how to find them.
--
-- Three things here are load-bearing:
--
--   1. **A row has exactly one source.** A link import has a URL and no stored
--      object; a content import has a stored object and no URL. The check below
--      holds that per provider, so no row can be read two ways at once and no
--      row can be read no way at all.
--   2. **The stored object belongs to the row's workspace, by construction.**
--      The job reads `source_path` with the service role, which bypasses
--      storage policies. A member may insert a row through RLS, so without the
--      prefix check a member could point their own import at another
--      workspace's object and have the job read it for them. The path must
--      start with the row's own workspace id, and must have exactly the shape
--      the server builds, so there is no traversal to smuggle in either.
--   3. **Content imports do not dedupe.** `normalized_url` is null for them,
--      and the partial unique index treats nulls as distinct. Pasting the same
--      text twice makes two drafts, which is what a creator trying again
--      expects; a link is a stable identity and a paste is not.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- Generic, as before. Nothing below compares against these as enum values —
-- the checks cast to text — because a value added in a transaction cannot be
-- used as an enum constant until that transaction commits.
alter type public.import_provider add value if not exists 'pasted_text';
alter type public.import_provider add value if not exists 'pdf_document';
alter type public.import_provider add value if not exists 'html_document';

-- ---------------------------------------------------------------------------
-- product_imports: the source, when it is not a link
-- ---------------------------------------------------------------------------

alter table public.product_imports
  alter column source_url drop not null,
  alter column normalized_url drop not null;

alter table public.product_imports
  -- Where the pasted text or the uploaded file is stored, in the private
  -- product-assets bucket. Never served to anyone: the job reads it and the
  -- evidence it produces is what the screen shows.
  add column source_path text,
  -- What the creator called the file. Display only; the path is built from ids.
  add column source_filename text,
  -- Measured from the stored object when the import started, never taken from
  -- the browser.
  add column source_byte_size bigint;

comment on column public.product_imports.source_path is
  'Storage path of pasted text or an uploaded file. Null for a link import. Always under this row''s workspace.';

-- The URL shapes allow null now, and only null where the provider says so.
alter table public.product_imports
  drop constraint product_imports_source_url_shape,
  drop constraint product_imports_normalized_url_shape;

alter table public.product_imports
  add constraint product_imports_source_url_shape check (
    source_url is null or (source_url ~ '^https://' and length(source_url) between 8 and 2048)
  ),
  add constraint product_imports_normalized_url_shape check (
    normalized_url is null
    or (normalized_url ~ '^https://' and length(normalized_url) between 8 and 2048)
  ),
  add constraint product_imports_one_source check (
    case
      when provider::text in ('pasted_text', 'pdf_document', 'html_document') then
        source_url is null and normalized_url is null and source_path is not null
      else
        source_url is not null and normalized_url is not null and source_path is null
    end
  ),
  add constraint product_imports_source_path_in_workspace check (
    source_path is null
    or source_path ~ (
      '^' || workspace_id::text
      || '/import-sources/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(txt|html|pdf)$'
    )
  ),
  add constraint product_imports_source_filename_shape check (
    source_filename is null or length(source_filename) between 1 and 255
  ),
  add constraint product_imports_source_byte_size_range check (
    source_byte_size is null or source_byte_size >= 0
  );

-- Two new ways for a handed-over file to be unreadable. The closed set is
-- repeated from lib/imports/errors.ts, as it was when the table was made.
alter table public.product_imports
  drop constraint product_imports_error_code_known;

alter table public.product_imports
  add constraint product_imports_error_code_known check (
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
      'internal',
      'unreadable_file',
      'no_text'
    )
  );
