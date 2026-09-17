-- Images and GIFs as import sources.
--
-- The composer takes a picture the way it takes a PDF: staged under
-- `<workspace_id>/import-sources/`, sniffed from its bytes, attached to the
-- session by `create_import_session`. Reading it puts the bytes on the
-- product as a cover or preview image; no words come out of it.
--
-- One new enum value, and the checks that name every type are rewritten to
-- know it. The shape check compares `source_type::text` so that the value
-- added above can be named in the same transaction: Postgres refuses to use a
-- new enum value in the transaction that added it, and refuses nothing about
-- a string.

alter type public.import_source_type add value if not exists 'image';

alter table public.product_import_sources
  drop constraint product_import_sources_storage_path_in_workspace;

alter table public.product_import_sources
  add constraint product_import_sources_storage_path_in_workspace check (
    storage_path is null
    or storage_path ~ (
      '^' || workspace_id::text
      || '/import-sources/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(txt|html|pdf|webm|ogg|m4a|mp4|wav|png|jpg|gif|webp)$'
    )
  );

alter table public.product_import_sources
  drop constraint product_import_sources_shape;

alter table public.product_import_sources
  add constraint product_import_sources_shape check (
    coalesce(case source_type::text
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
      when 'image' then
        source_url is null and normalized_url is null
        and text_content is null
        and storage_path is not null and storage_path ~ '\.(png|jpg|gif|webp)$'
    end, false)
  );

alter table public.product_import_sources
  drop constraint product_import_sources_error_code_known;

alter table public.product_import_sources
  add constraint product_import_sources_error_code_known check (
    error_code is null or error_code in (
      'login_required', 'organization_only', 'not_found', 'expired', 'unsupported_source',
      'not_html', 'too_large', 'timeout', 'unreachable', 'blocked_address',
      'too_many_redirects', 'provider_error', 'internal', 'unreadable_file', 'no_text',
      'upload_incomplete', 'unsupported_file', 'transcription_unavailable', 'audio_too_long',
      'image_unusable'
    )
  );

alter table public.product_imports
  drop constraint product_imports_error_code_known;

alter table public.product_imports
  add constraint product_imports_error_code_known check (
    error_code is null or error_code in (
      'login_required', 'organization_only', 'not_found', 'expired', 'unsupported_source',
      'not_html', 'too_large', 'timeout', 'unreachable', 'blocked_address',
      'too_many_redirects', 'provider_error', 'ai_unavailable', 'internal',
      'unreadable_file', 'no_text', 'no_readable_source', 'upload_incomplete',
      'unsupported_file', 'transcription_unavailable', 'audio_too_long', 'image_unusable'
    )
  );

comment on table public.product_import_sources is
  'One source of one import: a link, pasted text, a PDF, an HTML file, a recording or a picture. Evidence only; never a buyer file.';
