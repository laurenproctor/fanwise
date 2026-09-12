import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { PublicDestination, PublicProductCard } from "@/lib/public/types"

/**
 * The public pages, rendered to markup.
 *
 * The browser half — a filter being pressed, a share falling back to a
 * selected input, a gallery answering an arrow key — is not decidable from
 * static markup and lives in tests/e2e/journey-14-public-pages.spec.ts. This half
 * is fast and pins the things that are decidable and that matter most on a
 * page strangers read: that an outbound link carries the right `rel`, that a
 * missing price renders as nothing rather than as zero, that an image reserves
 * its box before it loads, and that no private field reaches the markup.
 *
 * The action module is stubbed. It is a "use server" file that reaches for
 * Supabase at import time, and nothing here calls one.
 */

vi.mock("@/lib/public/actions", () => ({
  savePublicProfileAction: vi.fn(),
  setProfilePublishedAction: vi.fn(),
  createPublicProfileAction: vi.fn(),
  savePublicProductPageAction: vi.fn(),
  setProductPagePublishedAction: vi.fn(),
  createPublicProductPageAction: vi.fn(),
}))

const { ProductCard, formatPrice } = await import("@/components/public/product-card")
const { DestinationList, ChooseWhereToBuy } = await import("@/components/public/destination-list")
const { PublicImage, PublicAvatar } = await import("@/components/public/public-image")
const { PublicShell } = await import("@/components/public/public-shell")
const { PublicProfileForm } =
  await import("@/app/[slug]/settings/public-profile/public-profile-form")
const { PublishControls } = await import("@/app/[slug]/settings/public-profile/publish-controls")

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

/** The text a reader sees. Kept as a split-and-join, as the settings suite does. */
function textOf(markup: string): string {
  return markup
    .split(/<[^>]*>/)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

const HANDLE = "northline-studio"

function card(overrides: Partial<PublicProductCard> = {}): PublicProductCard {
  return {
    slug: "aster-grotesk",
    title: "Aster Grotesk",
    productType: "font",
    typeLabel: "Font",
    summary: "A grotesk with a soft shoulder.",
    coverAssetId: "0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30",
    coverAlt: "Aster Grotesk",
    featured: false,
    startingPrice: { amount: 48, currency: "USD" },
    channelCount: 3,
    ...overrides,
  }
}

function destination(overrides: Partial<PublicDestination> = {}): PublicDestination {
  return {
    channelKey: "etsy",
    channelName: "Etsy",
    url: "https://www.etsy.com/listing/4573259073",
    price: 50,
    currency: "USD",
    channelId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  }
}

describe("a product card", () => {
  it("is one link to one destination, not two", () => {
    const markup = render(createElement(ProductCard, { handle: HANDLE, product: card() }))
    const links = [...markup.matchAll(/<a\b/g)]
    expect(links).toHaveLength(1)
    expect(markup).toContain(`href="/@${HANDLE}/aster-grotesk"`)
  })

  it("shows a starting price when there is one", () => {
    const markup = render(createElement(ProductCard, { handle: HANDLE, product: card() }))
    expect(textOf(markup)).toContain("From $48")
  })

  /**
   * The case a marketplace page usually gets wrong. No price is a real state —
   * nothing live, nothing quoted — and rendering it as $0 is a lie a visitor
   * acts on.
   */
  it("shows no price at all rather than zero when none is known", () => {
    const markup = render(
      createElement(ProductCard, { handle: HANDLE, product: card({ startingPrice: null }) }),
    )
    expect(textOf(markup)).not.toContain("$")
    expect(textOf(markup)).not.toContain("From")
  })

  it("omits the channel line rather than saying zero channels", () => {
    const markup = render(
      createElement(ProductCard, { handle: HANDLE, product: card({ channelCount: 0 }) }),
    )
    expect(textOf(markup)).not.toMatch(/0 channels/)
    expect(textOf(markup)).not.toContain("Available on")
  })

  it("says channel in the singular when there is one", () => {
    const markup = render(
      createElement(ProductCard, { handle: HANDLE, product: card({ channelCount: 1 }) }),
    )
    expect(textOf(markup)).toContain("Available on 1 channel")
  })

  it("holds the image's box before it loads, so the grid does not jump", () => {
    const markup = render(createElement(ProductCard, { handle: HANDLE, product: card() }))
    expect(markup).toMatch(/aspect-ratio:\s*4\s*\/\s*3/)
  })

  it("keeps the same box when there is no cover", () => {
    const markup = render(
      createElement(ProductCard, { handle: HANDLE, product: card({ coverAssetId: null }) }),
    )
    expect(markup).toMatch(/aspect-ratio:\s*4\s*\/\s*3/)
    // And says what the product is, rather than showing an empty grey box.
    expect(textOf(markup)).toContain("Font")
  })

  it("gives the cover image the product's name as its alt text", () => {
    const markup = render(createElement(ProductCard, { handle: HANDLE, product: card() }))
    expect(markup).toContain('alt="Aster Grotesk"')
  })
})

describe("formatPrice", () => {
  it("drops the cents on a whole number and keeps them otherwise", () => {
    expect(formatPrice({ amount: 48, currency: "USD" })).toBe("$48")
    expect(formatPrice({ amount: 48.5, currency: "USD" })).toBe("$48.50")
  })

  it("respects the currency the channel quoted", () => {
    expect(formatPrice({ amount: 40, currency: "GBP" })).toBe("£40")
    expect(formatPrice({ amount: 40, currency: "EUR" })).toBe("€40")
  })

  it("keeps the number when the currency code is not one Intl knows", () => {
    expect(formatPrice({ amount: 40, currency: "ZZZ" })).toContain("40")
  })
})

describe("the destination list", () => {
  const markup = render(
    createElement(DestinationList, {
      pageId: "22222222-2222-4222-8222-222222222222",
      destinations: [
        destination(),
        destination({
          channelKey: "shopify",
          channelName: "My Shop",
          url: "https://shop.example/aster",
          price: 48,
          channelId: "33333333-3333-4333-8333-333333333333",
        }),
      ],
      campaign: null,
    }),
  )

  /**
   * The one that matters most. A new tab opened without `noopener` can
   * navigate the page that opened it through `window.opener`, and the pages
   * being opened here are marketplace listings edited by whoever owns the
   * shop.
   */
  it("opens every outbound link with noopener, noreferrer and nofollow", () => {
    const rels = [...markup.matchAll(/<a\b[^>]*\brel="([^"]*)"/g)].map((m) => m[1]!)
    expect(rels.length).toBeGreaterThan(0)
    for (const rel of rels) {
      expect(rel).toContain("noopener")
      expect(rel).toContain("noreferrer")
      expect(rel).toContain("nofollow")
    }
  })

  it("opens them in a new tab, and says so to a screen reader", () => {
    expect(markup).toContain('target="_blank"')
    expect(textOf(markup)).toContain("opens in a new tab")
  })

  it("names the channel in the accessible label, because View alone says nothing", () => {
    expect(textOf(markup)).toContain("View on Etsy")
    expect(textOf(markup)).toContain("View on My Shop")
  })

  it("discloses that terms differ by channel", () => {
    expect(textOf(markup)).toContain("Prices and licenses may vary by channel")
  })

  it("shows each channel's own price", () => {
    expect(textOf(markup)).toContain("$50")
    expect(textOf(markup)).toContain("$48")
  })

  it("says see price rather than inventing one for a channel that quoted none", () => {
    const unpriced = render(
      createElement(DestinationList, {
        pageId: "22222222-2222-4222-8222-222222222222",
        destinations: [destination({ price: null })],
        campaign: null,
      }),
    )
    expect(textOf(unpriced)).toContain("See price")
    expect(textOf(unpriced)).not.toContain("$0")
  })

  it("carries no connection id or internal identifier into the markup", () => {
    // The beacon sends a page id and a channel id, both of which are already
    // public facts about a published page. Nothing else should be here.
    expect(markup).not.toContain("channel_connection")
    expect(markup).not.toContain("workspace")
  })

  it("points the primary action at the list rather than choosing a shop", () => {
    const cta = render(createElement(ChooseWhereToBuy, { count: 3 }))
    expect(cta).toContain('href="#where-to-buy"')
    expect(textOf(cta)).toContain("Choose where to buy")
    expect(markup).toContain('id="where-to-buy"')
  })
})

describe("public images", () => {
  it("go through the media route, never a bucket URL", () => {
    const markup = render(
      createElement(PublicImage, { assetId: "abc", alt: "Aster Grotesk specimen" }),
    )
    expect(markup).toContain('src="/api/public/asset/abc"')
    expect(markup).not.toContain("supabase")
    expect(markup).not.toContain("storage/v1")
  })

  it("reserve their box and load lazily unless they are the priority image", () => {
    const lazy = render(createElement(PublicImage, { assetId: "abc", alt: "x" }))
    expect(lazy).toContain('loading="lazy"')
    expect(lazy).toMatch(/aspect-ratio/)

    const eager = render(createElement(PublicImage, { assetId: "abc", alt: "x", priority: true }))
    expect(eager).toContain('loading="eager"')
  })

  it("fall back to initials rather than a broken frame when there is no avatar", () => {
    const markup = render(
      createElement(PublicAvatar, {
        profileId: "p1",
        displayName: "Northline Studio",
        initials: "NS",
        hasAvatar: false,
      }),
    )
    expect(markup).not.toContain("<img")
    expect(textOf(markup)).toBe("NS")
    // Still announced as the studio, not as two letters.
    expect(markup).toContain('aria-label="Northline Studio"')
  })

  it("use the avatar route when there is one", () => {
    const markup = render(
      createElement(PublicAvatar, {
        profileId: "p1",
        displayName: "Northline Studio",
        initials: "NS",
        hasAvatar: true,
      }),
    )
    expect(markup).toContain('src="/api/public/avatar/p1"')
    expect(markup).toContain('alt="Northline Studio"')
  })
})

describe("the public shell", () => {
  const markup = render(createElement(PublicShell, null, null))

  it("offers a skip link, because a profile can be forty cards deep", () => {
    expect(markup).toContain('href="#main"')
    expect(markup).toContain('id="main"')
  })

  it("links only to pages that exist", () => {
    const hrefs = [...markup.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!)
    const known = new Set([
      "/",
      "/how-it-works",
      "/pricing",
      "/marketplaces",
      "/terms",
      "/privacy",
      "/sign-in",
      "/sign-up",
      "#main",
    ])
    for (const href of hrefs) {
      expect(known.has(href), `${href} is linked but is not a route`).toBe(true)
    }
  })

  it("carries no follower count, rating or other invented metric", () => {
    const text = textOf(markup).toLowerCase()
    for (const word of ["follower", "rating", "review", "★"]) {
      expect(text).not.toContain(word)
    }
  })
})

describe("the public profile settings form", () => {
  const markup = render(
    createElement(PublicProfileForm, {
      workspaceSlug: "northbound-type",
      appOrigin: "https://fanwise.example",
      profile: {
        handle: HANDLE,
        displayName: "Northline Studio",
        shortBio: "",
        location: "",
        websiteUrl: "",
        instagramUrl: "",
        contactUrl: "",
        seoTitle: "",
        seoDescription: "",
      },
      avatarUrl: null,
      hasAvatar: false,
    }),
  )

  it("shows the whole public address around the editable part", () => {
    expect(textOf(markup)).toContain("fanwise.example/@")
    expect(markup).toContain(`value="${HANDLE}"`)
  })

  it("says a rename keeps the old address working, which the workspace slug cannot", () => {
    expect(textOf(markup)).toMatch(/old address keeps working|redirect/i)
  })

  it("carries no account or billing field", () => {
    const names = [...markup.matchAll(/name="([^"]+)"/g)].map((m) => m[1]!)
    for (const forbidden of ["email", "password", "firstName", "lastName", "plan"]) {
      expect(names, `${forbidden} does not belong on the public profile`).not.toContain(forbidden)
    }
  })

  it("starts with the save button disabled, because nothing has changed", () => {
    const save = /<button[^>]*type="submit"[^>]*>/.exec(markup)?.[0] ?? ""
    expect(save).toContain("disabled")
  })
})

describe("the publish controls", () => {
  function controls(status: "draft" | "published") {
    return render(
      createElement(PublishControls, {
        workspaceSlug: "northbound-type",
        handle: HANDLE,
        status,
        appOrigin: "https://fanwise.example",
        publishedCount: 4,
        draftCount: 2,
      }),
    )
  }

  it("says who can see a draft, in as many words", () => {
    expect(textOf(controls("draft"))).toContain("Only you can see this profile")
  })

  it("names the state in words as well as colour", () => {
    expect(textOf(controls("draft"))).toContain("Draft")
    expect(textOf(controls("published"))).toContain("Live")
  })

  /**
   * The consequence a creator does not expect. Unpublishing a profile takes
   * every product page beneath it private, including ones they published
   * individually, and the button has to say so before it is pressed.
   */
  it("warns that unpublishing takes the products with it", () => {
    const text = textOf(controls("published"))
    expect(text).toContain("every product page under it")
    expect(text).toContain("Nothing is deleted")
  })

  it("says that publishing a profile does not publish its products", () => {
    expect(textOf(controls("draft"))).toMatch(/does not publish them|stay private/i)
  })

  it("offers the public link only once there is something to see", () => {
    expect(textOf(controls("published"))).toContain("View public profile")
    expect(textOf(controls("draft"))).not.toContain("View public profile")
  })
})
