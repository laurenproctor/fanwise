import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

vi.mock("@/lib/credentials", () => ({
  readConnectionCredentials: vi.fn(async () => ({ accessToken: "shpat-test-token" })),
}))

import { createShopifyClient } from "@/lib/channels/adapters/shopify/client"
import { shopifyAdapter } from "@/lib/channels/adapters/shopify"
import { constraintsFor } from "@/lib/channels/constraints"
import { evaluate } from "@/lib/channels/listings"
import { ChannelError } from "@/lib/channels/errors"
import {
  adminProductUrl,
  toDescriptionHtml,
  toMoney,
  toProductType,
  toSeoDescription,
} from "@/lib/channels/adapters/shopify/transform"
import type {
  AdapterSubject,
  ChannelConnection,
  ChannelListing,
  PublishContext,
} from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

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
    category: "font",
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/** Captures the GraphQL variables the adapter sent. */
function captureFetch(bodies: unknown[], respond: () => Response) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return respond()
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

describe("publish", () => {
  it("creates the product as a DRAFT and sends no identifier", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, () => jsonResponse(productSetOk("DRAFT"))),
    )

    const result = await shopifyAdapter.publish!(context())

    const variables = (bodies[0] as { variables: Record<string, unknown> }).variables
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
      captureFetch(bodies, () => jsonResponse(productSetOk())),
    )
    await shopifyAdapter.publish!(context())

    const input = (bodies[0] as { variables: { input: Record<string, unknown> } }).variables.input
    const variant = (input.variants as Array<Record<string, unknown>>)[0]!
    expect(variant.inventoryItem).toEqual({ requiresShipping: false, tracked: false })
    expect(variant.price).toBe("48.00")
  })

  it("attaches the cover image on a create", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, () => jsonResponse(productSetOk())),
    )
    await shopifyAdapter.publish!(context())

    const input = (bodies[0] as { variables: { input: Record<string, unknown> } }).variables.input
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
      captureFetch(bodies, () => jsonResponse(productSetOk())),
    )

    await shopifyAdapter.publish!(
      context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
    )

    const variables = (bodies[0] as { variables: Record<string, unknown> }).variables
    expect(variables.identifier).toEqual({ id: "gid://shopify/Product/900" })
    // Media is not re-sent on an update: productSet leaves an omitted field
    // alone, and re-sending would risk replacing a list the creator curated.
    expect((variables.input as Record<string, unknown>).files).toBeUndefined()
  })

  it("activates by setting ACTIVE on the existing product", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, () => jsonResponse(productSetOk("ACTIVE"))),
    )

    const result = await shopifyAdapter.activate!(
      context({ listing: listing({ external_listing_id: "gid://shopify/Product/900" }) }),
    )

    const variables = (bodies[0] as { variables: Record<string, unknown> }).variables
    expect((variables.input as { status: string }).status).toBe("ACTIVE")
    expect(result.externalState).toBe("live")
  })

  it("preserves a live product's state through an ordinary update", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, () => jsonResponse(productSetOk("ACTIVE"))),
    )

    await shopifyAdapter.update!(
      context({
        listing: listing({
          external_listing_id: "gid://shopify/Product/900",
          metadata: { externalState: "live" },
        }),
      }),
    )

    const input = (bodies[0] as { variables: { input: { status: string } } }).variables.input
    // An edit must not quietly take a live product off sale.
    expect(input.status).toBe("ACTIVE")
  })

  it("does not put a draft product on sale through an ordinary update", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      captureFetch(bodies, () => jsonResponse(productSetOk("DRAFT"))),
    )

    await shopifyAdapter.update!(
      context({
        listing: listing({
          external_listing_id: "gid://shopify/Product/900",
          metadata: { externalState: "draft" },
        }),
      }),
    )

    const input = (bodies[0] as { variables: { input: { status: string } } }).variables.input
    expect(input.status).toBe("DRAFT")
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
