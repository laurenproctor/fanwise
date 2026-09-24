import { describe, expect, it } from "vitest"
import type { PresentationProduct } from "@/lib/public/profile-presentation"
import {
  DEFAULT_BROWSE,
  browseProducts,
  browseSearch,
  parseBrowse,
  typeCounts,
} from "@/lib/public/product-browse"
import { isLikelyBot, viewReferrerHost, viewedKey } from "@/lib/public/page-views"
import { parsePeriod, percentChange, profileAnalyticsSchema } from "@/lib/public/analytics"
import { PRODUCT_TYPES, PRODUCT_TYPE_PLURALS } from "@/lib/products/types"
import { PRODUCT_TYPE_FILTER_LABELS } from "@/lib/public/directory"

/**
 * The rules behind a public profile's search, filter and sort, and behind the
 * visitor numbers on the Profile page. The rendering is in
 * profile-storefront-ui.test.ts; the table and its function are in
 * tests/db/page-views.test.ts.
 */

function product(overrides: Partial<PresentationProduct> & { key: string }): PresentationProduct {
  return {
    title: overrides.key,
    productType: "font",
    typeLabel: "Font",
    imageUrl: null,
    imageAlt: "",
    ...overrides,
  }
}

const CATALOG: PresentationProduct[] = [
  product({
    key: "aster",
    title: "Aster Grotesk",
    startingPrice: { amount: 49, currency: "USD" },
    publishedAt: "2026-09-01T00:00:00Z",
    summary: "A grotesk in nine weights.",
  }),
  product({
    key: "kit",
    title: "Campaign Kit",
    productType: "template",
    typeLabel: "Template",
    startingPrice: { amount: 19, currency: "USD" },
    publishedAt: "2026-09-10T00:00:00Z",
  }),
  product({ key: "cafe", title: "Café Display", publishedAt: "2026-09-05T00:00:00Z" }),
  product({
    key: "birch",
    title: "Birch Serif",
    startingPrice: { amount: 89, currency: "USD" },
  }),
]

const keys = (products: PresentationProduct[]) => products.map((p) => p.key)
const run = (change: Partial<typeof DEFAULT_BROWSE>) =>
  keys(browseProducts(CATALOG, { ...DEFAULT_BROWSE, ...change }))

describe("plural product type labels", () => {
  it("has one for every product type", () => {
    for (const type of PRODUCT_TYPES) expect(PRODUCT_TYPE_PLURALS[type]).toBeTruthy()
    expect(PRODUCT_TYPE_PLURALS.font).toBe("Fonts")
    expect(PRODUCT_TYPE_PLURALS.brush).toBe("Brushes")
  })

  it("is the same list the creator directory filters with", () => {
    expect(PRODUCT_TYPE_FILTER_LABELS).toBe(PRODUCT_TYPE_PLURALS)
  })
})

describe("browsing a profile's products", () => {
  it("keeps the creator's order by default", () => {
    expect(run({})).toEqual(["aster", "kit", "cafe", "birch"])
  })

  it("filters by kind", () => {
    expect(run({ type: "template" })).toEqual(["kit"])
  })

  it("shows everything for a kind the page does not have, rather than nothing", () => {
    expect(run({ type: "photo" })).toEqual(["aster", "kit", "cafe", "birch"])
  })

  it("searches every word, in any order, across name, kind and description, ignoring accents", () => {
    expect(run({ query: "cafe" })).toEqual(["cafe"])
    expect(run({ query: "nine grotesk" })).toEqual(["aster"])
    expect(run({ query: "templates" })).toEqual(["kit"])
    expect(run({ query: "fonts serif" })).toEqual(["birch"])
    expect(run({ query: "nothing like this" })).toEqual([])
  })

  it("sorts by price with unknown prices last in both directions", () => {
    expect(run({ sort: "price-asc" })).toEqual(["kit", "aster", "birch", "cafe"])
    expect(run({ sort: "price-desc" })).toEqual(["birch", "aster", "kit", "cafe"])
  })

  it("sorts by newest and by name", () => {
    expect(run({ sort: "newest" })).toEqual(["kit", "cafe", "aster", "birch"])
    expect(run({ sort: "name" })).toEqual(["aster", "birch", "cafe", "kit"])
  })

  it("counts kinds in the order they first appear", () => {
    expect(typeCounts(CATALOG)).toEqual([
      { type: "font", label: "Fonts", count: 3 },
      { type: "template", label: "Templates", count: 1 },
    ])
  })
})

describe("the browse address", () => {
  it("round-trips, and the default is no query string at all", () => {
    expect(browseSearch(DEFAULT_BROWSE)).toBe("")
    const state = { query: "serif", type: "font", sort: "price-asc" as const }
    const params = Object.fromEntries(new URLSearchParams(browseSearch(state)))
    expect(parseBrowse(params)).toEqual(state)
  })

  it("falls back to the default for anything a stranger could type", () => {
    expect(parseBrowse({ type: "<script>", sort: "cheapest" })).toEqual(DEFAULT_BROWSE)
    expect(parseBrowse({ q: ["a", "b"] }).query).toBe("a")
    expect(parseBrowse({ q: "x".repeat(500) }).query).toHaveLength(100)
  })
})

describe("what counts as a view", () => {
  it("leaves out crawlers, unfurlers, headless browsers and an empty user agent", () => {
    expect(isLikelyBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true)
    expect(isLikelyBot("facebookexternalhit/1.1")).toBe(true)
    expect(isLikelyBot("Mozilla/5.0 HeadlessChrome/120")).toBe(true)
    expect(isLikelyBot("")).toBe(true)
    expect(isLikelyBot(null)).toBe(true)
    expect(
      isLikelyBot(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      ),
    ).toBe(false)
  })

  it("keeps only the host of a referrer, and none for a move between Fanwise pages", () => {
    expect(viewReferrerHost("https://www.instagram.com/p/abc?x=1", "fanwise.app")).toBe(
      "instagram.com",
    )
    expect(viewReferrerHost("https://fanwise.app/@studio", "fanwise.app")).toBeNull()
    expect(viewReferrerHost("https://www.fanwise.app/@studio", "fanwise.app")).toBeNull()
    expect(viewReferrerHost("http://localhost:3000/@studio", "localhost:3000")).toBeNull()
    expect(viewReferrerHost("not a url", "fanwise.app")).toBeNull()
    expect(viewReferrerHost(undefined, "fanwise.app")).toBeNull()
  })

  it("remembers a page per tab by profile and page, never by visitor", () => {
    expect(viewedKey("p1", null)).toBe("fanwise:viewed:p1:profile")
    expect(viewedKey("p1", "g1")).toBe("fanwise:viewed:p1:g1")
  })
})

describe("the visitor numbers", () => {
  it("offers three periods and defaults to thirty days", () => {
    expect(parsePeriod("7")).toBe(7)
    expect(parsePeriod("90")).toBe(90)
    expect(parsePeriod("365")).toBe(30)
    expect(parsePeriod(undefined)).toBe(30)
  })

  it("says nothing about change when there was nothing before", () => {
    expect(percentChange(10, 0)).toBeNull()
    expect(percentChange(15, 10)).toBe(50)
    expect(percentChange(5, 10)).toBe(-50)
  })

  it("validates the function's answer before drawing it", () => {
    const valid = {
      days: 7,
      since: "2026-09-17T00:00:00+00:00",
      profileViews: 3,
      productViews: 2,
      outboundClicks: 1,
      previousProfileViews: 0,
      previousProductViews: 0,
      previousOutboundClicks: 0,
      daily: [{ day: "2026-09-17", profileViews: 3, productViews: 2 }],
      products: [{ slug: "aster", title: "Aster", views: 2, clicks: 1 }],
      referrers: [{ host: null, views: 5 }],
      channels: [{ name: "Etsy", clicks: 1 }],
    }
    expect(profileAnalyticsSchema.safeParse(valid).success).toBe(true)
    expect(profileAnalyticsSchema.safeParse({ ...valid, profileViews: -1 }).success).toBe(false)
  })
})
