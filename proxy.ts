import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { clientEnv } from "@/lib/env"
import {
  applicationPolicy,
  createNonce,
  cspReportUri,
  environmentFrom,
  isStaticMarketingRoute,
  marketingPolicy,
  marketingReportOnlyPolicy,
} from "@/lib/security/headers"
import { resolvePublicRoute } from "@/lib/public/routing"
import type { Database } from "@/lib/supabase/database.types"

/**
 * Refreshes the Supabase session on every request and writes the rotated cookies
 * onto the response. Server Components cannot set cookies, so without this the
 * session silently expires mid-visit.
 *
 * This is the `proxy` file convention, which replaced `middleware` in Next 16.
 *
 * The redirect below is a convenience, not authorization. Every protected route
 * re-checks the user server-side; "the proxy redirected them" is not a security
 * boundary, per docs/security.md rule 7.
 *
 * It is also where the Content-Security-Policy is decided, because a nonce has
 * to be minted per request and handed to Next before the page renders. Next
 * reads it from the request's Content-Security-Policy header and stamps it on
 * every script it emits, so nothing in a layout has to read headers() and
 * nothing becomes dynamic that was not already. The prerendered marketing
 * routes cannot carry a nonce and get the policy without a script rule; see
 * lib/security/headers.ts and ADR 0007.
 */

// `/reset-password` is public because the recovery session may already be gone
// by the time someone opens it, and the page's own expired-link message is more
// use to them than a silent bounce to /sign-in. The page and the action both
// re-check; this list is convenience, not authorization.
//
// The marketing site is public by definition: it is what a visitor sees before
// there is an account to protect. `/` is on the list because it serves the
// landing page to a signed-out visitor; the page itself still resolves a signed-in
// one to their workspace.
export const PUBLIC_PATHS = [
  "/",
  "/about",
  "/how-it-works",
  "/marketplaces",
  "/pricing",
  "/privacy",
  "/start",
  "/terms",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/api/health",
  // Images and the outbound-click beacon for the public creator pages. Every
  // one of them re-derives what it may serve from an `anon` read, so the
  // session this list would otherwise demand is not merely unnecessary: a
  // public page's images must load for a visitor who will never have one.
  "/api/public",
]

/**
 * Routes a provider calls. No page belongs here.
 *
 * Each of these is reached by another company's server, which holds no Fanwise
 * session and never will, and each authenticates itself by something stronger
 * than a cookie. `docs/security.md` and both route docblocks say the same
 * sentence: nobody is signed in, and nothing in the request is trusted.
 *
 *   - A channel's **grant** route consumes a state Fanwise minted, exactly
 *     once, then proves the credential by calling the account the state row
 *     names. Keys for some other store are refused.
 *   - The billing **webhook** verifies the provider's signature over the raw
 *     bytes before a field is read, and records the event by the provider's
 *     own id so a redelivery collides at the database.
 *
 * Guarding either does not make it safer, it makes it unreachable. Both were
 * answering with a 307 to /sign-in: the grant threw away the store's consumer
 * keys, and the webhook would have thrown away every subscription event.
 * Neither failure is visible from inside Fanwise — the sender sees the
 * redirect and Fanwise sees nothing at all — which is why both survived this
 * long and why the sweep that found the second one checked every route.
 *
 * Anchored at both ends, and a channel key may not contain a slash, so these
 * open exactly the routes named and nothing beneath them. A channel's callback
 * is deliberately absent: the creator returns to it in their own browser,
 * carrying their session, and it only ever reports.
 */
export const PUBLIC_PATTERNS = [
  /^\/api\/channels\/[^/]+\/oauth\/grant$/,
  /^\/api\/billing\/webhook$/,
]

export function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    PUBLIC_PATTERNS.some((pattern) => pattern.test(pathname))
  )
}

export default async function proxy(request: NextRequest) {
  const env = clientEnv()
  const environment = environmentFrom(process.env)
  const policyInput = { environment, supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL }
  const marketing = isStaticMarketingRoute(request.nextUrl.pathname)
  const nonce = marketing ? null : createNonce()
  const policy = nonce ? applicationPolicy({ ...policyInput, nonce }) : marketingPolicy(policyInput)

  // The request headers Next renders against. Rebuilt whenever the cookie
  // store changes, because the Supabase client mutates the request's cookies
  // and Next has to see the rotated values.
  const forward = () => {
    const headers = new Headers(request.headers)
    if (nonce) headers.set("content-security-policy", policy)
    return NextResponse.next({ request: { headers } })
  }

  const decorate = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", policy)
    if (marketing) {
      response.headers.set(
        "Content-Security-Policy-Report-Only",
        marketingReportOnlyPolicy({
          ...policyInput,
          reportUri: cspReportUri(process.env.SENTRY_DSN),
        }),
      )
    }
    return response
  }

  /*
    The public web, decided before anything else and before the session is
    touched at all.

    It comes first for two reasons. A public page must render for a visitor
    with no account, so it cannot fall through to the redirect at the bottom of
    this function; and it has no use for a session even when one exists, so
    resolving one would be a round trip to the auth server on every visit to a
    page whose content does not depend on the answer.

    That is also why nothing below this block can leak into a public page. The
    rewrite returns here, so the Supabase client is never constructed and no
    cookie is read. lib/supabase/public.ts then renders the page as `anon`,
    which is what makes the response the same for everyone and therefore safe
    to cache. See lib/public/routing.ts for why a rewrite is required at all.
  */
  const publicRoute = resolvePublicRoute(request.nextUrl.pathname)

  if (publicRoute.kind === "redirect") {
    const url = request.nextUrl.clone()
    url.pathname = publicRoute.to
    // 308, not 307: these are canonicalisations — a capitalised handle, a
    // trailing slash, the internal path — and they are permanent facts about
    // the address, not about this request. A search engine should fold them.
    return decorate(NextResponse.redirect(url, 308))
  }

  if (publicRoute.kind === "rewrite") {
    const url = request.nextUrl.clone()
    url.pathname = publicRoute.to
    const headers = new Headers(request.headers)
    if (nonce) headers.set("content-security-policy", policy)
    return decorate(NextResponse.rewrite(url, { request: { headers } }))
  }

  let response = forward()

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value))
          response = forward()
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  // getUser() revalidates the token with the auth server. getSession() only
  // decodes the cookie and is not trustworthy here.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isPublic(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/sign-in"
    url.search = ""
    return decorate(NextResponse.redirect(url))
  }

  return decorate(response)
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets. The negative lookahead
    // keeps the auth round-trip off image, font and script-file requests.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|js)$).*)",
  ],
}
