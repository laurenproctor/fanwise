# ADR 0007: Browser security headers, and where the nonce stops

**Status:** accepted, 9 September 2026
**Owns:** `lib/security/headers.ts`, the Content-Security-Policy half of `proxy.ts`, the
`headers()` block of `next.config.ts`, `public/theme.js`
**Proves:** `tests/unit/security-headers.test.ts`, `tests/e2e/security-headers.spec.ts`

---

## Context

Phase 4a of the security hardening asked for a Content Security Policy with a per-request
nonce covering the inline theme script, HSTS in production, `nosniff`, a referrer policy, a
permissions policy and `frame-ancestors 'none'`, with the constraint that a production script
rule never contains `'unsafe-inline'` or `'unsafe-eval'`, and the instruction not to convert
the application to dynamic rendering without approval.

Those two constraints meet at the marketing pages. `next build` prerenders seven routes
(`/about`, `/how-it-works`, `/marketplaces`, `/pricing`, `/privacy`, `/start`, `/terms`).
A nonce is minted per request, and a prerendered page is rendered when no request exists,
so it cannot carry one. Moving the theme initialiser out of the page removes one of the
three inline scripts on such a page; the other two are Next's own hydration data, emitted
on every App Router page, different per page and per build, and impossible to hash in a
policy that has to exist before the HTML does. Next's experimental Subresource Integrity
mode was tried and leaves them in place. There is no Next-supported way to give a static
page a strict script rule.

## Decision

**The nonce stops at the marketing routes, and this is stated rather than hidden.**

- **Dynamic routes** (the workspace, the auth pages, `/`) get
  `script-src 'self' 'nonce-…'`. The proxy mints the nonce, puts the policy on the
  request's `Content-Security-Policy` header, and Next stamps the nonce on every script it
  emits. No layout reads `headers()`, so nothing becomes dynamic that was not already. A
  workspace guard's `notFound()` fires inside a dynamic render, so the not-found page it
  lands on is rendered with the request's nonce too. Making the root not-found page itself
  dynamic (with `connection()`) was tried and rejected: that boundary sits in every route's
  tree, and a request-time API there turned every page in the build dynamic.
- **Prerendered marketing routes** get every other directive (`frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri`, `form-action`, image, font, connect and frame
  restrictions) and **no script rule**, with no `default-src` either, because scripts would
  fall back to it and Next's hydration would break. Until the marketing site is its own
  deployment, which the roadmap already intends, its scripts are unrestricted. The strict
  policy is sent alongside in report-only form, with Sentry as the report target when a DSN
  is configured, so the cost of enforcing it is measured before that move.
- **The theme initialiser is `public/theme.js`**, loaded synchronously in `<head>` as a
  same-origin script. `'self'` admits it on every route; no nonce is needed, so the root
  layout stays free of request-time APIs. A unit test keeps its storage key and legacy
  values in step with the toggle component. It is a plain synchronous tag, with the
  `no-sync-scripts` lint disabled on that line and the reason beside it: `next/script`'s
  `beforeInteractive` emits only a preload in the static HTML and injects the tag from the
  client runtime, which is after the first paint it exists to precede.
- **`'strict-dynamic'` is not used.** It would make the browser ignore `'self'`, which is
  what admits the theme script, and it would block Vercel's preview toolbar, which is
  injected without a nonce. The application has no JSONP-style endpoint on its own origin
  for `'strict-dynamic'` to defend against.
- **Environments.** Read from `VERCEL_ENV` first, because a preview is a production build
  on a throwaway URL. Production sends HSTS (two years, subdomains, no preload) and
  `upgrade-insecure-requests`. Preview admits the toolbar's hosts. Development admits
  `'unsafe-eval'`, which React needs for its server-stack reconstruction, and the dev
  socket. A local `next start`, which is what the E2E suite runs, is the production policy
  without the https-only parts, so the suite asserts the real script rule.
- **What is admitted beyond this origin:** the Supabase URL, for the browser's auth calls,
  the signed-URL uploads that PUT straight to storage, and the asset previews that redirect
  an `<img>` there. Nothing else in production. The unit test collects every origin a
  policy names and compares the set.
- **Baseline headers** (`nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `X-Frame-Options`, HSTS) come from `next.config.ts` so static assets get them too; the
  proxy's matcher skips assets on purpose and now skips `.js` under `public/` as well.

## Consequences

- A new marketing page has to be added to `STATIC_MARKETING_ROUTES`. The unit test compares
  the list with the prerender manifest of the last build, so forgetting fails the suite
  rather than shipping a static page with a nonce policy it cannot satisfy.
- A dynamic route that emits an inline script by hand must give it the nonce; Next does
  this for its own. The E2E suite loads pages and fails on any reported violation, which is
  how a missed one shows up.
- A path whose shape matches no route at all (`/a/b/c`, say) is served the build-time
  not-found HTML under the nonce policy, so its hydration scripts are refused and the page
  is static text with a working link. No link in the application produces such a path, and
  the alternative was every page dynamic.
- `docs/security.md` owes a section pointing here; the file is open in #45 and #48.
- Preview deployments currently fail to build for an unrelated reason recorded earlier, so
  the toolbar allowance is verified by the unit test and not yet by a live preview.
