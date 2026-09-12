import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { PUBLIC_PATHS, isPublic } from "@/proxy"
import { marketingRoutes } from "@/lib/routes"
import { PRICING, estimate } from "@/lib/billing/rules"
import { RAIL } from "@/components/marketing/channels"
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

  it("says the same thing about a shop as the mockup it was built from", () => {
    /*
      design/marketing/ is the source of truth for the visual system, and the
      channel modes are one of the two things in those files that are accurate
      rather than illustrative. So the rail on the page and the rail in the
      mockup have to agree about what Fanwise can do for a shop.

      They stopped agreeing once. Gumroad's product API shipped in April 2026,
      B10 was planned on 11 September 2026, and the commit that moved it from
      assisted to automatic updated the mockup and the feasibility doc and left
      the page saying assisted. Nothing failed, and the public site quietly
      undersold a channel.
    */
    const mockup = readFileSync(join(ROOT, "design", "marketing", "landing.html"), "utf8")

    const drawn = [...mockup.matchAll(/<strong>([^<]+)<\/strong><span><i><\/i>\s*([^<]+)</g)].map(
      (match) => [(match[1] ?? "").trim(), (match[2] ?? "").trim()] as const,
    )

    // If the mockup's markup is reshaped this stops matching, and a test that
    // silently compares nothing is worse than no test.
    expect(drawn.length).toBe(RAIL.length)
    expect(drawn).toEqual(RAIL.map(([name, mode]) => [name, mode]))
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

describe("the prices the marketing site shows", () => {
  /**
   * The pricing calculator and the landing picker are client components that
   * keep their own constants rather than importing the billing model. What a
   * visitor's clicks do with those constants is read in the browser, in
   * marketing.spec.ts; that the constants are the billing model's is here, so
   * the site cannot quietly advertise a price docs/billing.md does not charge.
   */
  function constant(source: string, name: string): number {
    const match = source.match(new RegExp(`const ${name} = (\\d+)`))
    expect(match, `${name} is not declared`).not.toBeNull()
    return Number(match![1])
  }

  it("prices the calculator from the billing model, monthly and annual", () => {
    const source = readFileSync(
      join(ROOT, "components", "marketing", "pricing-calculator.tsx"),
      "utf8",
    )

    expect(constant(source, "BASE_MONTHLY")).toBe(PRICING.month.base)
    expect(constant(source, "EACH_MONTHLY")).toBe(PRICING.month.channel)
    expect(constant(source, "BASE_ANNUAL")).toBe(PRICING.year.base)
    expect(constant(source, "EACH_ANNUAL")).toBe(PRICING.year.channel)
    // The arithmetic itself, and the floor at the included storefront.
    expect(source).toContain("const total = base + each * count")
    expect(estimate("month", 2)).toBe(21)
    expect(estimate("year", 6)).toBe(450)
    expect(estimate("year", 0)).toBe(90)
  })

  it("prices the landing picker from the billing model", () => {
    const source = readFileSync(
      join(ROOT, "components", "marketing", "marketplace-picker.tsx"),
      "utf8",
    )

    expect(constant(source, "BASE")).toBe(PRICING.month.base)
    expect(constant(source, "EACH")).toBe(PRICING.month.channel)
  })
})
