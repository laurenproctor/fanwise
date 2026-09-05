import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { clientEnv } from "@/lib/env"
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
 */

// `/reset-password` is public because the recovery session may already be gone
// by the time someone opens it, and the page's own expired-link message is more
// use to them than a silent bounce to /sign-in. The page and the action both
// re-check; this list is convenience, not authorization.
const PUBLIC_PATHS = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/api/health",
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const env = clientEnv()

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
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
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets. The negative lookahead
    // keeps the auth round-trip off image and font requests.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
}
