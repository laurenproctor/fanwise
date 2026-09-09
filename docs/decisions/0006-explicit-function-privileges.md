# ADR 0006: Explicit function privileges and the credential binding

**Status:** accepted, 9 September 2026
**Migration:** `20260909170000_function_privileges_and_secret_binding`
**Proves:** `tests/db/function-privileges.test.ts`, `tests/db/credential-binding.test.ts`

---

## Context

Supabase's Security Advisor reported that `public.rls_auto_enable()` on the hosted project
is a `security definer` event-trigger function callable by `anon` and `authenticated`. The
function was created from the dashboard, never by a migration, and does not exist on a
fresh `supabase db reset`. It was born with Postgres's hard-wired default, which grants
`EXECUTE` to `PUBLIC` on every new function.

Reading the catalog showed the finding was the visible corner of a wider habit. The A1
migration revoked `PUBLIC` from the three functions it wrote and granted `authenticated`
explicitly, and every function since had been left on the default: the four trigger
functions and the two storage-policy helpers were executable by every role. A trigger
function cannot be called except by its trigger, so the exposure was small. The point is
that it was implicit, and the next function would have been implicit too.

Local and hosted also disagreed on what a new object gets by default. The local image
adds per-schema defaults granting `anon` and `authenticated` execute on new functions and
every privilege on new tables; the hosted project, created with "expose new tables" off,
grants neither. The service-role migration at A5 recorded the cost of that kind of
difference: a schema whose behaviour depends on a dashboard toggle is not in version
control.

Separately, `channel_connection_secrets` carried two single-column foreign keys, one to
the connection and one to the workspace, so a row could name a connection in one
workspace and a workspace that is another. The GCM binding in `lib/credentials` refuses to
open such a row, which is the second line of defence. The first line was missing. This is
the lesson `product_assets` learned at A2: a tenant boundary that can be a foreign key
should be.

## Decision

**Every function's execute privilege is stated, and the default for a new one is nothing.**

| Function | Class | Executable by |
|---|---|---|
| `create_workspace(text, text)` | RPC, deliberately callable by a signed-in user | `authenticated`, `service_role` |
| `is_workspace_member(uuid)`, `is_workspace_owner(uuid)` | Read by RLS policies, as the calling role | `authenticated`, `service_role` |
| `uuid_or_null(text)`, `storage_object_workspace_id(text)` | Read by the `storage.objects` policies, as the calling role | `authenticated`, `service_role` |
| `set_updated_at()`, `enforce_asset_immutability()`, `enforce_listing_status_source()`, `enforce_snapshot_immutability()` | Trigger-only | `service_role` (never called; the grant is the A5 blanket) |
| `rls_auto_enable()` | Dashboard-created, hosted only | owner and `service_role`, once the migration is applied |

Three facts about Postgres make the table safe, and are worth not relearning:

1. **A trigger fires regardless of the calling role's `EXECUTE` on its function.** The
   privilege is checked at `CREATE TRIGGER`, by the migration, and not again. A member's
   insert still runs `set_updated_at()` with no grant at all. The test proves it.
2. **A function read by a policy is called as the requesting role**, so `authenticated`
   needs execute on everything a policy names, including the helpers a `security invoker`
   helper calls in turn. That is why the two storage helpers keep a grant.
3. **PostgREST does not list a function that returns `trigger`.** A browser role asking
   for one by name gets "not found" (`PGRST202`) before Postgres is consulted. That is the
   refusal shape those tests assert; the catalog test proves the grant itself is gone.

**Defaults.** The per-schema grants to `anon` and `authenticated` on new functions, tables
and sequences are revoked, which is a no-op on hosted and makes local match it. The
hard-wired `EXECUTE` to `PUBLIC` on new functions is revoked with the global form of
`alter default privileges`, because Postgres cannot reverse a hard-wired grant per schema
("Per-schema REVOKE is only useful to reverse the effects of a previous per-schema
GRANT"). From now on a function nobody has mentioned in a grant is executable by its owner
and the service role only, and a function meant for RPC needs an explicit grant in the
migration that creates it. `tests/db/function-privileges.test.ts` reads `pg_proc` and fails
on the next omission.

**The dashboard function is revoked, not adopted.** The migration revokes `PUBLIC`, `anon`
and `authenticated` from `rls_auto_enable()` only if it exists, so a clean local replay
does nothing and the hosted apply closes the finding. The repository does not create the
function: the discipline here is RLS in the migration that creates the table, and a net
that enables it afterwards would let a migration forget. Whether an event trigger is
actually attached on hosted is not visible in a schema dump and is worth confirming in the
dashboard with `select evtname, evtfoid::regproc from pg_event_trigger`.

**The credential row is bound by a composite foreign key.**
`channel_connection_secrets (channel_connection_id, workspace_id)` now references
`channel_connections (id, workspace_id)`, on delete cascade, replacing the single-column
key to the connection. The key to `workspaces` stays. The migration counts disagreeing
rows and raises before adding the constraint; the constraint would refuse too, but a
count is a better message than a row. The AES-GCM additional-authenticated-data binding
is unchanged and is still exercised end to end.

## Consequences

- **A `create extension` run as `postgres` after this migration produces functions with
  no `PUBLIC` execute.** An extension function a browser role must call, such as a column
  default, needs an explicit grant in the migration that creates the extension. The
  extensions this schema uses were created at A0 and are unaffected.
- **PR #45's `record_channel_billing_event()`**, a `security definer` trigger function,
  is created after this migration on a clean replay and gets no browser-role grant. On
  hosted, where it will be created by `db push`, the same default applies. The line worth
  adding to that migration anyway, for the reader, is
  `revoke all on function public.record_channel_billing_event() from public, anon, authenticated;`.
- **Migration ordering with #45.** This migration is dated after #45's. If it reaches
  hosted first, #45's push needs `supabase db push --include-all`.
- **Generated types are not regenerated.** The composite key changes the relationship
  entry for `channel_connection_secrets` in `lib/supabase/database.types.ts`, which PR #45
  is editing. Nothing in the code embeds across that relationship; the file is regenerated
  when #45 has merged.
- **`docs/security.md` and `docs/data-model.md` owe a paragraph each**, under "RLS
  decisions worth not relearning" and under A3's credentials revision. Both files are open
  in #45 and #48, so the paragraphs wait for those merges and point here.
- **The catalog test depends on the local database container.** It reaches `pg_proc`
  through `docker exec` into `supabase_db_<project_id>`, because PostgREST exposes
  `public` and nothing else. When the container cannot be reached the test fails rather
  than skips.
