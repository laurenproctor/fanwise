import { PUBLIC_INTERNAL_PREFIX } from "@/lib/routes"

/**
 * How a request for the public web is answered, decided before the router runs.
 *
 * ## Why the proxy has to be involved at all
 *
 * `/@northline-studio` is the address Fanwise advertises, and in the App
 * Router it cannot simply be a folder.
 *
 *   - `app/@handle/` is a **parallel route slot**. The `@` prefix is taken by
 *     that convention, and such a folder contributes no URL segment at all: it
 *     becomes a prop on the parent layout.
 *   - `app/_p/` is a **private folder**. The underscore prefix excludes it from
 *     routing entirely, so it cannot be a rewrite destination either.
 *   - A route group, `app/(public)/[handle]/`, contributes no segment of its
 *     own, so its child lands at `/[handle]` — which is where the workspace
 *     already lives. That is the collision, not a solution to it.
 *
 * And doing nothing is not an option: `app/[slug]` is a dynamic segment, and a
 * dynamic segment matches `@northline-studio` as happily as it matches
 * `best-night`. Left alone, every public profile URL resolves to the private
 * workspace route, which requires a session, and a signed-out visitor is sent
 * to the sign-in page.
 *
 * So the proxy rewrites `/@<handle>` onto `/profile/<handle>` before the
 * router is consulted. The browser's address bar keeps the `@` form, which is
 * the only form that is ever linked, shared, or put in the sitemap.
 *
 * ## Why the internal path redirects back
 *
 * A rewrite destination is a real path, and a real path is a second address
 * for the same page: two URLs, one body, and a search engine that has to guess
 * which is canonical. Rather than patch that afterwards with a canonical tag
 * and hope, `/profile/...` answers every direct request with a permanent
 * redirect to the `@` form. There is only ever one reachable address.
 *
 * ## Everything here is a pure function
 *
 * The proxy runs on every request and may be deployed to a CDN. This module
 * takes a pathname and returns a decision, touching no database, no session
 * and no environment, which is also what lets the whole routing table be
 * tested without a server.
 */

export type PublicRouteDecision =
  { kind: "pass" } | { kind: "rewrite"; to: string } | { kind: "redirect"; to: string }

/** The prefix that marks a public URL. No workspace slug can begin with it. */
const PUBLIC_PREFIX = "@"

/**
 * Path characters a handle or slug may contain by the time it reaches here.
 *
 * Anything else — an encoded slash, a traversal, a control character — means
 * the request is not for a page Fanwise serves, and it is passed through to
 * the ordinary 404 rather than reshaped into an internal path. Building a
 * rewrite target out of unvalidated segments is how a rewrite becomes a way to
 * reach something that was never meant to be addressable.
 */
const SEGMENT = /^[A-Za-z0-9._~-]+$/

/**
 * The two segments that are path syntax rather than names.
 *
 * `.` and `.` twice both satisfy SEGMENT — a dot is a legal character in a
 * segment — and both mean something to a path resolver. Left in, `/@a/../b`
 * assembles into the rewrite target `/profile/a/../b`. Next normalises that
 * before routing today, so nothing visibly breaks, which is exactly why this
 * is worth refusing here: the safety of the rewrite target should not be a
 * property of whoever consumes it. Found by a test, not by inspection.
 */
const TRAVERSAL = new Set([".", ".."])

/**
 * Decides what to do with one pathname.
 *
 * Order matters: the internal prefix is checked first, so a request for
 * `/profile/x` is bounced to `/@x` and never rewritten onto itself.
 */
export function resolvePublicRoute(pathname: string): PublicRouteDecision {
  if (isInternalPath(pathname)) {
    const rest = pathname.slice(PUBLIC_INTERNAL_PREFIX.length).replace(/^\/+/, "")
    // `/profile` with nothing after it is not an address at all. Sending it to
    // the marketing root is friendlier than a 404 and, more to the point, is
    // not a redirect to `/@`, which would be.
    if (rest.length === 0) return { kind: "redirect", to: "/" }
    return { kind: "redirect", to: `/${PUBLIC_PREFIX}${rest}` }
  }

  if (!pathname.startsWith(`/${PUBLIC_PREFIX}`)) return { kind: "pass" }

  // "/@" alone, or "/@/…": no handle, so nothing to resolve. Passed through to
  // the ordinary not-found rather than rewritten to a path with a hole in it.
  const withoutPrefix = pathname.slice(2)
  if (withoutPrefix.length === 0 || withoutPrefix.startsWith("/")) return { kind: "pass" }

  const hadTrailingSlash = pathname.length > 2 && pathname.endsWith("/")
  const segments = withoutPrefix.replace(/\/+$/, "").split("/")

  if (segments.some((segment) => !SEGMENT.test(segment) || TRAVERSAL.has(segment))) {
    return { kind: "pass" }
  }

  // Lowercase is the canonical form of every public address, so `/@Northline`
  // is not a second page: it is a permanent redirect to the one page. The same
  // applies to a trailing slash, which is why it is noted above rather than
  // just trimmed.
  const canonical = segments.map((segment) => segment.toLowerCase())
  const isCanonical = !hadTrailingSlash && canonical.every((s, i) => s === segments[i])

  if (!isCanonical) {
    return { kind: "redirect", to: `/${PUBLIC_PREFIX}${canonical.join("/")}` }
  }

  return { kind: "rewrite", to: [PUBLIC_INTERNAL_PREFIX, ...canonical].join("/") }
}

export function isInternalPath(pathname: string): boolean {
  return pathname === PUBLIC_INTERNAL_PREFIX || pathname.startsWith(`${PUBLIC_INTERNAL_PREFIX}/`)
}

/** True for an address the public web serves, which needs no session. */
export function isPublicWebPath(pathname: string): boolean {
  return pathname.startsWith(`/${PUBLIC_PREFIX}`) || isInternalPath(pathname)
}
