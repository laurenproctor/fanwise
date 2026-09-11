-- First-run provisioning: a personal workspace, created on arrival.
--
-- A new account used to land on a form asking it to name a workspace before it
-- had seen anything. It now gets one automatically, from app/onboarding/route.ts.
-- That handler is a GET: a browser replays it, a person refreshes it, two tabs
-- race it, and every sign-in without a workspace passes through it. Checking for
-- a workspace and then creating one in application code is two statements with
-- a gap between them, and two requests inside that gap make two workspaces. So
-- the check and the insert live here, together, behind a lock.
--
-- provision_personal_workspace() takes a transaction-scoped advisory lock keyed
-- on the caller. A second call for the same user waits until the first commits,
-- and because every statement under READ COMMITTED takes a fresh snapshot, its
-- membership check then sees the workspace the first call wrote and returns it.
-- Calls for different users do not wait on each other, short of a hash
-- collision, which costs a moment and nothing else.
--
-- When the caller already belongs to a workspace it returns the earliest, which
-- is the one the application's resolver in app/page.tsx picks, and ignores the
-- name and slug it was given. It never returns a workspace the caller is not a
-- member of. A slug collision raises unique_violation and rolls the whole call
-- back, lock included, so the application retries with another suffix and
-- nothing is left half-made.
--
-- Additive. No table, constraint, policy or existing function changes:
--
--   * No unique constraint on workspaces.owner_user_id. It would be the
--     stronger statement, and it would refuse to apply on any database where an
--     account already owns two workspaces, which create_workspace() has always
--     permitted and tests/db/function-privileges.test.ts does on purpose. It
--     would also settle whether an account may ever hold a second workspace,
--     which is not this migration's question.
--   * create_workspace() is untouched and still granted. The application no
--     longer calls it; the tenancy harness does.
--
-- Execute is granted to authenticated explicitly, per ADR 0006. The service
-- role receives it from the A5 default privilege.

create or replace function public.provision_personal_workspace(p_name text, p_slug text)
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('provision_personal_workspace:' || v_user_id::text, 0)
  );

  select w.*
    into v_workspace
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = v_user_id
  order by w.created_at asc, w.id asc
  limit 1;

  if found then
    return v_workspace;
  end if;

  insert into public.workspaces (name, slug, owner_user_id)
  values (btrim(p_name), lower(btrim(p_slug)), v_user_id)
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace.id, v_user_id, 'owner');

  return v_workspace;
end;
$$;

comment on function public.provision_personal_workspace is
  'Returns the caller''s earliest workspace, creating a personal one and its owner membership when they have none. Serialized per user, so concurrent calls create at most one.';

revoke all on function public.provision_personal_workspace(text, text) from public, anon;
grant execute on function public.provision_personal_workspace(text, text) to authenticated;
