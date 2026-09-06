import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { PUBLIC_PATHS, isPublic } from "@/proxy"
import { marketingRoutes } from "@/lib/routes"
import { RESERVED_WORKSPACE_SLUGS } from "@/lib/slug"

const ROOT = join(__dirname, "..", "..")

/** The marketing pages. `/`, `/sign-in` and `/sign-up` belong to the app. */
const APP_OWNED = ["/", "/sign-in", "/sign-up"]

const PAGES = Object.entries(marketingRoutes).filter(([, path]) => !APP_OWNED.includes(path))

describe("the marketing site is reachable", () => {
  it("has a page file behind every route it advertises", () => {
    // A nav link to a route with no page is a 404 in the header of every page,
    // and nothing else in the suite renders the marketing nav.
    const missing = PAGES.filter(
      ([, path]) => !existsSync(join(ROOT, "app", "(marketing)", path.slice(1), "page.tsx")),
    ).map(([name]) => name)

    expect(missing).toEqual([])
  })

  it("is public, so a signed-out visitor sees it instead of the sign-in page", () => {
    // The whole point of a marketing site is that nobody has an account yet.
    // Left off the proxy's list, every page below silently bounces to /sign-in
    // and the site is invisible to exactly the people it is written for.
    for (const [name, path] of [...PAGES, ["landing", marketingRoutes.landing] as const]) {
      expect(isPublic(path), `${name} (${path}) is not public`).toBe(true)
    }
  })

  it("reserves every marketing segment against a workspace slug", () => {
    // tests/unit/routes.test.ts proves this from the route tree. This proves it
    // from the routes the site links to, which is the other direction: a page
    // that exists but is unreachable fails there, a link that resolves to
    // somebody's workspace fails here.
    for (const [name, path] of PAGES) {
      const segment = path.slice(1)
      expect(RESERVED_WORKSPACE_SLUGS.has(segment), `${name} (${segment})`).toBe(true)
    }
  })

  it("sends /start to the real account form rather than a second one", () => {
    // The handoff's own signup page collected four fields and submitted to
    // nothing. The route survives as a redirect so a link written against the
    // published mockups still arrives somewhere real; if it ever grows a form
    // again, that form has to be the one that creates an account.
    const source = readFileSync(join(ROOT, "app", "(marketing)", "start", "page.tsx"), "utf8")

    expect(source).toContain("redirect(marketingRoutes.signUp)")
    expect(source).not.toMatch(/<form|<input/)
  })

  it("keeps the root public without opening the workspace routes", () => {
    // "/" is on the list because the landing page lives there. The prefix match
    // that makes `/auth` cover `/auth/confirm` must not make `/` cover
    // everything, which would turn the whole app public in one line.
    expect(isPublic("/")).toBe(true)
    expect(PUBLIC_PATHS).toContain("/")
    expect(isPublic("/best-night")).toBe(false)
    expect(isPublic("/best-night/facette-typeface")).toBe(false)
    expect(isPublic("/onboarding")).toBe(false)
  })
})
