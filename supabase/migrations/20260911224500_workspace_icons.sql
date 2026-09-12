-- Settings: the workspace icon.
--
-- A column and a bucket. The column holds a storage path and nothing else; the
-- bytes live in private storage, like every other file Fanwise holds.
--
-- Path convention, matching product-assets so one policy expression covers the
-- bucket: <workspace_id>/<icon_id><ext>. The workspace id leads, and
-- storage_object_workspace_id() (A2) reads it back out of the first segment.
--
-- Unlike product-assets there is no signed upload URL here. An icon is at most
-- 2 MB, so it is posted to a server action, sniffed from its own bytes and
-- written with the service role. That removes the bearer capability the product
-- upload path has to reason about: no caller ever holds a URL into this bucket.

alter table public.workspaces
  add column icon_path text;

-- The path is written only by the server action, which builds it from ids it has
-- already checked. The constraint is a second pair of eyes on that, not the
-- first: a path that does not start with this workspace's own id is refused by
-- the database even if the application is wrong.
alter table public.workspaces
  add constraint workspaces_icon_path_scoped
  check (icon_path is null or icon_path like (id::text || '/%'));

comment on column public.workspaces.icon_path is
  'Storage path of the workspace icon in the workspace-icons bucket, or null for the initials fallback. Scoped to the workspace id by constraint.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-icons',
  'workspace-icons',
  false,
  2097152, -- 2 MiB, the limit the settings page states
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Members read their own workspace's icon. Writes are the owner's, matching the
-- update policy on public.workspaces: the icon is part of the workspace record,
-- so the same person who may rename it may replace its icon.
--
-- These policies govern direct client access. The server action writes with the
-- service role and is itself the authorization boundary (docs/security.md).

create policy "workspace icons are readable by workspace members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'workspace-icons'
    and public.is_workspace_member(public.storage_object_workspace_id(name))
  );

create policy "workspace icons are writable by the workspace owner"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'workspace-icons'
    and public.is_workspace_owner(public.storage_object_workspace_id(name))
  );

create policy "workspace icons are updatable by the workspace owner"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'workspace-icons'
    and public.is_workspace_owner(public.storage_object_workspace_id(name))
  )
  with check (
    bucket_id = 'workspace-icons'
    and public.is_workspace_owner(public.storage_object_workspace_id(name))
  );

create policy "workspace icons are deletable by the workspace owner"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'workspace-icons'
    and public.is_workspace_owner(public.storage_object_workspace_id(name))
  );
