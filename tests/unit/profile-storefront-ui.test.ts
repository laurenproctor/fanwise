import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ProfilePresentation } from "@/lib/public/profile-presentation"

/**
 * The storefront pieces of the profile, rendered to markup: the links editor,
 * the location fields and their combobox, the richer public profile in its
 * empty, partial and full states, and the image's fallbacks.
 *
 * Static markup decides structure, names and states. Typing, arrow keys and
 * focus moving are browser behaviour; the rules behind them are pure and are
 * tested in profile-builder-model.test.ts and profile-location.test.ts, and
 * the path through a real browser is journey 14.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/",
}))

const { LinksEditor } = await import("@/app/[slug]/profile/builder/links-editor")
const { LocationFields } = await import("@/app/[slug]/profile/builder/location-fields")
const { Combobox } = await import("@/components/ui/combobox")
const { PublicProfile } = await import("@/components/public/public-profile")
const { ProfileAvatar } = await import("@/components/public/profile-avatar")
const { PublicAvatar } = await import("@/components/public/public-image")

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element)
const textOf = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&rsquo;/g, "’")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
const noop = () => {}

// ---------------------------------------------------------------------------

describe("the links editor", () => {
  const editor = (initial: Array<{ url: string; label: string }>) =>
    render(
      createElement(LinksEditor, {
        initial,
        serverIssues: [],
        showAllErrors: false,
        onChange: noop,
      }),
    )

  const three = [
    { url: "laurenproctor.com", label: "" },
    { url: "instagram.com/laurenproctor", label: "" },
    { url: "are.na/lauren", label: "Research" },
  ]

  it("is a labelled group of rows, each with a labelled address and optional label", () => {
    const markup = editor(three)
    expect(markup).toMatch(/<fieldset[^>]*>\s*<legend[^>]*>Links \(optional\)<\/legend>/)
    const inputs = [...markup.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map((m) => m[1]!)
    expect(inputs).toHaveLength(6)
    for (const id of inputs) expect(markup).toContain(`for="${id}"`)
    expect(textOf(markup)).toContain("Label (optional)")
  })

  it("draws the platform's glyph for a platform and a globe for a site it does not know", () => {
    const markup = editor(three)
    const glyphs = [...markup.matchAll(/data-glyph="([^"]+)"/g)].map((m) => m[1])
    expect(glyphs).toEqual(["website", "instagram", "website"])
  })

  it("offers reordering and removal as named buttons, never only a drag", () => {
    const markup = editor(three)
    const buttons = [...markup.matchAll(/<button[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => tag.includes("aria-label="))
      .map((tag) => ({
        label: /aria-label="([^"]+)"/.exec(tag)![1],
        disabled: tag.includes('disabled=""'),
      }))
    expect(buttons).toEqual([
      { label: "Move link 1 up", disabled: true },
      { label: "Move link 1 down", disabled: false },
      { label: "Remove link 1", disabled: false },
      { label: "Move link 2 up", disabled: false },
      { label: "Move link 2 down", disabled: false },
      { label: "Remove link 2", disabled: false },
      { label: "Move link 3 up", disabled: false },
      { label: "Move link 3 down", disabled: true },
      { label: "Remove link 3", disabled: false },
    ])
    // Every move is announced for a screen reader.
    expect(markup).toMatch(/aria-live="polite"/)
  })

  it("adds links up to eight, and says how many are in use", () => {
    expect(editor([])).toMatch(/<button[^>]*type="button"[^>]*>[\s\S]*?Add link<\/button>/)
    expect(textOf(editor([]))).toContain("0 of 8")
    const eight = Array.from({ length: 8 }, (_, i) => ({ url: `s${i}.example.com`, label: "" }))
    const full = editor(eight)
    expect(full).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Add link<\/button>/)
    expect(textOf(full)).toContain("8 of 8")
  })

  it("shows a server's problem against its own row, in words", () => {
    const markup = render(
      createElement(LinksEditor, {
        initial: [
          { url: "studio.com", label: "" },
          { url: "javascript:alert(1)", label: "" },
        ],
        serverIssues: [{ index: 1, field: "url", message: "Use a web address, like studio.com." }],
        showAllErrors: true,
        onChange: noop,
      }),
    )
    expect(textOf(markup)).toContain("Use a web address, like studio.com.")
    expect(markup.match(/aria-invalid="true"/g)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------

describe("the combobox", () => {
  const box = (props: Partial<Parameters<typeof Combobox>[0]> = {}) =>
    render(
      createElement(Combobox, {
        id: "country",
        label: "Country",
        noun: "country",
        selected: null,
        options: [{ value: "US", label: "United States" }],
        emptyMessage: "No country matches that.",
        onSelect: noop,
        ...props,
      }),
    )

  it("uses combobox semantics: a labelled input that controls a listbox", () => {
    const markup = box()
    const input = /<input[^>]*>/.exec(markup)![0]
    expect(input).toContain('role="combobox"')
    expect(input).toContain('aria-autocomplete="list"')
    expect(input).toContain('aria-expanded="false"')
    const controls = /aria-controls="([^"]+)"/.exec(input)![1]
    expect(markup).toMatch(new RegExp(`<ul[^>]*id="${controls}"[^>]*role="listbox"`))
    expect(markup).toContain('for="country"')
    // Closed until asked: the list is hidden, not merely empty.
    expect(markup).toMatch(/<ul[^>]*hidden=""/)
  })

  it("shows the chosen value's label, and a named way to clear it", () => {
    const markup = box({ selected: { value: "US", label: "United States" } })
    expect(markup).toContain('value="United States"')
    expect(markup).toMatch(/<button[^>]*aria-label="Clear country"/)
    expect(box()).not.toContain("Clear country")
  })

  it("carries an error to assistive technology", () => {
    const markup = box({ error: "Choose a country from the list." })
    expect(markup).toContain('aria-invalid="true"')
    const describedBy = /aria-describedby="([^"]+)"/.exec(markup)![1]!
    expect(markup).toContain(`id="${describedBy}"`)
    expect(textOf(markup)).toContain("Choose a country from the list.")
  })
})

describe("the location fields", () => {
  const fields = (props: Partial<Parameters<typeof LocationFields>[0]> = {}) =>
    render(
      createElement(LocationFields, {
        workspaceSlug: "studio",
        countryId: "country",
        cityId: "city",
        countryCode: "",
        city: "",
        legacyLocation: "",
        errors: {},
        onChange: noop,
        onRemoveLegacy: noop,
        ...props,
      }),
    )

  it("keeps the city disabled until there is a country", () => {
    expect(/<input[^>]*id="city"[^>]*>/.exec(fields())![0]).toContain('disabled=""')
    const chosen = fields({ countryCode: "US" })
    expect(/<input[^>]*id="city"[^>]*>/.exec(chosen)![0]).not.toContain('disabled=""')
    expect(chosen).toContain('value="United States"')
  })

  it("shows a saved city and country as their labels", () => {
    const markup = fields({ countryCode: "US", city: "Brooklyn" })
    expect(markup).toContain('value="Brooklyn"')
    expect(markup).toContain('value="United States"')
  })

  it("keeps a legacy free-text location visible, with a way to remove or replace it", () => {
    const markup = fields({ legacyLocation: "Brooklyn, New York" })
    expect(textOf(markup)).toContain("Your profile shows “Brooklyn, New York”")
    expect(textOf(markup)).toContain("Remove this location")
    // Once a country is chosen the old text is being replaced, so the notice goes.
    expect(
      textOf(fields({ legacyLocation: "Brooklyn, New York", countryCode: "US" })),
    ).not.toContain("Your profile shows")
  })
})

// ---------------------------------------------------------------------------

const FULL: ProfilePresentation = {
  handle: "northline",
  displayName: "Northline Studio",
  shortBio: "Independent type for expressive brands.",
  about: "A two-person foundry.\nWe draw display faces.",
  avatarUrl: "/api/public/avatar/p?v=1",
  initials: "NS",
  location: "Brooklyn, United States",
  links: [
    { kind: "website", url: "https://northline.example/", label: "northline.example" },
    { kind: "instagram", url: "https://www.instagram.com/northline/", label: "Instagram" },
  ],
  contact: { url: "mailto:hello@northline.example", label: "hello@northline.example" },
  products: [
    {
      key: "aster",
      title: "Aster Grotesk",
      productType: "font",
      typeLabel: "Font",
      imageUrl: "/api/public/asset/a1",
      imageAlt: "Aster Grotesk",
      href: "/@northline/aster",
      summary: "A grotesk in nine weights.",
      startingPrice: { amount: 49, currency: "USD" },
      channelCount: 2,
    },
    {
      key: "kit",
      title: "Campaign Kit",
      productType: "template",
      typeLabel: "Template",
      imageUrl: null,
      imageAlt: "Campaign Kit",
      href: "/@northline/kit",
    },
  ],
  specialties: [
    { type: "font", label: "Fonts" },
    { type: "template", label: "Templates" },
  ],
}

const EMPTY: ProfilePresentation = {
  handle: "blank",
  displayName: "Blank Studio",
  shortBio: null,
  about: null,
  avatarUrl: null,
  initials: "BS",
  location: null,
  links: [],
  contact: null,
  products: [],
  specialties: [],
}

const profile = (
  p: ProfilePresentation,
  layout: "responsive" | "mobile" | "desktop" = "responsive",
) => render(createElement(PublicProfile, { profile: p, layout, nameAs: "h1" }))

describe("the public profile", () => {
  it("in full: identity, location near the name, links, products, and About", () => {
    const markup = profile(FULL)
    const text = textOf(markup)
    expect(markup).toMatch(/<h1[^>]*>Northline Studio<\/h1>/)
    // Location sits between the name and the introduction.
    expect(text.indexOf("Northline Studio")).toBeLessThan(text.indexOf("Brooklyn, United States"))
    expect(text.indexOf("Brooklyn, United States")).toBeLessThan(text.indexOf("Independent type"))
    expect(markup).toMatch(/<h2[^>]*>Products<\/h2>/)
    expect(markup).toMatch(/<h2[^>]*>About/)
    expect(text).toContain("2 products")
    expect(text).toContain("Font · From $49")
    expect(text).toContain("A grotesk in nine weights.")
    expect(text).toContain("Available on 2 channels")
    expect(text).toContain("Makes")
    expect(text).toContain("Based in")
    expect(text).toContain("Elsewhere")
    expect(markup).toContain('href="/@northline/aster"')
  })

  it("keeps heading order when it is a preview inside another page", () => {
    const markup = render(
      createElement(PublicProfile, { profile: FULL, layout: "desktop", nameAs: "h3" }),
    )
    expect(markup).toMatch(/<h3[^>]*>Northline Studio<\/h3>/)
    expect(markup).toMatch(/<h4[^>]*>Products<\/h4>/)
    expect(markup).not.toMatch(/<h2/)
  })

  it("empty: the name, an honest empty product state, and no empty About", () => {
    const markup = profile(EMPTY)
    const text = textOf(markup)
    expect(text).toContain("No products to show yet.")
    expect(markup).not.toContain('id="profile-about"')
    expect(markup).not.toContain("data-location")
    expect(markup).not.toContain("data-contact")
    // No placeholder words on the public page.
    expect(text).not.toContain("appears here")
  })

  it("partial: shows what was filled in and nothing for what was not", () => {
    const markup = profile({ ...EMPTY, location: "Japan", links: FULL.links })
    expect(textOf(markup)).toContain("Japan")
    expect(markup).not.toMatch(/, Japan|Japan,/)
    expect(markup).toContain('id="profile-about"')
    expect(textOf(markup)).not.toContain("Makes")
  })

  it("draws a product with no image as a deliberate panel, not a broken image", () => {
    const markup = profile(FULL)
    expect(markup).toContain("data-missing-image")
    expect(markup.match(/<img/g)?.length).toBe(2) // the avatar and the one real cover
  })

  it("names what the studio makes in the plural, each a link to that kind", () => {
    const markup = profile(FULL)
    const text = textOf(markup)
    expect(text).toContain("Makes Fonts Templates")
    expect(markup).toContain('href="?type=font#profile-products"')
    expect(markup).toContain('href="?type=template#profile-products"')
  })

  it("filters by kind once there are two kinds, and searches once there are enough products", () => {
    const two = profile(FULL)
    expect(two).toMatch(/aria-pressed="true"[^>]*>All/)
    expect(textOf(two)).toContain("Fonts 1")
    // Two products: nothing to search through yet.
    expect(two).not.toContain('placeholder="Search products"')

    const many = profile({
      ...FULL,
      products: [
        ...FULL.products,
        { ...FULL.products[0]!, key: "b", title: "Birch Serif" },
        { ...FULL.products[0]!, key: "c", title: "Cedar Mono" },
      ],
    })
    expect(many).toContain('placeholder="Search products"')
    expect(many).toContain("Price: low to high")
  })

  it("opens on the view the address asks for", () => {
    const markup = render(
      createElement(PublicProfile, {
        profile: FULL,
        layout: "responsive",
        browse: { query: "", type: "template", sort: "featured" },
      }),
    )
    const text = textOf(markup)
    expect(text).toContain("Campaign Kit")
    expect(text).not.toContain("Aster Grotesk")
    expect(text).toContain("Showing 1 of 2 products.")
  })

  it("draws the controls in a preview but keeps them out of the tab order", () => {
    const markup = render(
      createElement(PublicProfile, { profile: FULL, layout: "desktop", interactive: false }),
    )
    expect(markup).toMatch(/role="search"[^>]*inert/)
    // And the Makes chips are words, not links, inside the builder.
    expect(markup).not.toContain("?type=font")
  })

  it("lays out for a phone as well as a desktop", () => {
    expect(profile(FULL, "mobile")).toContain('data-layout="mobile"')
    expect(profile(FULL, "mobile")).toMatch(/class="grid [^"]*grid-cols-1/)
    expect(profile(FULL)).toMatch(/sm:grid-cols-2 lg:grid-cols-3/)
  })
})

describe("the profile image", () => {
  it("is a fixed square with a centred crop, so the page does not move while it loads", () => {
    const markup = render(createElement(ProfileAvatar, { src: "/a.png", initials: "NS", size: 96 }))
    expect(markup).toContain('width="96"')
    expect(markup).toContain('height="96"')
    expect(markup).toContain("aspect-square")
    expect(markup).toContain("object-cover")
  })

  it("falls back to initials when there is no image", () => {
    const markup = render(createElement(ProfileAvatar, { src: null, initials: "NS", size: 96 }))
    expect(markup).not.toContain("<img")
    expect(markup).toContain('data-avatar="initials"')
    expect(textOf(markup)).toBe("NS")
  })

  it("replaces an image that fails to load with the initials, never a broken frame", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "components", "public", "profile-avatar.tsx"),
      "utf8",
    )
    expect(source).toMatch(/onError=\{\(\) => setFailed\(src\)\}/)
  })

  it("is versioned on the product page, so a replaced picture is not served from cache", () => {
    const markup = render(
      createElement(PublicAvatar, {
        profileId: "p1",
        displayName: "Northline Studio",
        initials: "NS",
        hasAvatar: true,
        version: "2026-09-13T20:00:00Z",
      }),
    )
    expect(markup).toContain('src="/api/public/avatar/p1?v=2026-09-13T20%3A00%3A00Z"')
  })

  it("takes a file chosen before the builder hydrated instead of losing it", () => {
    // The field is server-rendered and clickable before hydration; a change
    // event fired then never reaches React. Journey 14 exercises it in a browser.
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "app",
        "[slug]",
        "profile",
        "builder",
        "profile-details-step.tsx",
      ),
      "utf8",
    )
    expect(source).toMatch(
      /const early = fileInput\.current\?\.files\?\.\[0\]\s+if \(early\) onPickImage\(early\)/,
    )
    // And the step is never submitted ahead of its image.
    expect(source).toMatch(/disabled=\{continuing \|\| uploading\}/)
  })
})
