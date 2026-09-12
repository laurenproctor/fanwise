import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { resolvePublicRoute, isInternalPath, isPublicWebPath } from "@/lib/public/routing"
import { isPublic, PUBLIC_PATHS } from "@/proxy"
import { PUBLIC_INTERNAL_PREFIX, publicRoutes, routes, marketingRoutes } from "@/lib/routes"
import { RESERVED_WORKSPACE_SLUGS } from "@/lib/slug"
import { RESERVED_HANDLES, RESERVED_PUBLIC_PRODUCT_SLUGS } from "@/lib/public/handles"

/**
 * The routing table, as a table.
 *
 * `/@handle` is the one address in Fanwise that cannot be a folder, so it is
 * decided by a function instead, and a function is something a test can
 * enumerate. Everything here is a pure call: no server, no database, no
 * fixtures. That is deliberate — the failure this file guards against is a
 * public URL quietly resolving to a private route, and a test that needed a
 * running app to notice would not be run often enough to catch it.
 */

const APP = join(__dirname, "..", "..", "app")

describe("the public web resolves to the internal route", () => {
  it("rewrites a profile", () => {
    expect(resolvePublicRoute("/@northline-studio")).toEqual({
      kind: "rewrite",
      to: "/profile/northline-studio",
    })
  })

  it("rewrites a product page", () => {
    expect(resolvePublicRoute("/@northline-studio/aster-grotesk")).toEqual({
      kind: "rewrite",
      to: "/profile/northline-studio/aster-grotesk",
    })
  })

  it("rewrites the reserved collection shape, so it is routed rather than captured", () => {
    // No page answers this yet. What matters now is that it goes to the public
    // tree and 404s there, rather than falling through to app/[slug].
    expect(resolvePublicRoute("/@northline-studio/collections/editorial")).toEqual({
      kind: "rewrite",
      to: "/profile/northline-studio/collections/editorial",
    })
  })

  it("builds the same paths the route helpers advertise", () => {
    const profile = publicRoutes.profile("northline-studio")
    const product = publicRoutes.product("northline-studio", "aster-grotesk")

    expect(resolvePublicRoute(profile).kind).toBe("rewrite")
    expect(resolvePublicRoute(product).kind).toBe("rewrite")
  })
})

describe("canonicalisation", () => {
  it("folds a capitalised handle onto the lowercase one", () => {
    expect(resolvePublicRoute("/@NorthLine-Studio")).toEqual({
      kind: "redirect",
      to: "/@northline-studio",
    })
  })

  it("folds a capitalised product slug too", () => {
    expect(resolvePublicRoute("/@northline/Aster-Grotesk")).toEqual({
      kind: "redirect",
      to: "/@northline/aster-grotesk",
    })
  })

  it("folds a trailing slash", () => {
    expect(resolvePublicRoute("/@northline/")).toEqual({ kind: "redirect", to: "/@northline" })
    expect(resolvePublicRoute("/@northline/aster/")).toEqual({
      kind: "redirect",
      to: "/@northline/aster",
    })
  })

  it("leaves an already-canonical address alone, so there is no redirect loop", () => {
    // The property that matters: whatever a redirect points at must itself
    // resolve to a rewrite, or the browser bounces forever.
    for (const start of ["/@NorthLine", "/@northline/", "/@Northline/Aster/", "/profile/x"]) {
      const first = resolvePublicRoute(start)
      expect(first.kind, start).toBe("redirect")
      const second = resolvePublicRoute((first as { to: string }).to)
      expect(second.kind, `${start} -> ${(first as { to: string }).to}`).not.toBe("redirect")
    }
  })
})

describe("the internal route is not a second address", () => {
  it("redirects a direct hit to the canonical form", () => {
    expect(resolvePublicRoute("/profile/northline-studio")).toEqual({
      kind: "redirect",
      to: "/@northline-studio",
    })
    expect(resolvePublicRoute("/profile/northline-studio/aster")).toEqual({
      kind: "redirect",
      to: "/@northline-studio/aster",
    })
  })

  it("sends the bare internal prefix to the marketing root, not to /@", () => {
    expect(resolvePublicRoute("/profile")).toEqual({ kind: "redirect", to: "/" })
    expect(resolvePublicRoute("/profile/")).toEqual({ kind: "redirect", to: "/" })
  })

  it("is excluded from crawling by robots, which names the same constant", () => {
    expect(PUBLIC_INTERNAL_PREFIX).toBe("/profile")
    expect(isInternalPath("/profile/anything")).toBe(true)
    expect(isInternalPath("/profiles/anything")).toBe(false)
  })
})

describe("nothing else is captured", () => {
  const untouched = [
    "/",
    marketingRoutes.pricing,
    marketingRoutes.howItWorks,
    marketingRoutes.terms,
    marketingRoutes.signIn,
    marketingRoutes.signUp,
    "/api/health",
    "/api/billing/webhook",
    "/api/channels/etsy/oauth/grant",
    "/auth/confirm",
    "/onboarding",
    "/sitemap.xml",
    "/robots.txt",
    "/theme.js",
    // The private application, which shares its first segment with nothing
    // public because no workspace slug may start with "@".
    routes.workspace("best-night"),
    routes.product("best-night", "facette-typeface"),
    routes.channels("best-night"),
    routes.settings("best-night"),
    routes.publicProfileSettings("best-night"),
    routes.assetPreview("best-night", "a1"),
  ]

  it.each(untouched)("passes %s through untouched", (pathname) => {
    expect(resolvePublicRoute(pathname)).toEqual({ kind: "pass" })
  })

  it("passes a workspace slug that merely contains an at sign", () => {
    // Not reachable through the slug format, but the decision should not
    // depend on that being true elsewhere.
    expect(resolvePublicRoute("/best@night").kind).toBe("pass")
  })
})

describe("malformed public addresses are not reshaped into internal paths", () => {
  const rejected = [
    "/@",
    "/@/",
    "/@/aster",
    "/@northline/../../etc/passwd",
    "/@northline/%2e%2e%2fsecret",
    "/@north line",
    "/@northline/aster?x=1/y", // a query cannot reach here, but the slash could
  ]

  it.each(rejected)("passes %s through rather than rewriting it", (pathname) => {
    // Passing through means the ordinary router answers, which for these is a
    // 404. The failure being prevented is a traversal being assembled into a
    // rewrite target.
    const decision = resolvePublicRoute(pathname)
    expect(decision.kind).toBe("pass")
  })

  it("never produces an internal path containing a traversal", () => {
    const probes = ["/@a/../b", "/@a/%2e%2e/b", "/@..", "/@./x", "/@a//b"]
    for (const probe of probes) {
      const decision = resolvePublicRoute(probe)
      if (decision.kind === "rewrite") {
        expect(decision.to, probe).not.toContain("..")
        expect(decision.to, probe).not.toContain("//")
      }
    }
  })
})

describe("the proxy lets the public web through without a session", () => {
  it("treats every public address as public", () => {
    expect(isPublicWebPath("/@northline")).toBe(true)
    expect(isPublicWebPath("/@northline/aster")).toBe(true)
    expect(isPublicWebPath("/profile/northline")).toBe(true)
    expect(isPublicWebPath(routes.workspace("best-night"))).toBe(false)
  })

  it("opens the public media and beacon routes, which a visitor's browser calls", () => {
    expect(PUBLIC_PATHS).toContain("/api/public")
    for (const path of [
      "/api/public/asset/0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30",
      "/api/public/avatar/0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30",
      "/api/public/outbound",
    ]) {
      expect(isPublic(path), path).toBe(true)
    }
  })

  it("does not open anything else under /api", () => {
    for (const path of [
      "/api/channels/etsy/oauth/callback",
      "/api/publicly-not-a-thing",
      "/api/billing/portal",
    ]) {
      expect(isPublic(path), path).toBe(false)
    }
  })

  it("still refuses a private workspace path", () => {
    expect(isPublic(routes.workspace("best-night"))).toBe(false)
    expect(isPublic(routes.settings("best-night"))).toBe(false)
    expect(isPublic(routes.publicProfileSettings("best-night"))).toBe(false)
  })
})

/**
 * The half of the reserved lists that is a routing fact.
 *
 * `tests/unit/routes.test.ts` holds the same line for workspace and product
 * slugs. This is the public namespace's copy of it, and the first assertion is
 * the one that would have caught the mistake: adding `app/profile` without
 * reserving `profile` makes every workspace slugged `profile` insert happily
 * and never open.
 */
describe("the public namespaces are reserved against the routes that exist", () => {
  function topLevelSegments(): string[] {
    const out: string[] = []
    for (const entry of readdirSync(APP)) {
      if (!statSync(join(APP, entry)).isDirectory()) continue
      if (entry.startsWith("[") || entry.startsWith("_")) continue
      if (entry.startsWith("(") && entry.endsWith(")")) {
        for (const child of readdirSync(join(APP, entry))) {
          if (statSync(join(APP, entry, child)).isDirectory()) out.push(child)
        }
        continue
      }
      out.push(entry)
    }
    return out
  }

  it("finds the route tree, so this cannot pass vacuously", () => {
    expect(topLevelSegments().length).toBeGreaterThan(5)
  })

  it("reserves the internal public prefix as a workspace slug", () => {
    // app/profile exists, so a workspace slugged "profile" would be shadowed.
    expect(topLevelSegments()).toContain("profile")
    expect(RESERVED_WORKSPACE_SLUGS.has("profile")).toBe(true)
  })

  it("reserves every top-level route segment as a handle too", () => {
    // A handle lives in its own namespace and cannot collide with a route, so
    // this is not about shadowing. It is about a handle reading as though
    // Fanwise were speaking: /@pricing is not a broken page, it is a
    // misleading one.
    const unreserved = topLevelSegments()
      .filter((segment) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(segment))
      .filter((segment) => !RESERVED_HANDLES.has(segment))

    expect(unreserved).toEqual([])
  })

  it("reserves the collection segment against product slugs", () => {
    // /@handle/collections/<x> is the reserved shape, so a product may not
    // take the word that would shadow it.
    expect(RESERVED_PUBLIC_PRODUCT_SLUGS.has("collections")).toBe(true)
    expect(publicRoutes.collection("h", "x")).toBe("/@h/collections/x")
  })
})
