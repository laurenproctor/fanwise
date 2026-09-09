-- Security hardening, phase 1: every function's execute privilege stated, and
-- the credential row bound to its connection's workspace by the database.
--
-- Three things, and the reason each is here.
--
--   1. The hosted project carries public.rls_auto_enable(), a security definer
--      event-trigger function created from the dashboard, never by a migration.
--      It was born with the hard-wired default: EXECUTE for PUBLIC, which is
--      every role including anon. Supabase's Security Advisor reported it. It
--      does not exist on a fresh `supabase db reset`, so the revocation is
--      conditional: present, it loses PUBLIC, anon and authenticated; absent,
--      nothing happens and nothing is created. The repository does not adopt
--      the function, because the discipline here is RLS in the migration that
--      creates the table, not a net underneath it.
--
--   2. Every other function in `public` had the same default. The trigger
--      functions and the two storage-policy helpers were never mentioned in a
--      grant, so PUBLIC could execute all of them. A trigger function cannot
--      be called except as a trigger, so the exposure was small; the point is
--      that it was implicit. From here on execution is explicit, function by
--      function, and the default for a function nobody has mentioned is
--      nothing. A test enumerates pg_proc and fails on the next omission.
--
--   3. channel_connection_secrets referenced channel_connections(id) and
--      workspaces(id) separately, so a row could name a connection in one
--      workspace and a workspace that is another. The credential service's
--      GCM binding would refuse to open such a row, which is the second line.
--      The first line is a composite foreign key, the same lesson product_assets
--      learned at A2: a tenant boundary that can be a foreign key should be.
--
-- Nothing here changes a policy, a table grant, or the credential service.

-- ---------------------------------------------------------------------------
-- 1. The dashboard-created event-trigger function, if it exists
-- ---------------------------------------------------------------------------

do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
  loop
    -- An event trigger fires as the role running the DDL, which on this
    -- project is postgres, the owner. It needs no grant to anyone else.
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated',
      fn.nspname, fn.proname, fn.args
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Explicit execute on every function the repository owns
--
-- Classification, which the ADR repeats with the reasoning:
--
--   RPC, deliberately callable by a signed-in user
--     create_workspace(text, text)
--   Read by RLS policies, as the calling role
--     is_workspace_member(uuid), is_workspace_owner(uuid)
--   Read by the storage.objects policies, as the calling role
--     uuid_or_null(text), storage_object_workspace_id(text)
--   Trigger-only. Postgres checks EXECUTE at CREATE TRIGGER, not when the
--   trigger fires, so a member's insert still runs them with no grant at all
--     set_updated_at(), enforce_asset_immutability(),
--     enforce_listing_status_source(), enforce_snapshot_immutability()
--
-- The service role keeps execute on all of them through the A5 grant and
-- default privilege; it is the server identity and never a browser.
-- ---------------------------------------------------------------------------

-- Trigger-only. Nobody calls these; nothing needs a grant.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_asset_immutability() from public, anon, authenticated;
revoke all on function public.enforce_listing_status_source() from public, anon, authenticated;
revoke all on function public.enforce_snapshot_immutability() from public, anon, authenticated;

-- Storage-policy helpers. The policies on storage.objects are `to authenticated`
-- and evaluate as that role, and both functions are security invoker, so the
-- role needs execute on both. They are pure and total: calling one directly
-- yields a uuid or null and nothing else.
revoke all on function public.uuid_or_null(text) from public, anon;
revoke all on function public.storage_object_workspace_id(text) from public, anon;
grant execute on function public.uuid_or_null(text) to authenticated;
grant execute on function public.storage_object_workspace_id(text) to authenticated;

-- The A1 functions, restated so this migration is the complete statement of
-- who may execute what. Each of these lines is already true.
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_owner(uuid) from public, anon;
revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.create_workspace(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2b. The default for whatever comes next
--
-- Two layers, because Postgres keeps them separately and reverses them
-- differently.
--
-- The local image adds per-schema defaults granting anon and authenticated
-- execute on new functions and every privilege on new tables and sequences.
-- The hosted project, created with "expose new tables" off, has neither. A
-- per-schema REVOKE reverses a per-schema GRANT, so these three lines make
-- the two databases agree: a new table or function in `public` is reachable
-- by a browser role only when a migration says so. Every existing migration
-- already says so, table by table, which is why nothing changes today.
--
-- The hard-wired grant of EXECUTE to PUBLIC on every new function is not
-- per-schema and cannot be undone per-schema; only the global form reaches
-- it. Objects created by postgres in any schema are affected, which is the
-- intent for functions. Note for the future: a `create extension` run as
-- postgres after this point produces functions with no PUBLIC execute either,
-- so an extension function a browser role must call (a column default, say)
-- needs an explicit grant in the migration that creates it. The extensions
-- this schema uses were created before this line and are unaffected.
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges for role postgres
  revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- 3. The credential row is bound to its connection's workspace
-- ---------------------------------------------------------------------------

-- Refuse loudly, before the constraint, if any row already disagrees. The
-- constraint would refuse too; this names the count instead of a row.
do $$
declare
  v_mismatched bigint;
begin
  select count(*) into v_mismatched
  from public.channel_connection_secrets s
  left join public.channel_connections c
    on c.id = s.channel_connection_id
   and c.workspace_id = s.workspace_id
  where c.id is null;

  if v_mismatched > 0 then
    raise exception
      'channel_connection_secrets: % row(s) name a workspace that is not their connection''s; refusing to add the binding',
      v_mismatched;
  end if;
end
$$;

alter table public.channel_connection_secrets
  drop constraint channel_connection_secrets_channel_connection_id_fkey,
  add constraint channel_connection_secrets_connection_workspace_fkey
    foreign key (channel_connection_id, workspace_id)
    references public.channel_connections (id, workspace_id)
    on delete cascade;

comment on constraint channel_connection_secrets_connection_workspace_fkey
  on public.channel_connection_secrets is
  'The tenant boundary as a foreign key: a credential row names the same workspace as its connection, or it does not exist. The GCM binding in lib/credentials is the second line, not the first.';
