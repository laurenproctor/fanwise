-- The server identity's privileges, stated rather than inherited.
--
-- Every other grant in this schema is explicit: `authenticated` is granted
-- table by table, and channel_connection_secrets and channel_oauth_states are
-- deliberately granted nothing, because invariant 7 says credentials are read
-- server-side only. service_role was the one role never mentioned, and it
-- worked anyway — Supabase grants it broadly by default, so the omission was
-- invisible for eight migrations.
--
-- It stopped being invisible on a project created with "automatically expose
-- new tables" turned off, which is the correct setting: it is what makes those
-- two ungranted tables mean something instead of being an accident waiting for
-- the next table someone adds. With the default off, service_role got nothing,
-- and every server path failed with "permission denied" — storage signed URLs,
-- finalize_asset, the publication runner, credential reads.
--
-- So the privileges are written down. A schema that behaves differently
-- depending on a dashboard toggle is a schema that is not really in version
-- control, and the failure it produces names a table rather than the setting.
--
-- service_role is the trusted server identity and bypasses RLS by role
-- attribute, not by grant. Granting it fully is restoring the documented
-- default, not widening anything: it is never held by a browser, and
-- lib/supabase/admin.ts is the only place it is used.
grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- And for every table a later migration adds, so this cannot silently regress
-- the next time the schema grows.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
