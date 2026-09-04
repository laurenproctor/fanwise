-- Step A2: private storage for product assets.
--
-- The bucket is private. Nothing in it is ever served by a public URL; reads go
-- through a short-lived signed URL minted server-side after an authorization
-- check.
--
-- Path convention: <workspace_id>/<product_id>/<asset_id><ext>
-- The workspace id leads so a single policy expression covers every object.
--
-- IMPORTANT, and recorded in docs/security.md: a signed upload URL carries its
-- own capability and BYPASSES these policies for the caller who holds it. The
-- policies below protect direct client access; they do not protect the upload
-- path. The server action that mints the URL is the authorization boundary, and
-- it chooses the storage path itself so a caller can never name its own
-- destination.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-assets',
  'product-assets',
  false,
  4294967296, -- 4 GiB, matching the largest package any target channel accepts
  null        -- deliverables are arbitrary binaries; images are checked on finalize
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- Safe cast. A path whose first segment is not a uuid must deny rather than
-- raise, so the policy expression stays total.
create or replace function public.uuid_or_null(p_value text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

comment on function public.uuid_or_null is
  'Casts to uuid, returning null instead of raising. Keeps storage policy expressions total for malformed paths.';

-- The workspace that owns an object, read from the first path segment.
create or replace function public.storage_object_workspace_id(p_name text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select public.uuid_or_null((storage.foldername(p_name))[1]);
$$;

comment on function public.storage_object_workspace_id is
  'Extracts the owning workspace id from a product-assets object path.';

-- storage.objects is owned by supabase_storage_admin and already has RLS
-- enabled by Supabase, so this migration only adds policies. Attempting
-- `alter table storage.objects enable row level security` here fails with
-- "must be owner of table objects", which is correct and not worth working
-- around: the state it would set is already true.

create policy "product assets are readable by workspace members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'product-assets'
    and public.is_workspace_member(public.storage_object_workspace_id(name))
  );

create policy "product assets are writable by workspace members"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-assets'
    and public.is_workspace_member(public.storage_object_workspace_id(name))
  );

create policy "product assets are updatable by workspace members"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-assets'
    and public.is_workspace_member(public.storage_object_workspace_id(name))
  )
  with check (
    bucket_id = 'product-assets'
    and public.is_workspace_member(public.storage_object_workspace_id(name))
  );

create policy "product assets are deletable by workspace members"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-assets'
    and public.is_workspace_member(public.storage_object_workspace_id(name))
  );
