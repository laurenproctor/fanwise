-- Step A1: tenancy.
--
-- Two tables, both with RLS enabled in this same migration, per docs/security.md
-- rule 1. Products arrive in A2 and carry their own workspace_id and policies.
--
-- Two things here are load-bearing and easy to get wrong later:
--
--   1. Policy recursion. A SELECT policy on workspace_members that itself reads
--      workspace_members recurses forever. The membership lookups are therefore
--      security definer functions that read the table as their owner, outside RLS.
--      For the same reason workspace_members must NOT be FORCE row level security:
--      FORCE subjects the table owner to RLS too, which re-applies the policy
--      inside the helper and brings the recursion straight back.
--
--   2. Bootstrap. A new user belongs to nothing, so no policy can authorise their
--      first workspace insert, and they cannot insert a membership for a workspace
--      that does not exist yet. workspaces therefore has no INSERT policy at all.
--      Creation goes through public.create_workspace(), which writes both rows in
--      one statement.
--
-- auth.uid() is wrapped as (select auth.uid()) in every policy so Postgres hoists
-- it into an InitPlan and evaluates it once per statement rather than once per row.

create type public.workspace_role as enum ('owner', 'admin', 'editor', 'viewer');

comment on type public.workspace_role is
  'All four roles exist in the type. V1 only ever assigns owner; admin, editor and viewer are reserved and are not exposed in the UI.';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug extensions.citext not null unique,
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (length(btrim(name)) between 1 and 80),
  constraint workspaces_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint workspaces_slug_length check (length(slug::text) between 3 and 48)
);

comment on table public.workspaces is
  'A tenant. Every tenant-scoped table from A2 onward carries workspace_id and repeats this isolation pattern.';

create trigger set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

comment on table public.workspace_members is
  'Membership edge. The primary key is (workspace_id, user_id); see the separate user_id index for the read the app actually performs.';

-- The composite primary key is workspace-id-leading, so it cannot serve
-- "which workspaces does this user belong to", which is the app's most common
-- read: it runs on every authenticated request through the layout guard and
-- inside every is_workspace_member() call.
create index workspace_members_user_id_idx
  on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Membership lookups
--
-- security definer so they read workspace_members outside RLS, which is what
-- keeps the policies below from recursing. search_path is pinned empty so a
-- caller cannot shadow the tables these resolve.
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

comment on function public.is_workspace_member is
  'True when the current user belongs to the workspace. security definer to avoid RLS recursion on workspace_members.';

create or replace function public.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

comment on function public.is_workspace_owner is
  'True when the current user owns the workspace. security definer to avoid RLS recursion on workspace_members.';

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_owner(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Workspace creation
--
-- The only sanctioned way a workspace row is born. Writes the workspace and the
-- owner membership in one statement, so a workspace can never exist without an
-- owner. security definer because the caller has no membership yet and so no
-- policy could authorise either insert.
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace(p_name text, p_slug text)
returns public.workspaces
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace public.workspaces;
begin
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  insert into public.workspaces (name, slug, owner_user_id)
  values (btrim(p_name), lower(btrim(p_slug)), v_user_id)
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace.id, v_user_id, 'owner');

  return v_workspace;
end;
$$;

comment on function public.create_workspace is
  'Creates a workspace and its owner membership atomically. The only sanctioned insert path for public.workspaces.';

revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- Deliberately NOT forced. See the header note on recursion.

revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_members from anon, authenticated;
grant select, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;

-- workspaces. No INSERT policy: creation is create_workspace() only.

create policy "workspaces are readable by their members"
  on public.workspaces
  for select
  to authenticated
  using (public.is_workspace_member(id));

create policy "workspaces are updatable by their owner"
  on public.workspaces
  for update
  to authenticated
  using (public.is_workspace_owner(id))
  with check (public.is_workspace_owner(id));

create policy "workspaces are deletable by their owner"
  on public.workspaces
  for delete
  to authenticated
  using (public.is_workspace_owner(id));

-- workspace_members.

create policy "memberships are readable by workspace members"
  on public.workspace_members
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "memberships are insertable by the workspace owner"
  on public.workspace_members
  for insert
  to authenticated
  with check (public.is_workspace_owner(workspace_id));

create policy "memberships are updatable by the workspace owner"
  on public.workspace_members
  for update
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

create policy "memberships are deletable by the workspace owner"
  on public.workspace_members
  for delete
  to authenticated
  using (public.is_workspace_owner(workspace_id));
