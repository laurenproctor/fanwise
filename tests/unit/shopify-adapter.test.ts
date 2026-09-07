import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { readFileSync } from "node:fs"

vi.mock("@/lib/credentials", () => ({
  readConnectionCredentials: vi.fn(async () => ({ accessToken: "shpat-test-token" })),
}))

import { createShopifyClient } from "@/lib/channels/adapters/shopify/client"
import { shopifyAdapter } from "@/lib/channels/adapters/shopify"
import { constraintsFor } from "@/lib/channels/constraints"
import { SCOPES } from "@/lib/channels/adapters/shopify/config"
import { evaluate } from "@/lib/channels/listings"
import { ChannelError } from "@/lib/channels/errors"
import {
  adminProductUrl,
  toDescriptionHtml,
  toMoney,
  toProductType,
  toSeoDescription,
  toSeoTitle,
} from "@/lib/channels/adapters/shopify/transform"
import {
  CATEGORY_LABELS,
  defaultCategoryLabel,
  taxonomyCategoryId,
} from "@/lib/channels/adapters/shopify/categories"
import type { Database } from "@/lib/supabase/database.types"
import type {
  AdapterSubject,
  ChannelConnection,
  ChannelListing,
  PublishContext,
} from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

/**
 * Every member of the product_type enum, listed rather than derived.
 *
 * The enum is a database type with no runtime value to iterate, so the only way
 * to assert "every product type has a category" is to write them out. A member
 * added to the migration and not to this line makes the assertion pass while
 * proving less than it claims, which is why the same list is a compile error in
 * categories.ts: the map there is exhaustive by type, and this checks that what
 * the map produces is something the picker will offer.
 */
const PRODUCT_TYPES: readonly Database["public"]["Enums"]["product_type"][] = [
  "font",
  "template",
  "graphic",
  "photo",
  "illustration",
  "icon",
  "mockup",
  "brush",
  "three_d",
  "theme",
  "other",
]

/**
 * The Shopify adapter.
 *
 * Nothing here reaches a live shop, and docs/channels/shopify.md section 5 is
 * explicit that the mutation shape is unverified against one. What these tests
 * do prove is everything on Fanwise's side of the wire: that a publish creates
 * a draft, that a retry updates rather than creates, that a throttled 200 is
 * treated as the failure it is, and that no provider sentence reaches a creator
 * unnormalized.
 */

const sleep = async () => {}

function listing(overrides: Partial<ChannelListing> = {}): ChannelListing {
  // One cast, at the edge, for a row the test does not need every column of.
  return {
    id: "listing-1",
    workspace_id: "ws-1",
    product_id: "product-1",
    channel_id: "channel-1",
    channel_connection_id: "conn-1",
    external_listing_id: null,
    external_url: null,
    status: "draft",
    status_source: "self_reported",
    title: "Aster Grotesk",
    description: "A grotesque in nine weights.\n\nDrawn for long text.",
    short_description: "Nine weights.",
    price: 48,
    currency: "USD",
    category: "Fonts",
    seo_title: null,
    seo_description: null,
    tags: ["font"],
    metadata: {},
    ...overrides,
  } as unknown as ChannelListing
}

function asset(overrides: Partial<ProductAsset> = {}): ProductAsset {
  return {
    id: "asset-1",
    workspace_id: "ws-1",
    product_id: "product-1",
    asset_type: "cover_image",
    asset_state: "ready",
    storage_path: "ws-1/product-1/asset-1.png",
    filename: "cover.png",
    ...overrides,
  } as unknown as ProductAsset
}

const product = {
  id: "product-1",
  name: "Aster Grotesk",
  slug: "aster-grotesk",
  product_type: "font",
  brand_name: "Aster Type",
  canonical_title: "Aster Grotesk",
  canonical_description: "A grotesque in nine weights.",
  short_description: "Nine weights.",
  base_price: 48,
  currency: "USD",
} as unknown as Product

function subject(overrides: Partial<AdapterSubject> = {}): AdapterSubject {
  return {
    product,
    assets: [asset(), asset({ id: "asset-2", asset_type: "deliverable", filename: "aster.zip" })],
    connectionMetadata: { currencyCode: "USD" },
    ...overrides,
  }
}

function context(overrides: Partial<PublishContext> = {}): PublishContext {
  return {
    listing: listing(),
    connection: {
      id: "conn-1",
      workspace_id: "ws-1",
      external_account_id: "aster-type.myshopify.com",
      metadata: { currencyCode: "USD" },
      // A connection authorized by this build. A shorter list is a connection
      // from before ADR 0004, which is its own case below.
      scopes: [...SCOPES],
    } as unknown as ChannelConnection,
    subject: subject(),
    assetUrl: async () => "https://signed.example/cover.png",
    ...overrides,
  }
}

/** A productSet response, as the client's Zod schema expects it. */
function productSetOk(status: "DRAFT" | "ACTIVE" = "DRAFT") {
  return {
    data: {
      productSet: {
        product: {
          id: "gid://shopify/Product/900",
          legacyResourceId: "900",
          handle: "aster-grotesk",
          status,
          onlineStoreUrl: status === "ACTIVE" ? "https://aster.example/products/aster" : null,
        },
        userErrors: [],
      },
    },
  }
}

/**
 * A productState response: what Shopify currently holds.
 *
 * `nodes: []` is a product with no image. `holds` is the product's own status,
 * which is what an update with the `preserve` intent reads.
 */
function productStateOk(nodes: { id: string; status: string }[] = [], holds = "DRAFT") {
  return { data: { product: { status: holds, media: { nodes } } } }
}

/**
 * Answers whichever operation the adapter actually sent.
 *
 * The adapter reads the product before it writes, so a stub that returns a
 * productSet payload to every request feeds a product-shaped body to the state
 * schema and fails for a reason that has nothing to do with the test.
 */
function respondTo(
  body: unknown,
  options: {
    status?: "DRAFT" | "ACTIVE"
    media?: { id: string; status: string }[]
    /** What Shopify says the product's status currently is. */
    holds?: string
    /** Answer the state read with no product at all, as a deleted id would. */
    missing?: boolean
    /** The shop's sales channels, for the publication lookup. */
    publications?: { id: string; handle: string | null; autoPublish?: boolean }[]
    /** How many publications the product sits on after publishablePublish. */
    publishedTo?: number
  } = {},
): Response {
  const query = String((body as { query?: string }).query ?? "")
  if (query.includes("FanwiseProductState")) {
    if (options.missing) return jsonResponse({ data: { product: null } })
    return jsonResponse(productStateOk(options.media, options.holds))
  }
  if (query.includes("FanwisePublications")) {
    return jsonResponse(publicationsOk(options.publications))
  }
  if (query.includes("FanwisePublishablePublish")) {
    return jsonResponse(publishablePublishOk(options.publishedTo ?? 1))
  }
  return jsonResponse(productSetOk(options.status))
}

/** A publications response: one channel, handled like an Online Store. */
function publicationsOk(
  nodes: { id: string; handle: string | null; autoPublish?: boolean }[] = [
    { id: "gid://shopify/Publication/1", handle: "online_store" },
  ],
) {
  return {
    data: {
      publications: {
        nodes: nodes.map((node) => ({
          id: node.id,
          autoPublish: node.autoPublish ?? false,
          channels: { nodes: [{ id: `${node.id}-channel`, handle: node.handle }] },
        })),
      },
    },
  }
}

function publishablePublishOk(count = 1) {
  return {
    data: {
      publishablePublish: {
        publishable: { resourcePublicationsCount: { count } },
        userErrors: [],
      },
    },
  }
}

/** The productSet call, wherever it landed among the reads. */
function productSetVariables(bodies: unknown[]): Record<string, unknown> {
  const body = bodies.find((candidate) =>
    String((candidate as { query?: string }).query ?? "").includes("FanwiseProductSet"),
  )
  if (!body) throw new Error("the adapter never sent productSet")
  return (body as { variables: Record<string, unknown> }).variables
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/** Captures the GraphQL variables the adapter sent. */
function captureFetch(bodies: unknown[], respond: (body: unknown) => Response) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    bodies.push(body)
    return respond(body)
  })
}

beforeEach(() => {
  process.env.SHOPIFY_CLIENT_ID = "test-client-id"
  process.env.SHOPIFY_CLIENT_SECRET = "test-client-secret"
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("transforms", () => {
  it("turns blank-line separated text into paragraphs", () => {
    expect(toDescriptionHtml("One.\n\nTwo.")).toBe("<p>One.</p><p>Two.</p>")
  })

  it("turns a single newline into a break rather than a paragraph", () => {
    expect(toDescriptionHtml("One.\nTwo.")).toBe("<p>One.<br>Two.</p>")
  })

  it("escapes HTML rather than passing it through", () => {
    // The canonical record holds plain text. A creator who types a < is not
    // writing markup, and forwarding it as markup is both a rendering bug and
    // an injection into someone else's storefront.
    expect(toDescriptionHtml('<script>alert("x")</script>')).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    )
  })

  it("returns an empty string for no description, never the word null", () => {
    expect(toDescriptionHtml(null)).toBe("")
  })

  it("formats money as a two-place decimal string", () => {
    expect(toMoney(48)).toBe("48.00")
    expect(toMoney(48.989999)).toBe("48.99")
    expect(toMoney(0)).toBe("0.00")
    expect(toMoney(null)).toBeNull()
  })

  it("title-cases the coarse product type", () => {
    expect(toProductType("font")).toBe("Font")
    expect(toProductType("three_d")).toBe("Three D")
  })

  it("truncates the SEO title at the limit Shopify's own admin uses", () => {
    expect(toSeoTitle("x".repeat(200))).toHaveLength(70)
    expect(toSeoTitle("Aster Grotesk")).toBe("Aster Grotesk")
    // An empty override is not an override. Sending "" would store a blank in
    // Shopify and stop it deriving the field from the product.
    expect(toSeoTitle("   ")).toBeNull()
    expect(toSeoTitle(null)).toBeNull()
  })

  it("truncates the SEO description at Shopify's limit", () => {
    expect(toSeoDescription("x".repeat(400))).toHaveLength(320)
    expect(toSeoDescription("short")).toBe("short")
    expect(toSeoDescription(null)).toBeNull()
  })

  it("builds an admin URL, which works before a product is live", () => {
    expect(adminProductUrl("aster-type.myshopify.com", "900")).toBe(
      "https://aster-type.myshopify.com/admin/products/900",
    )
  })
})

describe("requirements", () => {
  it("blocks on a missing deliverable, because the manual step needs a file", () => {
    const withoutFile = subject({ assets: [asset()] })
    const { readiness } = evaluate(
      shopifyAdapter,
      shopifyAdapter.buildListing(withoutFile),
      withoutFile,
    )
    expect(readiness.ready).toBe(false)
    expect(readiness.blocking.map((r) => r.key)).toContain("deliverable")
  })

  it("does not block on a missing cover image, which Shopify accepts", () => {
    const noCover = subject({ assets: [asset({ id: "d", asset_type: "deliverable" })] })
    const { readiness } = evaluate(shopifyAdapter, shopifyAdapter.buildListing(noCover), noCover)
    expect(readiness.blocking.map((r) => r.key)).not.toContain("cover_image")
    expect(readiness.advisory.map((r) => r.key)).toContain("cover_image")
  })

  it("warns when the listing currency is not the currency the shop sells in", () => {
    const s = subject({ connectionMetadata: { currencyCode: "GBP" } })
    const { results } = evaluate(shopifyAdapter, shopifyAdapter.buildListing(s), s)
    const rule = results.find((r) => r.key === "currency_matches_shop")
    expect(rule?.satisfied).toBe(false)
    expect(rule?.severity).toBe("warning")
    expect(rule?.message).toContain("GBP")
  })

  it("is satisfied when the currencies agree", () => {
    const s = subject()
    const { results } = evaluate(shopifyAdapter, shopifyAdapter.buildListing(s), s)
    expect(results.find((r) => r.key === "currency_matches_shop")?.satisfied).toBe(true)
  })

  it("counts only ready assets, never a pending upload", () => {
    const pending = subject({
      assets: [asset({ id: "d", asset_type: "deliverable", asset_state: "pending" })],
    })
    const { readiness } = evaluate(shopifyAdapter, shopifyAdapter.buildListing(pending), pending)
    expect(readiness.blocking.map((r) => r.key)).toContain("deliverable")
  })

  it("exposes Shopify's real title limit to the editor's counter", () => {
    expect(constraintsFor(shopifyAdapter).text.title?.maxLength).toBe(255)
    expect(constraintsFor(shopifyAdapter).tags?.maxCount).toBe(250)
  })
})

describe("the product category", () => {
  /*
    Shopify has two fields that look like a category and only one of them is.
    `productType` is free text; `category` is an id from the Standard Product
    Taxonomy, and it is the one the admin labels Category. The adapter sent only
    the first, so every product Fanwise created arrived with Category empty.
  */

  it("resolves every label it offers, so the picker cannot offer a dead option", () => {
    // The whole risk of holding taxonomy ids in this repo is that a label and
    // its id drift apart. This is the assertion that makes that a test failure
    // rather than a product that silently publishes with no category.
    for (const label of CATEGORY_LABELS) {
      expect(taxonomyCategoryId(label)).toMatch(/^gid:\/\/shopify\/TaxonomyCategory\/[a-z0-9-]+$/)
    }
  })

  it("has a default for every Fanwise product type, and every default is offerable", () => {
    for (const productType of PRODUCT_TYPES) {
      const label = defaultCategoryLabel(productType)
      expect(CATEGORY_LABELS).toContain(label)
    }
  })

  it("agrees with the migration that repaired the listings written before it", () => {
    /*
      The migration rewrites `category` on existing Shopify listings from the
      Fanwise product-type slug they were seeded with to the taxonomy label the
      adapter now expects. Two copies of one mapping is two things to keep in
      step, and the copy in SQL is the one nobody will remember to update: a
      product type added later would leave old rows repaired to a label this
      build no longer produces, and the drift would show up as a listing that
      quietly publishes with no category.
    */
    const sql = readFileSync(
      new URL(
        "../../supabase/migrations/20260907120000_listing_seo_category_and_generation.sql",
        import.meta.url,
      ),
      "utf8",
    )

    for (const productType of PRODUCT_TYPES) {
      const match = new RegExp(`when '${productType}' then '([^']+)'`).exec(sql)
      expect(match?.[1]).toBe(defaultCategoryLabel(productType))
    }
  })

  it("resolves nothing for a label it does not know", () => {
    expect(taxonomyCategoryId(null)).toBeNull()
    expect(taxonomyCategoryId("font")).toBeNull()
  })

  it("sends the taxonomy id, and keeps productType as the canonical type", () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    return shopifyAdapter.publish!(context()).then(() => {
      const input = productSetVariables(bodies).input as Record<string, unknown>
      expect(input.category).toBe("gid://shopify/TaxonomyCategory/so-2-5")
      // Two fields, two values. The category is the creator's choice; the
      // product type stays the coarse Fanwise one.
      expect(input.productType).toBe("Font")
    })
  })

  it("omits the category rather than clearing it when the label is unrecognised", async () => {
    /*
      productSet leaves an omitted field alone and overwrites a supplied one.
      Sending null for a label this build does not know would wipe a category
      the creator set in the Shopify admin, turning a naming drift into data
      loss.
    */
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    await shopifyAdapter.publish!(context({ listing: listing({ category: "Yarn" }) }))

    expect(productSetVariables(bodies).input).not.toHaveProperty("category")
  })

  it("seeds a new listing with the category its product type belongs in", () => {
    const draft = shopifyAdapter.buildListing(subject())
    expect(draft.category).toBe("Fonts")
  })

  it("warns rather than blocks on a category Shopify does not have", () => {
    const { readiness, results } = evaluate(
      shopifyAdapter,
      { ...shopifyAdapter.buildListing(subject()), category: "Yarn" },
      subject(),
    )
    const category = results.find((r) => r.key === "category")
    expect(category?.satisfied).toBe(false)
    // Shopify creates a product with no category, so this cannot be an error.
    expect(readiness.blocking.map((r) => r.key)).not.toContain("category")
  })
})

describe("the search-result fields", () => {
  it("sends both halves of the SEO input", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    await shopifyAdapter.publish!(
      context({
        listing: listing({
          seo_title: "Aster Grotesk, a nine-weight typeface",
          seo_description: "Nine weights, drawn for long text and interfaces.",
        }),
      }),
    )

    const seo = (productSetVariables(bodies).input as { seo: Record<string, string> }).seo
    expect(seo.title).toBe("Aster Grotesk, a nine-weight typeface")
    expect(seo.description).toBe("Nine weights, drawn for long text and interfaces.")
  })

  it("falls back to the listing's own writing rather than sending blanks", async () => {
    /*
      A blank is not the same as nothing. Shopify stores an empty string and
      stops deriving the field from the product, so a creator who never touched
      these would end up with a search result that has no title at all.
    */
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    await shopifyAdapter.publish!(context())

    const seo = (productSetVariables(bodies).input as { seo: Record<string, string> }).seo
    expect(seo.title).toBe("Aster Grotesk")
    expect(seo.description).toBe("Nine weights.")
  })

  it("omits a half it has nothing for, rather than clearing it", async () => {
    /*
      In GraphQL an explicit null is an instruction to clear. A listing with no
      short description and no override has no meta description, and sending
      null for it would wipe one the creator wrote in the Shopify admin on
      every update — in the field they are least likely to check.
    */
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    await shopifyAdapter.publish!(
      context({ listing: listing({ short_description: null, seo_description: null }) }),
    )

    const seo = (productSetVariables(bodies).input as { seo: Record<string, string> }).seo
    expect(seo).not.toHaveProperty("description")
    expect(seo.title).toBe("Aster Grotesk")
  })

  it("truncates an override rather than letting Shopify cut it invisibly", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    await shopifyAdapter.publish!(context({ listing: listing({ seo_title: "x".repeat(120) }) }))

    const seo = (productSetVariables(bodies).input as { seo: Record<string, string> }).seo
    expect(seo.title).toHaveLength(70)
  })

  it("is silent about an empty meta field, and loud about an overlong one", () => {
    // The reason `optional` exists. Leaving these blank is the ordinary case
    // and has a documented fallback, so a rule that complained about it would
    // put a permanent warning on almost every listing in the product.
    const base = shopifyAdapter.buildListing(subject())

    const empty = evaluate(shopifyAdapter, base, subject()).results
    expect(empty.find((r) => r.key === "seo_title")?.satisfied).toBe(true)
    expect(empty.find((r) => r.key === "seo_description")?.satisfied).toBe(true)

    const long = evaluate(shopifyAdapter, { ...base, seoTitle: "x".repeat(120) }, subject()).results
    expect(long.find((r) => r.key === "seo_title")?.satisfied).toBe(false)
  })

  it("gives the editor a counter without making the field required", () => {
    const c = constraintsFor(shopifyAdapter).text
    expect(c.seoTitle?.maxLength).toBe(70)
    expect(c.seoTitle?.required).toBe(false)
    expect(c.seoDescription?.maxLength).toBe(320)
    expect(c.seoDescription?.required).toBe(false)
  })
})

describe("publish", () => {
  it("creates the product as a DRAFT and sends no identifier", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body, { status: "DRAFT" })),
    )

    const result = await shopifyAdapter.publish!(context())

    const variables = productSetVariables(bodies)
    // No identifier means create. This is the only call in the adapter that
    // may bring a new product into existence.
    expect(variables.identifier).toBeNull()
    expect((variables.input as { status: string }).status).toBe("DRAFT")

    expect(result.externalState).toBe("draft")
    expect(result.externalListingId).toBe("gid://shopify/Product/900")
    expect(result.externalUrl).toBe("https://aster-type.myshopify.com/admin/products/900")
  })

  it("marks the variant as not requiring shipping, so a font is not quoted postage", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )
    await shopifyAdapter.publish!(context())

    const input = productSetVariables(bodies).input as Record<string, unknown>
    const variant = (input.variants as Array<Record<string, unknown>>)[0]!
    expect(variant.inventoryItem).toEqual({ requiresShipping: false, tracked: false })
    expect(variant.price).toBe("48.00")
  })

  it("attaches the cover image on a create", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )
    await shopifyAdapter.publish!(context())

    const input = productSetVariables(bodies).input as Record<string, unknown>
    expect(input.files).toEqual([
      {
        originalSource: "https://signed.example/cover.png",
        contentType: "IMAGE",
        alt: "Aster Grotesk",
      },
    ])
  })

  it("sends an identifier once the product exists, so a retry updates rather than duplicates", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    await shopifyAdapter.publish!(
      context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
    )

    const variables = productSetVariables(bodies)
    expect(variables.identifier).toEqual({ id: "gid://shopify/Product/900" })
  })

  it("sends every image the channel should receive, cover first", async () => {
    /*
      The panel promises "every channel receives this list, in this order". It
      sent one file, so a creator who arranged four pictures got one on the
      storefront and nothing saying where the rest went.
    */
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    const cover = asset({ asset_type: "cover_image", filename: "cover.png" })
    const one = asset({ asset_type: "preview_image", filename: "one.png", sort_order: 1 })
    const two = asset({ asset_type: "preview_image", filename: "two.png", sort_order: 2 })

    await shopifyAdapter.publish!(
      context({
        subject: { ...subject(), assets: [two, one, cover] },
        // Names the asset in the URL, so the assertion can be about order
        // rather than only about how many went.
        assetUrl: async (a) => `https://signed.example/${a.filename}`,
      }),
    )

    const input = productSetVariables(bodies).input as {
      files: { originalSource: string }[]
    }
    expect(input.files.map((f) => f.originalSource.split("/").pop())).toEqual([
      // Cover first whatever order the assets arrived in, then the creator's
      // sort order. This is the order the storefront grid reads.
      "cover.png",
      "one.png",
      "two.png",
    ])
  })

  it("does not send an image that is still being measured", async () => {
    // A pending row is a promise finalize_asset has not kept, and a provider
    // handed a URL for bytes that have not landed shows a broken image.
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    const cover = asset({ asset_type: "cover_image" })
    const pending = asset({ asset_type: "preview_image", asset_state: "pending" })

    await shopifyAdapter.publish!(context({ subject: { ...subject(), assets: [cover, pending] } }))

    const input = productSetVariables(bodies).input as { files: unknown[] }
    expect(input.files).toHaveLength(1)
  })

  it("sends the images a published product is missing, not only when it has none", async () => {
    /*
      The bug this closes. A product created before Fanwise sent more than the
      cover holds exactly one image, and the old rule — "does Shopify have any
      image at all" — read that as media present and omitted `files` on every
      later write. The previews a creator had already uploaded could never
      reach the storefront, and nothing anywhere said why.
    */
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) =>
        respondTo(body, { media: [{ id: "gid://shopify/MediaImage/1", status: "READY" }] }),
      ),
    )

    const cover = asset({ id: "a-cover", asset_type: "cover_image", filename: "cover.png" })
    const one = asset({
      id: "a-one",
      asset_type: "preview_image",
      filename: "one.png",
      sort_order: 1,
    })
    const two = asset({
      id: "a-two",
      asset_type: "preview_image",
      filename: "two.png",
      sort_order: 2,
    })

    await shopifyAdapter.publish!(
      context({
        listing: listing({ external_listing_id: "gid://shopify/Product/900" }),
        subject: { ...subject(), assets: [cover, one, two] },
        assetUrl: async (a) => `https://signed.example/${a.filename}`,
      }),
    )

    const input = productSetVariables(bodies).input as {
      files: { originalSource: string }[]
    }
    // All three, in channel order. productSet replaces the media list, so a
    // partial resend of "just the missing two" would drop the cover.
    expect(input.files.map((f) => f.originalSource.split("/").pop())).toEqual([
      "cover.png",
      "one.png",
      "two.png",
    ])
  })

  it("leaves media alone when the product already has some", async () => {
    // The rule productSet depends on: an omitted field is left as it is, so
    // re-sending would replace a media list the creator may have curated in
    // the Shopify admin. Holding at least as many images as Fanwise would send
    // is what makes it theirs.
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) =>
        respondTo(body, { media: [{ id: "gid://shopify/MediaImage/1", status: "READY" }] }),
      ),
    )

    await shopifyAdapter.publish!(
      context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
    )

    expect(productSetVariables(bodies).input).not.toHaveProperty("files")
  })

  it("sends the image again when Shopify holds none, so a lost image is repairable", async () => {
    /*
      The failure this exists for: Shopify fetches originalSource on its own
      schedule, after the mutation has already returned success. A URL it could
      not reach leaves a published product with no image and no error anywhere,
      and sending files only on the create made that permanent.
    */
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body, { media: [] })),
    )

    await shopifyAdapter.publish!(
      context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
    )

    expect(productSetVariables(bodies).input).toHaveProperty("files")
  })

  it("treats a failed media node as no image, or a broken one is never repaired", async () => {
    // Shopify keeps the row when its fetch fails. Counting it as media present
    // would make exactly the state we are trying to fix permanent.
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) =>
        respondTo(body, { media: [{ id: "gid://shopify/MediaImage/1", status: "FAILED" }] }),
      ),
    )

    await shopifyAdapter.publish!(
      context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
    )

    expect(productSetVariables(bodies).input).toHaveProperty("files")
  })

  it("sends no files when there is no cover, but still reads the product first", async () => {
    /*
      The read used to be skipped when there was nothing to repair with, which
      is how a product deleted in the Shopify admin stayed invisible: no read,
      no way to notice the id points at nothing. It is unconditional now
      whenever the product is supposed to exist. What has not changed is the
      write — with no images there is still no `files`, so nothing overwrites
      media a creator curated in the admin.
    */
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    await shopifyAdapter.publish!(
      context({
        listing: listing({ external_listing_id: "gid://shopify/Product/900" }),
        subject: { ...subject(), assets: [] },
      }),
    )

    const queries = bodies.map((b) => String((b as { query?: string }).query ?? ""))
    expect(queries.filter((q) => q.includes("FanwiseProductState"))).toHaveLength(1)
    expect(productSetVariables(bodies).input).not.toHaveProperty("files")
  })

  it("does not read anything when it is creating the product", async () => {
    // Nothing exists yet, so there is nothing to ask about. A create is still
    // one round trip.
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body)),
    )

    await shopifyAdapter.publish!(
      context({
        listing: listing({ external_listing_id: null }),
        subject: { ...subject(), assets: [] },
      }),
    )

    expect(bodies).toHaveLength(1)
  })

  it("activates by setting ACTIVE on the existing product", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body, { status: "ACTIVE" })),
    )

    const result = await shopifyAdapter.activate!(
      context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
    )

    const variables = productSetVariables(bodies)
    expect((variables.input as { status: string }).status).toBe("ACTIVE")
    expect(result.externalState).toBe("live")
  })

  it("preserves a live product's state through an ordinary update", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body, { status: "ACTIVE" })),
    )

    await shopifyAdapter.update!(
      context({
        listing: listing({
          external_listing_id: "gid://shopify/Product/900",
          metadata: { externalState: "live" },
        }),
      }),
    )

    const input = productSetVariables(bodies).input as { status: string }
    // An edit must not quietly take a live product off sale.
    expect(input.status).toBe("ACTIVE")
  })

  it("does not put a draft product on sale through an ordinary update", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body, { status: "DRAFT" })),
    )

    await shopifyAdapter.update!(
      context({
        listing: listing({
          external_listing_id: "gid://shopify/Product/900",
          metadata: { externalState: "draft" },
        }),
      }),
    )

    const input = productSetVariables(bodies).input as { status: string }
    expect(input.status).toBe("DRAFT")
  })

  it("asks Shopify when the listing has no record of whether the product is live", async () => {
    /*
      The bug this closes. `metadata.externalState` is absent on any listing
      published before Fanwise wrote it, and a rebuild used to blank it. The
      old reading was `externalState === "live" ? ACTIVE : DRAFT`, so absence
      was indistinguishable from a positive "this is a draft" and an ordinary
      edit took a live product off sale.
    */
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body, { holds: "ACTIVE" })),
    )

    await shopifyAdapter.update!(
      context({
        listing: listing({
          external_listing_id: "gid://shopify/Product/900",
          metadata: {},
        }),
      }),
    )

    const input = productSetVariables(bodies).input as { status: string }
    expect(input.status).toBe("ACTIVE")
  })

  it("preserves an archived product rather than reviving it as a draft", async () => {
    // ARCHIVED is a state a creator chose. Mapping it onto DRAFT would put an
    // archived product back into their active list.
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body, { holds: "ARCHIVED" })),
    )

    await shopifyAdapter.update!(
      context({
        listing: listing({ external_listing_id: "gid://shopify/Product/900", metadata: {} }),
      }),
    )

    const input = productSetVariables(bodies).input as { status: string }
    expect(input.status).toBe("ARCHIVED")
  })

  it("refuses the update rather than guessing when the status cannot be read", async () => {
    // Defaulting to DRAFT here is the deactivation this whole change exists to
    // prevent. A creator would rather retry than find their product off sale.
    // The product is there; it is its status that is unintelligible.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        respondTo(JSON.parse(String(init.body)), { holds: "SOMETHING_NEW" }),
      ),
    )

    await expect(
      shopifyAdapter.update!(
        context({
          listing: listing({ external_listing_id: "gid://shopify/Product/900", metadata: {} }),
        }),
      ),
    ).rejects.toThrow(/could not read whether this product is currently on sale/)
  })

  it("still lets a recorded state decide the status it sends", async () => {
    // The recorded value is what publication itself wrote, and it is trusted
    // when it says something. The read that now happens either way is about
    // whether the product exists, not about what to send.
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body, { status: "ACTIVE", holds: "DRAFT" })),
    )

    await shopifyAdapter.update!(
      context({
        listing: listing({
          external_listing_id: "gid://shopify/Product/900",
          metadata: { externalState: "live" },
        }),
        subject: { ...subject(), assets: [] },
      }),
    )

    // Shopify says DRAFT, the listing's own record says live, and the record
    // wins. `preserve` is for a listing that has no record at all.
    expect((productSetVariables(bodies).input as { status: string }).status).toBe("ACTIVE")
  })
})

describe("putting the product on a sales channel", () => {
  /*
    ADR 0004. `status: ACTIVE` does not make a Shopify product purchasable —
    being active and being on a sales channel are separate facts, and A5's exit
    test found three products that were the first and not the second. activate()
    used to set the status and stop, and Fanwise reported the result as "Live".
  */

  it("sets ACTIVE and then puts the product on the channel", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body, { status: "ACTIVE", holds: "ACTIVE" })),
    )

    const result = await shopifyAdapter.activate!(
      context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
    )

    const queries = bodies.map((b) => String((b as { query?: string }).query ?? ""))
    expect(queries.some((q) => q.includes("FanwiseProductSet"))).toBe(true)
    expect(queries.some((q) => q.includes("FanwisePublishablePublish"))).toBe(true)
    expect(result.purchasable).toBe(true)
  })

  it("reports the product as not purchasable when it landed on no publication", async () => {
    /*
      The assertion the whole change turns on. publishablePublish returned no
      userErrors, so the old reading is "it worked" — and the product is on
      zero publications, which means no storefront page and no buyer. The count
      is the answer; the absence of errors is not.
    */
    vi.stubGlobal(
      "fetch",
      captureFetch([], (body) =>
        respondTo(body, { status: "ACTIVE", holds: "ACTIVE", publishedTo: 0 }),
      ),
    )

    const result = await shopifyAdapter.activate!(
      context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
    )

    expect(result.purchasable).toBe(false)
  })

  it("creates a draft as explicitly not purchasable", async () => {
    vi.stubGlobal(
      "fetch",
      captureFetch([], (body) => respondTo(body)),
    )

    const result = await shopifyAdapter.publish!(context())

    // False rather than absent. Absent means nobody established it, and the two
    // must stay tellable apart or liveness cannot use either.
    expect(result.purchasable).toBe(false)
  })

  it("leaves purchasability alone on an ordinary update", async () => {
    // An update does not look at publications, so it has no opinion. Returning
    // false here would take a live product's badge away for no reason.
    vi.stubGlobal(
      "fetch",
      captureFetch([], (body) => respondTo(body, { holds: "ACTIVE" })),
    )

    const result = await shopifyAdapter.update!(
      context({
        listing: listing({
          external_listing_id: "gid://shopify/Product/900",
          metadata: { externalState: "live" },
        }),
      }),
    )

    expect(result.purchasable).toBeUndefined()
  })

  it("refuses rather than guessing when the store's channels are ambiguous", async () => {
    /*
      Publication.name and Publication.app are both deprecated on 2026-07, so
      the Online Store is identified by a channel handle that shopify.dev does
      not document. When that convention does not match, the alternative to an
      error is putting a font on Point of Sale, or into a wholesale catalog with
      its own price list, on a channel the creator may not know they have.
    */
    vi.stubGlobal(
      "fetch",
      captureFetch([], (body) =>
        respondTo(body, {
          status: "ACTIVE",
          holds: "ACTIVE",
          publications: [
            { id: "gid://shopify/Publication/1", handle: "point_of_sale" },
            { id: "gid://shopify/Publication/2", handle: "some_marketplace" },
          ],
        }),
      ),
    )

    await expect(
      shopifyAdapter.activate!(
        context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
      ),
    ).rejects.toThrow(/could not tell which of this store's sales channels is the Online Store/)
  })

  it("takes the only channel a single-publication store has", async () => {
    // A development store is usually this. There is no judgement to get wrong
    // when there is one place a product can go.
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) =>
        respondTo(body, {
          status: "ACTIVE",
          holds: "ACTIVE",
          publications: [{ id: "gid://shopify/Publication/7", handle: null }],
        }),
      ),
    )

    const result = await shopifyAdapter.activate!(
      context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
    )

    expect(result.purchasable).toBe(true)
    expect(result.providerResponse).toMatchObject({
      publication: { id: "gid://shopify/Publication/7", resolvedBy: "only_publication" },
    })
  })

  it("asks for a reconnect before it makes a call the token cannot make", async () => {
    /*
      Fanwise runs its own OAuth, not Shopify's managed installation, so nothing
      prompts a creator when the scope list grows. Without this the failure is a
      403 arriving at the end of an activate — after the product exists and
      after the creator has already attached the file by hand.
    */
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const stale = context()
    const connection = {
      ...stale.connection,
      scopes: ["write_products", "read_products"],
    } as ChannelConnection

    await expect(
      shopifyAdapter.activate!({
        ...stale,
        connection,
        listing: listing({ external_listing_id: "gid://shopify/Product/900" }),
      }),
    ).rejects.toThrow(/Reconnect the store and accept the permissions/)

    // Nothing was attempted. The point is to ask before failing, not after.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("leaves a connection from before the scopes column was populated alone", async () => {
    // An empty stored list means "we did not record it", not "nothing was
    // granted". Forcing a re-authorization on that guess is the more expensive
    // mistake, so it is not made.
    vi.stubGlobal(
      "fetch",
      captureFetch([], (body) => respondTo(body, { status: "ACTIVE", holds: "ACTIVE" })),
    )

    const base = context()
    const result = await shopifyAdapter.activate!({
      ...base,
      connection: { ...base.connection, scopes: [] } as ChannelConnection,
      listing: listing({ external_listing_id: "gid://shopify/Product/900" }),
    })

    expect(result.purchasable).toBe(true)
  })
})

describe("a product that is gone from the channel", () => {
  /*
    The failure a creator actually hit: a product deleted in the Shopify admin,
    and a Fanwise listing still pointing at it with an admin URL that returns
    Not Found. Every write against that identifier failed, and each failed
    differently, so nothing in the product ever said the plain thing — the
    product is not there any more.
  */

  it("names the deletion instead of failing obscurely, and writes nothing", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, (body) => respondTo(body, { missing: true })),
    )

    await expect(
      shopifyAdapter.update!(
        context({
          listing: listing({ external_listing_id: "gid://shopify/Product/900", metadata: {} }),
        }),
      ),
    ).rejects.toThrow(/no longer exists in Shopify/)

    // The read happened and the write did not. Sending productSet with a dead
    // identifier is what produced the unintelligible failures.
    const queries = bodies.map((b) => String((b as { query?: string }).query ?? ""))
    expect(queries.some((q) => q.includes("FanwiseProductSet"))).toBe(false)
  })

  it("raises the code the runner acts on, and only for a confirmed absence", async () => {
    vi.stubGlobal(
      "fetch",
      captureFetch([], (body) => respondTo(body, { missing: true })),
    )

    const error = await shopifyAdapter.activate!(
      context({
        listing: listing({ external_listing_id: "gid://shopify/Product/900", metadata: {} }),
      }),
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ChannelError)
    expect((error as ChannelError).normalized.code).toBe("external_object_missing")
    // Not retryable: asking again will get the same answer, and a retry that
    // eventually gave up would leave the listing claiming to be published.
    expect((error as ChannelError).normalized.retryable).toBe(false)
  })

  it("does not raise it when the store itself could not be reached", async () => {
    // The distinction the runner depends on. A 404 from the store is not the
    // provider confirming this product is gone, and clearing the listing's
    // external id on one would publish a second product next time.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ errors: [{ message: "Not Found" }] }, 404)),
    )

    const error = await shopifyAdapter.update!(
      context({
        listing: listing({ external_listing_id: "gid://shopify/Product/900", metadata: {} }),
      }),
    ).catch((e: unknown) => e)

    expect((error as ChannelError).normalized.code).toBe("not_found")
  })
})

describe("error normalization", () => {
  it("turns userErrors into a readable message naming the field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: {
            productSet: {
              product: null,
              userErrors: [
                { field: ["input", "variants", "0", "price"], message: "Price is invalid." },
              ],
            },
          },
        }),
      ),
    )

    const error = await shopifyAdapter.publish!(context()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ChannelError)
    const normalized = (error as ChannelError).normalized
    expect(normalized.code).toBe("validation_rejected")
    expect(normalized.message).toContain("price")
    expect(normalized.retryable).toBe(false)
    // The provider's own words are kept for the job row, not shown.
    expect(normalized.raw).toBeTruthy()
  })

  it("treats an unauthorized response as a credential problem, and does not retry it", async () => {
    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }))
    vi.stubGlobal("fetch", fetchMock)

    const error = await shopifyAdapter.publish!(context()).catch((e: unknown) => e)
    expect((error as ChannelError).normalized.code).toBe("credentials_invalid")
    expect((error as ChannelError).normalized.retryable).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("never leaks the access token into a normalized error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    )
    const error = await shopifyAdapter.publish!(context()).catch((e: unknown) => e)
    expect(JSON.stringify((error as ChannelError).normalized)).not.toContain("shpat-test-token")
  })
})

describe("the client", () => {
  const schema = z.object({ ok: z.boolean() })

  it("treats a throttled 200 as a failure and retries it", async () => {
    // The specific bug this guards: Shopify rate limiting arrives as HTTP 200
    // with an errors entry. A client that branches on status alone reports a
    // publish that never happened.
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      return calls === 1
        ? jsonResponse({
            errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
            extensions: {
              cost: {
                throttleStatus: { maximumAvailable: 100, currentlyAvailable: 0, restoreRate: 50 },
              },
            },
          })
        : jsonResponse({ data: { ok: true } })
    })

    const client = createShopifyClient({
      shopDomain: "aster-type.myshopify.com",
      accessToken: "t",
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleep,
    })

    await expect(client.request({ query: "query{}", variables: {}, schema })).resolves.toEqual({
      ok: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("gives up on a throttle that never clears, rather than looping", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }),
    )
    const client = createShopifyClient({
      shopDomain: "s.myshopify.com",
      accessToken: "t",
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleep,
    })

    await expect(client.request({ query: "q", variables: {}, schema })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("retries a transport failure", async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error("ECONNRESET")
      return jsonResponse({ data: { ok: true } })
    })
    const client = createShopifyClient({
      shopDomain: "s.myshopify.com",
      accessToken: "t",
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleep,
    })

    await expect(client.request({ query: "q", variables: {}, schema })).resolves.toEqual({
      ok: true,
    })
  })

  it("refuses a payload that does not match the schema instead of returning undefined", async () => {
    // Rule 6: every external response is validated with Zod before use. A shape
    // Shopify changed is a normalized failure here, not a TypeError later.
    const client = createShopifyClient({
      shopDomain: "s.myshopify.com",
      accessToken: "t",
      fetchImpl: (async () => jsonResponse({ data: { unexpected: 1 } })) as unknown as typeof fetch,
      sleep,
    })

    const error = await client
      .request({ query: "q", variables: {}, schema })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ChannelError)
    expect((error as ChannelError).normalized.code).toBe("unknown")
  })

  it("does not treat a 200 with a null data field as success", async () => {
    const client = createShopifyClient({
      shopDomain: "s.myshopify.com",
      accessToken: "t",
      fetchImpl: (async () => jsonResponse({ data: null })) as unknown as typeof fetch,
      sleep,
    })
    await expect(client.request({ query: "q", variables: {}, schema })).rejects.toThrow()
  })

  it("sends the token in the header Shopify expects and nowhere else", async () => {
    const seen: RequestInit[] = []
    const client = createShopifyClient({
      shopDomain: "s.myshopify.com",
      accessToken: "shpat-secret",
      fetchImpl: (async (_u: unknown, init: RequestInit) => {
        seen.push(init)
        return jsonResponse({ data: { ok: true } })
      }) as unknown as typeof fetch,
      sleep,
    })

    await client.request({ query: "q", variables: {}, schema })
    const headers = seen[0]!.headers as Record<string, string>
    expect(headers["X-Shopify-Access-Token"]).toBe("shpat-secret")
    expect(String(seen[0]!.body)).not.toContain("shpat-secret")
  })
})
