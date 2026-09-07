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

Built at A5, in `lib/credentials`. It is the only path to
`channel_connection_secrets`, which carries no grant to `anon` or `authenticated` at all, so
every call goes through the service role and scopes its own workspace in code.

AES-256-GCM, with the connection identity passed as **additional authenticated data**:

```
channel_connection:<workspace_id>:<connection_id>
```

Encryption alone does not give this. Ciphertext with no binding is portable, so a sealed blob
copied from one connection row to another — or from one workspace to another — would open
happily into the wrong tenant's connection. With the binding it fails to open instead. The
consequence worth knowing before meeting it at 2am: **a credential row cannot be moved
between connections.** Re-parenting a connection means re-authorizing it.

`CREDENTIALS_ENCRYPTION_KEY` holds a **keyring**, not a key. A bare base64 32-byte value
means version 1; `2:<new>,1:<old>` is a rotation in progress, and the highest version is
active. `channel_connection_secrets.key_version` selects the key a row is opened with.

**The rotation plan is `docs/decisions/0003-credential-key-rotation.md`**, written before the
first credential was stored, as this document required. Rows re-seal lazily on read; a key
version is retired only once no row references it, and the count query that proves that is
step 5 of the procedure. Skipping it is the one way to get this wrong.

The variable is parsed lazily rather than at boot, because an application with no marketplace
credentials is a valid application: every step before A5, every CI run and every fresh
checkout is one. The cost of that is a loud failure at the moment a credential is actually
handled, which is where it belongs.

Nothing in `lib/credentials` logs, and no error thrown from it carries plaintext or key
material. A caller learns that decryption failed, not what was in the box.

## OAuth

State is a **single-use row**, not a cookie (`channel_oauth_states`). A cookie satisfies rule
6 literally and not actually: the same callback URL opened twice validates twice. A row is
consumed by a conditional update carrying `consumed_at is null`, so two callbacks racing on
one state produce exactly one winner, decided by the database rather than by a read followed
by a write.

The callback route's order is the security of it, and it is deliberate:

1. verify the provider's signature, before any parameter is used
2. consume the state, exactly once
3. confirm the person finishing is the person who started
4. only then exchange the code

Doing 4 before 1 would have Fanwise send its client secret in response to an unauthenticated
GET that anyone can trigger. Doing 3 before 2 would leave a usable state behind after a
failed attempt.

The redirect URI is built from `NEXT_PUBLIC_APP_URL`, never from an incoming header: a
redirect URI derived from a header is a redirect URI an attacker can suggest. The account
identifier a creator types is validated against a fixed pattern before it reaches a URL,
because it becomes a hostname Fanwise redirects a person to and then posts a client secret
to.

A failed exchange returns a normalized sentence and nothing else. The thrown value may hold a
provider response body, and the request that produced it held a client secret.

## Password recovery

The flow is `/forgot-password` to `/auth/confirm` to `/reset-password`, and the three
properties that make it safe are each held in one place.

**It never says whether an address has an account.** `requestPasswordResetAction` answers with
the same sentence for a registered address, an unregistered one, and a send the provider
refused. Reporting the provider's error would be an oracle: "too many attempts" comes back
only for an address that exists, and that is enough to enumerate a customer list one address
at a time. The only thing reported is a malformed address, which the browser knows already and
which depends on no account. An E2E test compares the two responses character for character,
because this property is lost by a well-meaning improvement to an error message.

**The link is spent server-side, once.** `/auth/confirm` exchanges the emailed token for a
session and redirects. The token never reaches a client component, and it is single use at the
auth server, which `tests/db/password-recovery.test.ts` proves by replaying one. Everything
after the redirect authorizes on the session cookie, so `updatePasswordAction` takes no token
parameter and re-checks the session itself, per rule 7.

**The redirect target is checked.** `safeRedirectTarget` narrows the `next` parameter to a
plain same-origin path. Unchecked, it is an open redirect on a URL that arrives by email and
has just established a session, which is the most valuable moment to steer someone somewhere
else. The base URL is `NEXT_PUBLIC_APP_URL`, never a request header, for the same reason the
OAuth redirect URI is.

Changing the password calls `signOut({ scope: "others" })`. Recovery exists because the old
password may be in someone else's hands, so sessions opened with it do not survive.

The recovery email is a project template, `supabase/templates/recovery.html`, and it points at
Fanwise carrying `token_hash`. The stock template routes through Supabase's verify endpoint and
returns a PKCE code, which only works in the browser that asked for the reset: a person who
requests a reset on a laptop and opens the mail on their phone gets an invalid link, and
recovery is exactly the flow where that happens. `/auth/confirm` still accepts a code, so a
deployment whose template has not been updated degrades rather than breaks. **A hosted project
does not inherit `config.toml`, so the template has to be set on the project itself, and the
`/auth/confirm` URL added to its redirect allowlist.**

## Password recovery

The flow is `/forgot-password` to `/auth/confirm` to `/reset-password`, and the three
properties that make it safe are each held in one place.

**It never says whether an address has an account.** `requestPasswordResetAction` answers with
the same sentence for a registered address, an unregistered one, and a send the provider
refused. Reporting the provider's error would be an oracle: "too many attempts" comes back
only for an address that exists, and that is enough to enumerate a customer list one address
at a time. The only thing reported is a malformed address, which the browser knows already and
which depends on no account. An E2E test compares the two responses character for character,
because this property is lost by a well-meaning improvement to an error message.

**The link is spent server-side, once.** `/auth/confirm` exchanges the emailed token for a
session and redirects. The token never reaches a client component, and it is single use at the
auth server, which `tests/db/password-recovery.test.ts` proves by replaying one. Everything
after the redirect authorizes on the session cookie, so `updatePasswordAction` takes no token
parameter and re-checks the session itself, per rule 7.

**The redirect target is checked.** `safeRedirectTarget` narrows the `next` parameter to a
plain same-origin path. Unchecked, it is an open redirect on a URL that arrives by email and
has just established a session, which is the most valuable moment to steer someone somewhere
else. The base URL is `NEXT_PUBLIC_APP_URL`, never a request header, for the same reason the
OAuth redirect URI is.

Changing the password calls `signOut({ scope: "others" })`. Recovery exists because the old
password may be in someone else's hands, so sessions opened with it do not survive.

The recovery email is a project template, `supabase/templates/recovery.html`, and it points at
Fanwise carrying `token_hash`. The stock template routes through Supabase's verify endpoint and
returns a PKCE code, which only works in the browser that asked for the reset: a person who
requests a reset on a laptop and opens the mail on their phone gets an invalid link, and
recovery is exactly the flow where that happens. `/auth/confirm` still accepts a code, so a
deployment whose template has not been updated degrades rather than breaks. **A hosted project
does not inherit `config.toml`, so the template has to be set on the project itself, and the
`/auth/confirm` URL added to its redirect allowlist.**

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
