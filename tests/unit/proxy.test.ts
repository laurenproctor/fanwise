import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/*
  The proxy builds its Supabase client inline and asks it for the user. That is
  the one outside call, so it is the one thing replaced: `getUser` answers with
  whoever the test says is signed in, and everything else — the public list, the
  handle routing, the redirect and its status — is the production function.
*/
const session = vi.hoisted(() => ({ user: null as { id: string } | null }))

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: session.user }, error: null }) },
  }),
}))
vi.mock("@/lib/env", () => ({
  clientEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3399",
  }),
}))

import proxy from "@/proxy"
import { routes } from "@/lib/routes"

/**
 * Who the proxy turns away, run as a request rather than read as a list.
 *
 * tests/unit/marketing.test.ts and tests/unit/public-routing.test.ts prove what
 * `isPublic` says about a path. This proves what the proxy then does with a
 * visitor who has no session: several browser tests used to walk a signed-out
 * visitor up to one private route each — the catalog, a workspace, settings,
 * the importer, an import, onboarding — and watch them land on sign in. Every
 * one of those routes is here, along with the public ones that must not bounce.
 *
 * The redirect is a convenience, not authorization: every route re-checks the
 * user server-side, and journey-09-tenancy.spec.ts still sends a stranger to a
 * private workspace through a real browser.
 */

const SLUG = "northbound-type"
const IMPORT_ID = "11111111-1111-4111-8111-111111111111"

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://127.0.0.1:3399"))
}

async function visit(path: string) {
  const response = await proxy(request(path))
  const location = response.headers.get("location")
  return {
    status: response.status,
    location: location ? new URL(location).pathname + new URL(location).search : null,
  }
}

const PRIVATE = [
  ["a workspace, which is its catalog", routes.workspace(SLUG)],
  ["a product", `/${SLUG}/aster-grotesk`],
  ["the new-product form", routes.newProduct(SLUG)],
  ["channels", routes.channels(SLUG)],
  ["settings", routes.settings(SLUG)],
  ["public profile settings", routes.publicProfileSettings(SLUG)],
  ["the importer", routes.importProduct(SLUG)],
  ["somebody's import", `${routes.importProduct(SLUG)}/${IMPORT_ID}`],
  ["onboarding", "/onboarding"],
] as const

const PUBLIC = [
  "/",
  "/pricing",
  "/about",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/api/health",
  "/sitemap.xml",
  "/robots.txt",
] as const

describe("the proxy, for a visitor with no session", () => {
  beforeEach(() => {
    session.user = null
  })

  it.each(PRIVATE)("sends them from %s to sign in, dropping the query", async (_name, path) => {
    const { status, location } = await visit(`${path}?q=anything`)

    expect(status).toBe(307)
    expect(location).toBe("/sign-in")
  })

  it.each(PUBLIC)("lets them reach %s", async (path) => {
    const { status, location } = await visit(path)

    expect(location).toBeNull()
    expect(status).toBe(200)
  })

  it("keeps /reset-password public, so an expired link explains itself", async () => {
    // The browser half is password-recovery.spec.ts. Without this path on the
    // list, a person whose link had expired would land on sign in and be told
    // nothing about why.
    expect(await visit("/reset-password")).toEqual({ status: 200, location: null })
  })

  it("folds a public address onto its canonical form with a permanent redirect", async () => {
    // What each canonicalisation is, is tests/unit/public-routing.test.ts. This
    // is that the proxy answers them before the session check, with a 308.
    //
    // The trailing slash is not here: a running Next server strips it before the
    // proxy is called, and a NextRequest built by hand keeps the flag when the
    // URL is cloned, so this would test the harness. journey-14-public-pages
    // asserts it against the server.
    expect(await visit("/@NorthLine")).toEqual({ status: 308, location: "/@northline" })
    expect(await visit("/profile/northline")).toEqual({ status: 308, location: "/@northline" })
  })

  it("serves a canonical public address to a stranger rather than sending them to sign in", async () => {
    expect(await visit("/@northline")).toEqual({ status: 200, location: null })
    expect(await visit("/@northline/aster-grotesk")).toEqual({ status: 200, location: null })
  })
})

describe("the proxy, for a signed-in creator", () => {
  beforeEach(() => {
    session.user = { id: "00000000-0000-4000-8000-000000000001" }
  })

  it.each(PRIVATE)("lets them through to %s, where the route decides", async (_name, path) => {
    // Whether this creator may see that workspace is not the proxy's to say.
    // The route answers 404 for one that is not theirs; journey 9 proves it.
    expect(await visit(path)).toEqual({ status: 200, location: null })
  })
})
