import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CreatorUnit } from "@/components/public/directory/creator-unit"
import { PUBLIC_NAV, SiteNav } from "@/components/marketing/site-nav"
import { countryName } from "@/lib/location/countries"
import {
  DEFAULT_DIRECTORY_STATE,
  activeFilters,
  directoryHref,
  isFiltered,
  parseDirectoryState,
  profileLinkLabel,
  searchTokens,
  withChange,
  type DirectoryState,
} from "@/lib/public/directory"
import {
  countryCodesForWord,
  searchClause,
  type DirectoryCreator,
} from "@/lib/public/directory-queries"
import { marketingRoutes, publicRoutes } from "@/lib/routes"

/**
 * The creator directory's rules that do not need a database: what its URL
 * means, what a search word may become, the words on a card, and the shape of
 * a card's links. Visibility is tests/db/creator-directory.test.ts.
 */

const state = (change: Partial<DirectoryState> = {}): DirectoryState => ({
  ...DEFAULT_DIRECTORY_STATE,
  ...change,
})

describe("the directory's URL is its state", () => {
  it("reads the plain directory as the defaults", () => {
    expect(parseDirectoryState({})).toEqual(DEFAULT_DIRECTORY_STATE)
    expect(directoryHref(DEFAULT_DIRECTORY_STATE)).toBe("/creators")
  })

  it("round-trips every parameter through its address", () => {
    const full = state({
      q: "brand systems",
      productType: "font",
      country: "US",
      city: "New York",
      sort: "name",
      page: 3,
    })
    const href = directoryHref(full)
    expect(href).toBe(
      "/creators?q=brand+systems&productType=font&country=US&city=New+York&sort=name&page=3",
    )
    expect(parseDirectoryState(new URL(href, "https://x.test").searchParams)).toEqual(full)
  })

  it("falls back to defaults for anything it does not recognise, rather than failing", () => {
    expect(
      parseDirectoryState({
        productType: "typefaces",
        country: "Narnia",
        sort: "popular",
        page: "-2",
      }),
    ).toEqual(DEFAULT_DIRECTORY_STATE)
    expect(parseDirectoryState({ page: "999999999" }).page).toBe(10_000)
    expect(parseDirectoryState({ country: "us" }).country).toBe("US")
  })

  it("drops a city that has no country", () => {
    expect(parseDirectoryState({ city: "Paris" }).city).toBeNull()
  })

  it("treats search and filters as filters, and sort and page as neither", () => {
    expect(isFiltered(state({ sort: "recent", page: 4 }))).toBe(false)
    expect(isFiltered(state({ q: "icons" }))).toBe(true)
    expect(isFiltered(state({ productType: "icon" }))).toBe(true)
    expect(isFiltered(state({ country: "CA" }))).toBe(true)
  })

  it("starts from page one when what is being looked for changes, and drops a stale city", () => {
    const current = state({ country: "US", city: "Austin", page: 5, sort: "recent" })
    expect(withChange(current, { productType: "template" })).toMatchObject({
      page: 1,
      city: "Austin",
      sort: "recent",
    })
    expect(withChange(current, { country: "CA" })).toMatchObject({ country: "CA", city: null })
  })
})

describe("active filter chips", () => {
  const current = state({
    q: "grotesk",
    productType: "font",
    country: "US",
    city: "Austin",
    sort: "name",
    page: 2,
  })
  const chips = activeFilters(current, { country: countryName })

  it("names each active filter, and only those", () => {
    expect(chips.map((chip) => chip.label)).toEqual([
      "“grotesk”",
      "Fonts",
      "United States",
      "Austin",
    ])
    expect(activeFilters(state({ sort: "recent" }), { country: countryName })).toEqual([])
  })

  it("removes one filter and keeps every other, and the sort", () => {
    const withoutType = chips.find((chip) => chip.key === "productType")!.href
    expect(withoutType).toBe("/creators?q=grotesk&country=US&city=Austin&sort=name")
  })

  it("takes the city with its country", () => {
    const withoutCountry = chips.find((chip) => chip.key === "country")!.href
    expect(withoutCountry).toBe("/creators?q=grotesk&productType=font&sort=name")
  })
})

describe("search", () => {
  it("reduces a query to words that cannot be filter syntax", () => {
    expect(searchTokens("  Brand,  (systems).*  ")).toEqual(["brand", "systems"])
    expect(searchTokens("a,b)or(id.eq.x")).toEqual(["aborideqx"])
    expect(searchTokens("O’Neil café")).toEqual(["o'neil", "café"])
    expect(searchTokens("one two three four five six seven")).toHaveLength(6)
  })

  it("lets a word match the public text, a product type it names, or a country", () => {
    expect(searchClause("typefaces")).toBe("search_text.ilike.*typefaces*,product_types.cs.{font}")
    expect(searchClause("canada")).toContain("country_code.in.(CA)")
    expect(countryCodesForWord("us")).toEqual([])
    expect(countryCodesForWord("united")).toEqual(expect.arrayContaining(["US", "GB"]))
  })
})

describe("the profile link's words", () => {
  it("uses a first name only where the name reads as a person's", () => {
    expect(profileLinkLabel("Mina Park")).toBe("View Mina’s profile")
    expect(profileLinkLabel("Nia Brooks")).toBe("View Nia’s profile")
    expect(profileLinkLabel("Jules Anne Moreau")).toBe("View Jules’s profile")
  })

  it("says View profile for anything that might be a studio or reads awkwardly", () => {
    for (const name of [
      "Forge",
      "Northline Studio",
      "Field Notes",
      "Layer Club",
      "Atelier Noir",
      "A&B Type",
      "type.co",
      "mina park",
      "KENJI TANAKA",
      "The Four Of Us Here",
      "Studio 22",
    ]) {
      expect(profileLinkLabel(name), name).toBe("View profile")
    }
  })
})

describe("a creator unit", () => {
  const creator: DirectoryCreator = {
    id: "11111111-1111-4111-8111-111111111111",
    handle: "mina-park",
    displayName: "Mina Park",
    shortBio: "Brand systems and templates for ambitious teams.",
    location: "Seoul, South Korea",
    hasAvatar: false,
    updatedAt: "2026-09-13T00:00:00Z",
    productCount: 12,
    primaryTypes: ["Templates", "Graphics"],
    previews: [
      {
        slug: "sora",
        title: "Sora Brand System",
        typeLabel: "Template",
        coverAssetId: "22222222-2222-4222-8222-222222222222",
      },
      { slug: "people-planet", title: "People Planet", typeLabel: "Template", coverAssetId: null },
    ],
  }
  const html = renderToStaticMarkup(createElement(CreatorUnit, { creator, variant: "featured" }))

  it("links each preview to its canonical product page, and the name to the profile", () => {
    expect(html).toContain(`href="${publicRoutes.product("mina-park", "sora")}"`)
    expect(html).toContain(`href="${publicRoutes.product("mina-park", "people-planet")}"`)
    expect(html).toContain(`href="${publicRoutes.profile("mina-park")}"`)
    expect(html).toContain("View Mina’s profile")
  })

  it("never nests a link inside a link", () => {
    const depth = html.split(/(<a\b|<\/a>)/).reduce(
      (acc, part) => {
        if (part === "<a") acc.current += 1
        if (part === "</a>") acc.current -= 1
        acc.max = Math.max(acc.max, acc.current)
        return acc
      },
      { current: 0, max: 0 },
    )
    expect(depth.max).toBe(1)
  })

  it("puts the previews first in the focus order, then the name, then the profile link", () => {
    const order = [...html.matchAll(/<a [^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => !tag.includes('tabindex="-1"'))
      .map((tag) => /data-directory-link="(\w+)"/.exec(tag)?.[1])
    expect(order).toEqual(["product", "product", "profile", "profile"])
  })

  it("describes the artwork and keeps an image-less product labelled", () => {
    expect(html).toContain('alt="Preview of Sora Brand System by Mina Park"')
    expect(html).toContain("Preview of People Planet by Mina Park")
    expect(html).not.toMatch(/\$\d|followers|rating/i)
  })
})

describe("the public navigation", () => {
  it("lists the six destinations in order, with Marketplaces still the channels page", () => {
    expect(PUBLIC_NAV.map((link) => link.label)).toEqual([
      "Product",
      "Creators",
      "Marketplaces",
      "How it works",
      "Pricing",
      "About",
    ])
    expect(PUBLIC_NAV.find((link) => link.key === "marketplaces")?.href).toBe("/marketplaces")
    expect(PUBLIC_NAV.find((link) => link.key === "creators")?.href).toBe(marketingRoutes.creators)
  })

  it("marks only the current page", () => {
    const html = renderToStaticMarkup(createElement(SiteNav, { current: "creators" }))
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="page" href="\/creators"/)
    expect(renderToStaticMarkup(createElement(SiteNav, {}))).not.toContain("aria-current")
  })
})
