# Security

## Non-negotiable

1. RLS on every tenant table, written in the same migration that creates the table.
2. Workspace isolation proven by tests, not by reading code.
3. Marketplace credentials encrypted at rest, read server-side only, never logged, never in
   an AI prompt, never returned to the browser.
4. The service-role client bypasses RLS. It is allowed only in webhook handlers and
   background jobs, and every such call site scopes the workspace itself in code.
5. Webhook signatures verified before the payload is parsed.
6. OAuth state validated on every callback.
7. Every write authorized. "The UI does not show the button" is not authorization.

## Credentials

A dedicated service, added at step A5 with the first Shopify connection. Requirements:
encryption at rest with a rotatable key, server-only access, token refresh, and no path by
which a credential reaches a log line, an error message, a prompt, or a client response.

`CREDENTIALS_ENCRYPTION_KEY` is a base64 32-byte key. Rotation plan gets written before the
first real credential is stored, not after.

## The three things that never bend

RLS, idempotency checks, and the factuality validator. If a feature appears to require
weakening one, the feature is wrong. Say so rather than working around it.

## Tenancy tests

For every tenant table, a test proving Workspace A cannot select, insert, update or delete a
Workspace B row. This suite grows with the schema and is never skipped in CI.

Live in `tests/db/`, run by `pnpm test:db` against a real local Supabase. The actors are
real users holding real JWTs, talking through PostgREST, because a policy tested over a raw
Postgres connection with a hand-set role proves the policy compiles, not that the path
production uses is safe.

**Denials do not all look alike, and asserting the wrong shape is how this suite would pass
while proving nothing.** Confirmed against the running stack at A1:

| Verb | Denial |
|---|---|
| SELECT, UPDATE, DELETE | the policy filters the rows away: HTTP 200, empty array, no error. Assert on the row count |
| INSERT | there is no row to filter, so the write raises: HTTP 403, SQLSTATE 42501. Assert on the error code |
| Any table access by `anon` | no grant at all, so it is refused before RLS is consulted: SQLSTATE 42501 |

An empty-array assertion on an INSERT passes vacuously, because `data` is null whenever
there is an error. Every negative case is also paired with a service-role read confirming
the target row is genuinely untouched; a zero-row response is not by itself proof that
nothing was written.

## Signed upload URLs bypass RLS, by design

A Supabase signed upload URL is a **bearer capability**. Whoever holds it may
write to the path it names, and the storage RLS policies do not apply to that
write. This is not a misconfiguration to be fixed; it is how the upload path
works, and it is the reason a 4 GB deliverable never has to pass through a
serverless function.

The consequences are structural, and A3 onward must preserve them:

1. **The server action that mints the URL is the authorization boundary.**
   `createUploadIntent` in `lib/products/actions.ts` re-checks the user, resolves
   the workspace from the slug, and confirms the product belongs to it before
   minting anything. The storage policies protect direct client access to
   objects; they do not protect this path.
2. **The server chooses the storage path.** The client supplies a filename, never
   a path. `buildStoragePath` composes
   `<workspace_id>/<product_id>/<asset_id><ext>` from ids already checked, and
   strips any directory component out of the filename. A caller therefore cannot
   point a signed URL at another workspace's prefix, because it never names its
   own destination.
3. **Nothing the client says about the bytes is trusted.** Size and content type
   from the browser are hints. The finalize job downloads the stored object and
   measures it: SHA-256, byte size, and a magic-number sniff. The row stays
   `pending` until that has happened.

If a future step ever accepts a client-supplied storage path, all three of these
collapse at once.

## RLS decisions worth not relearning

1. Membership lookups are `security definer` functions with `set search_path = ''`. A policy
   on `workspace_members` that reads `workspace_members` recurses forever.
2. `workspace_members` is deliberately **not** `force row level security`. FORCE subjects the
   table owner to RLS, which re-applies the policy inside the security definer helper and
   brings the recursion straight back.
3. `auth.uid()` is written `(select auth.uid())` everywhere, so Postgres hoists it into an
   InitPlan and evaluates it once per statement instead of once per row.
4. `workspaces` has no INSERT policy. Creation is `create_workspace()` only.
5. A tenant boundary that can be expressed as a foreign key should be. At A2,
   `product_assets` references `products (id, workspace_id)` as a pair, because a
   policy checking `workspace_id` alone still allowed attaching an asset to
   another workspace's product. A foreign key cannot be talked out of it.
6. `storage.objects` policies read the workspace id from the first path segment,
   via `storage_object_workspace_id()`. The cast is deliberately total: a
   malformed path returns null and denies, rather than raising.
