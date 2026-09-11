import { afterEach, describe, expect, it, vi } from "vitest"
import { resetStore, scriptStore } from "./outbound-support"

vi.mock("@/lib/credentials", () => ({
  readConnectionCredentials: vi.fn(async () => ({
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  })),
}))

import { woocommerceAdapter } from "@/lib/channels/adapters/woocommerce"
import { adminProductUrl, toMoney } from "@/lib/channels/adapters/woocommerce/transform"
import { evaluate } from "@/lib/channels/listings"
import { constraintsFor } from "@/lib/channels/constraints"
import type {
  AdapterSubject,
  ChannelConnection,
  ChannelListing,
  PublishContext,
} from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

/**
 * The WooCommerce adapter, with the store replaced by a fetch that answers
 * from a script. Nothing here reaches a live store; what is proved is
 * Fanwise's side of the wire: a publish creates a draft digital product with
 * no slug, an update preserves the store's status, tags are created by name
 * and matched when they exist, a deleted product is raised by the one code
 * the runner acts on, and activate refuses a product with no file on it.
 */

function listing(overrides: Partial<ChannelListing> = {}): ChannelListing {
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
    category: null,
    seo_title: null,
    seo_description: null,
    tags: ["grotesque", "sans"],
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
    sort_order: 0,
    created_at: "2026-09-08T00:00:00Z",
    derived_from: null,
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
    connectionMetadata: { currency: "USD" },
    ...overrides,
  }
}

function context(overrides: Partial<PublishContext> = {}): PublishContext {
  return {
    listing: listing(),
    connection: {
      id: "conn-1",
      workspace_id: "ws-1",
      external_account_id: "shop.example.com",
      metadata: { currency: "USD" },
      scopes: ["read_write"],
    } as unknown as ChannelConnection,
    subject: subject(),
    assetUrl: async () => "https://signed.example/cover.png",
    ...overrides,
  }
}

interface Call {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function productOk(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    status: "draft",
    permalink: "https://shop.example.com/product/aster-grotesk/",
    catalog_visibility: "visible",
    downloadable: true,
    downloads: [],
    images: [],
    ...overrides,
  }
}

/**
 * Answers whichever call the adapter made. `held` is what the store currently
 * has for the product read; `missing` answers that read as a deleted id would.
 */
function store(
  calls: Call[],
  options: { held?: Record<string, unknown>; missing?: boolean; existingTags?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    calls.push({ method, url, body })

    if (url.endsWith("/products/tags") && method === "POST") {
      const name = String(body?.name)
      if (options.existingTags?.includes(name)) {
        return json(
          {
            code: "term_exists",
            message: "A term with the name provided already exists.",
            data: { status: 400, resource_id: 55 },
          },
          400,
        )
      }
      return json(
        { id: 100 + calls.filter((c) => c.url.endsWith("/products/tags")).length, name },
        201,
      )
    }
    if (/\/products\/\d+$/.test(url) && method === "GET") {
      if (options.missing) {
        return json(
          {
            code: "woocommerce_rest_product_invalid_id",
            message: "Invalid ID.",
            data: { status: 404 },
          },
          404,
        )
      }
      return json(productOk(options.held))
    }
    if (/\/products\/\d+$/.test(url) && method === "PUT") {
      return json(
        productOk({
          ...options.held,
          ...(body ?? {}),
          id: 900,
          images: options.held?.images ?? [],
        }),
      )
    }
    if (url.endsWith("/products") && method === "POST") {
      return json(productOk({ status: String(body?.status), images: [{ id: 1 }] }), 201)
    }
    return json({ code: "rest_no_route", message: "No route", data: { status: 404 } }, 404)
  })
}

const write = (calls: Call[], method: string) =>
  calls.find((c) => c.method === method && /\/products(\/\d+)?$/.test(c.url))

afterEach(() => {
  resetStore()
})

describe("declaration", () => {
  it("needs no app credentials and declares the file step", () => {
    expect(woocommerceAdapter.oauth?.grant).toBeDefined()
    expect(woocommerceAdapter.capabilities.digitalFileUpload).toBe(false)
    expect(woocommerceAdapter.manualSteps.map((s) => s.key)).toEqual(["attach_digital_file"])
    expect(woocommerceAdapter.manualSteps[0]!.gatesActivation).toBe(true)
  })

  it("builds a draft with no category and no meta fields", () => {
    const draft = woocommerceAdapter.buildListing(subject())
    expect(draft.category).toBeNull()
    expect(draft.seoTitle).toBeNull()
    expect(draft.price).toBe(48)
  })

  it("is ready with a title, a price and a deliverable, and warns on currency", () => {
    const draft = woocommerceAdapter.buildListing(subject())
    const { readiness, results } = evaluate(
      woocommerceAdapter,
      draft,
      subject({ connectionMetadata: { currency: "EUR" } }),
    )
    expect(readiness.ready).toBe(true)
    expect(results.find((r) => r.key === "currency_matches_store")?.satisfied).toBe(false)
    expect(constraintsFor(woocommerceAdapter).text.title?.maxLength).toBe(200)
  })
})

describe("publish", () => {
  it("creates a draft digital product with images, tags by id, and no slug", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { existingTags: ["sans"] }))

    const result = await woocommerceAdapter.publish!(context())

    const create = write(calls, "POST")!
    expect(create.url).toBe("https://shop.example.com/wp-json/wc/v3/products")
    expect(create.body).toMatchObject({
      name: "Aster Grotesk",
      type: "simple",
      status: "draft",
      virtual: true,
      downloadable: true,
      sold_individually: true,
      regular_price: "48.00",
      description: "<p>A grotesque in nine weights.</p><p>Drawn for long text.</p>",
      tags: [{ id: 101 }, { id: 55 }],
      images: [{ src: "https://signed.example/cover.png", alt: "Aster Grotesk" }],
    })
    expect(create.body).not.toHaveProperty("slug")
    expect(result).toMatchObject({
      externalListingId: "900",
      externalUrl: adminProductUrl("https://shop.example.com", 900),
      externalState: "draft",
      purchasable: false,
    })
  })

  it("does not read the store before a create", async () => {
    const calls: Call[] = []
    scriptStore(store(calls))
    await woocommerceAdapter.publish!(context())
    expect(calls.some((c) => c.method === "GET")).toBe(false)
  })
})

describe("update", () => {
  it("reads first, preserves a live product's status, and omits images the store already holds", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { held: { status: "publish", images: [{ id: 1 }] } }))

    const result = await woocommerceAdapter.update!(
      context({ listing: listing({ external_listing_id: "900", metadata: {} }) }),
    )

    expect(calls[0]!.method).toBe("GET")
    const put = write(calls, "PUT")!
    expect(put.url).toBe("https://shop.example.com/wp-json/wc/v3/products/900")
    expect(put.body!.status).toBe("publish")
    expect(put.body).not.toHaveProperty("images")
    expect(result.externalState).toBe("live")
  })

  it("resends images when the store holds fewer than the listing sends", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { held: { status: "draft", images: [] } }))
    await woocommerceAdapter.update!(context({ listing: listing({ external_listing_id: "900" }) }))
    expect(write(calls, "PUT")!.body).toHaveProperty("images")
  })

  it("raises external_object_missing when the store says the product is gone", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { missing: true }))
    await expect(
      woocommerceAdapter.update!(context({ listing: listing({ external_listing_id: "900" }) })),
    ).rejects.toMatchObject({ normalized: { code: "external_object_missing" } })
    expect(calls.some((c) => c.method === "PUT")).toBe(false)
  })
})

describe("activate", () => {
  it("refuses while no download file is on the product", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { held: { downloads: [] } }))
    await expect(
      woocommerceAdapter.activate!(context({ listing: listing({ external_listing_id: "900" }) })),
    ).rejects.toMatchObject({ normalized: { code: "validation_rejected" } })
    expect(calls.some((c) => c.method === "PUT")).toBe(false)
  })

  it("publishes once the file is there and reports the product purchasable", async () => {
    const calls: Call[] = []
    scriptStore(
      store(calls, {
        held: {
          downloads: [
            {
              name: "aster.zip",
              file: "https://shop.example.com/wp-content/uploads/woocommerce_uploads/aster.zip",
            },
          ],
          images: [{ id: 1 }],
        },
      }),
    )
    const result = await woocommerceAdapter.activate!(
      context({ listing: listing({ external_listing_id: "900" }) }),
    )
    expect(write(calls, "PUT")!.body!.status).toBe("publish")
    expect(result.externalState).toBe("live")
    expect(result.purchasable).toBe(true)
  })
})

describe("errors", () => {
  it("normalizes a rejected key pair without the store's words", async () => {
    scriptStore(
      vi.fn(async () =>
        json(
          { code: "woocommerce_rest_cannot_create", message: "Sorry, you are not allowed." },
          401,
        ),
      ),
    )
    await expect(woocommerceAdapter.publish!(context())).rejects.toMatchObject({
      normalized: { code: "credentials_invalid" },
    })
  })

  it("normalizes a missing REST route to a sentence about permalinks", async () => {
    scriptStore(
      vi.fn(async () =>
        json({ code: "rest_no_route", message: "No route was found", data: { status: 404 } }, 404),
      ),
    )
    await expect(woocommerceAdapter.publish!(context())).rejects.toMatchObject({
      normalized: { code: "not_found", message: expect.stringContaining("permalinks") },
    })
  })

  it("names the parameter a 400 objects to", async () => {
    scriptStore(
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/products/tags")) return json({ id: 1, name: "x" }, 201)
        return json(
          {
            code: "rest_invalid_param",
            message: "Invalid parameter(s): regular_price",
            data: { status: 400, params: { regular_price: "not a number" } },
          },
          400,
        )
      }),
    )
    await expect(woocommerceAdapter.publish!(context())).rejects.toMatchObject({
      normalized: {
        code: "validation_rejected",
        message: expect.stringContaining("regular_price"),
      },
    })
  })
})

describe("transforms", () => {
  it("formats money to two places and the admin URL from the store base", () => {
    expect(toMoney(48)).toBe("48.00")
    expect(toMoney(null)).toBeNull()
    expect(adminProductUrl("https://shop.example.com", 12)).toBe(
      "https://shop.example.com/wp-admin/post.php?post=12&action=edit",
    )
  })
})
