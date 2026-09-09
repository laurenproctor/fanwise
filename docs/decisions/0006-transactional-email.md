# ADR 0006: Who sends Fanwise's email

**Status:** accepted, 9 September 2026. The founder chose Resend.
**Date:** September 2026
**Blocks:** Gate A exit, the first moment an outside creator uses a deployed instance.
**Supersedes:** open-decisions register entry 20, which stays as an index pointer

---

## Context

Discovered on 5 September 2026, pushing `config.toml` to a hosted Supabase project:

> Email template modification is not available for free tier projects using the default email
> provider. Please upgrade your plan or configure a custom SMTP provider.

Two consequences, and the second is the one that matters.

Signup on a hosted project defaults to requiring email confirmation, and the built-in sender
is rate limited to a handful of messages an hour. The first few signups on a fresh project
fail with "Too many attempts", which is our own normalization of a rate limit nobody has hit
locally, because local runs with `enable_confirmations = false`.

The real problem is the recovery template. `supabase/templates/recovery.html` exists because
the stock template returns a PKCE code that only works in the browser that asked for the
reset: someone who requests a reset on a laptop and opens the mail on their phone gets an
invalid link, and recovery is exactly the flow where that happens. That template cannot be
installed on the default provider. So a deployment on the built-in sender silently reverts to
the stock template and reacquires the bug the custom one was written to fix. Nothing errors.
Password recovery simply half-works, on the flow least likely to be exercised before a real
person needs it.

The quota bit on 8 September 2026, the day the app first went live on Vercel. A few reset
requests while testing exhausted the hour, and every request after that was accepted with a
200 and produced no email.

## Decision

**Resend is the provider.** Auth email from the hosted project goes through Resend's SMTP
relay, from a subdomain verified for that purpose. The provider is part of the environment,
not a detail of the auth config: its four values live in `.env.local` and nowhere else, and
the app never reads them.

**The wiring is in the repository and the switch is the credentials.** `supabase/config.toml`
carries a `[remotes.production]` block: the live site URL, the redirect allowlist, and an
SMTP section whose host, user, password and From address are `env()` references to
`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `SMTP_ADMIN_EMAIL`. `pnpm auth:push` loads those
from `.env.local` and applies the file to the hosted project, installing the recovery
template in the same push. It refuses to run while any of the four is blank, because a
half-filled block would enable SMTP with an empty host and stop every auth email.

For Resend the values are host `smtp.resend.com`, user `resend`, the API key as the
password, and a From address on the verified subdomain. The port is pinned to 587 in
`config.toml` rather than read from the environment, because `env()` substitutes strings and
the field is an integer.

Until the four values are set, the hosted project stays on the built-in sender with the
stock template, and its site URL and allowlist as set by hand in the dashboard on
8 September 2026. Signup confirmation stays off.

## Why Resend and not Postmark

Both were on the table for deliverability on transactional mail rather than price, and
through Gate A the volume is trivial either way. Resend won on three points that matter at
this stage and one that does not.

- **No account review.** Postmark approves new accounts by hand before they can send to
  outside addresses. Resend sends as soon as a domain verifies, which matters when the
  provider is turned on the day it is needed.
- **The free tier covers the foreseeable volume.** Three thousand messages a month, one
  hundred a day. Postmark's is one hundred a month, then a subscription.
- **It drops into the wiring as written.** Port 587, a fixed username, an API key as the
  password.
- **Deliverability is close enough.** Postmark's inbox placement reputation is the stronger
  one, and it was the reason to prefer it. For low-volume auth mail from a verified subdomain
  the difference does not pay for the friction above, and switching is four values and one
  push if it ever does.

## Consequences

- A domain Fanwise controls is now a prerequisite for the hosted project's email. Supabase
  cannot send from `vercel.app`. Verify a subdomain such as `mail.<domain>` rather than the
  root, so auth mail reputation stays separate from anything sent from the root later.
- The Resend API key is created with sending-only access, scoped to that one domain, and is
  treated like every other secret: `.env.local`, never logged, never in a prompt.
- Once custom SMTP is on, Supabase's own default of thirty emails an hour applies in place
  of the built-in cap. It is adjustable under Authentication, Rate Limits, and does not need
  raising through Gate A.
- `pnpm auth:push` applies the whole auth config, so the first real push shows a diff wider
  than SMTP. It is read before it is confirmed.
- `pnpm test:e2e` continues to prove the recovery flow against local Supabase, where the
  template loads without any of this.
