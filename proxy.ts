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
]

/**
 * Public by shape rather than by name.
 *
 * One entry, and it is not a page. A channel's grant route receives the
 * provider's server-to-server POST: `docs/security.md` and the route's own
 * docblock both say nobody is signed in on that POST and nothing in it is
 * trusted. It authenticates by consuming a state Fanwise minted, exactly once,
 * and by proving the credential against the account the state row names — a
 * stronger check than a session cookie, and a session cookie is not on offer,
 * because the sender is the store's server and not anybody's browser.
 *
 * Guarding it does not make it safer, it makes it unreachable: the grant POST
 * was answered with a 307 to /sign-in, so the credential never arrived and no
 * such store could finish connecting. The first attempt died earlier still, on
 * the store's own SSL check, which is why this was never seen.
 *
 * Anchored at both ends, and the channel key may not contain a slash, so this
 * opens exactly one route per channel and nothing beneath it. The callback is
 * deliberately not here: the creator returns to it in their own browser, with
 * their session, and it only ever reports.
 */
export const PUBLIC_PATTERNS = [/^\/api\/channels\/[^/]+\/oauth\/grant$/]

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
