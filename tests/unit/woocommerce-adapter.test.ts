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
import { evaluate, resolveDraft } from "@/lib/channels/listings"
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
 * Fanwise's side of the wire: a publish creates a digital product on sale with
 * its Fanwise download attached and no slug, an update keeps each download's id
 * so past buyers keep their file, tags are created by name and matched when
 * they exist, and a deleted product is raised by the one code the runner acts
 * on.
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
    deliveryUrl: async (a) => `https://fanwise.test/api/public/delivery/token-${a.id}`,
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
  options: {
    held?: Record<string, unknown>
    missing?: boolean
    existingTags?: string[]
    /** What the stamp search finds: product ids and the SKU each carries. */
    stamped?: { id: number; sku: string | null }[]
  } = {},
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    calls.push({ method, url, body })

    if (/\/products\?sku=/.test(url) && method === "GET") {
      return json((options.stamped ?? []).map((hit) => productOk({ id: hit.id, sku: hit.sku })))
    }
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
          downloads: withIds(body?.downloads),
        }),
      )
    }
    if (url.endsWith("/products") && method === "POST") {
      return json(
        productOk({
          status: String(body?.status),
          images: [{ id: 1 }],
          downloads: withIds(body?.downloads),
        }),
        201,
      )
    }
    return json({ code: "rest_no_route", message: "No route", data: { status: 404 } }, 404)
  })
}

/** The store gives each new download an id, as WooCommerce does. */
function withIds(downloads: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(downloads)) return []
  return downloads.map((download: Record<string, unknown>, index) => ({
    id: download.id ?? `new-${index}`,
    ...download,
  }))
}

const write = (calls: Call[], method: string) =>
  calls.find((c) => c.method === method && /\/products(\/\d+)?$/.test(c.url))

afterEach(() => {
  resetStore()
})

describe("declaration", () => {
  it("needs no app credentials, delivers the file itself, and leaves nothing to do by hand", () => {
    expect(woocommerceAdapter.oauth?.grant).toBeDefined()
    expect(woocommerceAdapter.capabilities.digitalFileUpload).toBe(true)
    expect(woocommerceAdapter.capabilities.drafts).toBe(false)
    expect(woocommerceAdapter.manualSteps).toEqual([])
    expect(woocommerceAdapter.activate).toBeUndefined()
  })

  it("has no category and no meta fields, and takes its words from the product", () => {
    expect(woocommerceAdapter.fields).not.toContain("category")
    expect(woocommerceAdapter.fields).not.toContain("seoTitle")

    const s = subject()
    const read = resolveDraft(woocommerceAdapter.buildListing(s), s.product, woocommerceAdapter)
    expect(read.category).toBeNull()
    expect(read.seoTitle).toBeNull()
    expect(read.price).toBe(48)
    expect(read.title).toBe("Aster Grotesk")
  })

  it("is ready with a title, a price and a deliverable, and warns on currency", () => {
    const draft = resolveDraft(
      woocommerceAdapter.buildListing(subject()),
      subject().product,
      woocommerceAdapter,
    )
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
  it("creates the product on sale, with its Fanwise download, images, tags by id, and no slug", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { existingTags: ["sans"] }))

    const result = await woocommerceAdapter.publish!(context())

    const create = write(calls, "POST")!
    expect(create.url).toBe("https://shop.example.com/wp-json/wc/v3/products")
    expect(create.body).toMatchObject({
      name: "Aster Grotesk",
      type: "simple",
      status: "publish",
      virtual: true,
      downloadable: true,
      sold_individually: true,
      regular_price: "48.00",
      description: "<p>A grotesque in nine weights.</p><p>Drawn for long text.</p>",
      tags: [{ id: 101 }, { id: 55 }],
      images: [{ src: "https://signed.example/cover.png", alt: "Aster Grotesk" }],
      // The deliverable, at its Fanwise address. The cover image is not one.
      downloads: [
        { name: "aster.zip", file: "https://fanwise.test/api/public/delivery/token-asset-2" },
      ],
    })
    expect(create.body).not.toHaveProperty("slug")
    expect(result).toMatchObject({
      externalListingId: "900",
      externalUrl: adminProductUrl("https://shop.example.com", 900),
      publicUrl: "https://shop.example.com/product/aster-grotesk/",
      externalState: "live",
      purchasable: true,
    })
  })

  it("is not purchasable when the product has no deliverable to attach", async () => {
    const calls: Call[] = []
    scriptStore(store(calls))
    const result = await woocommerceAdapter.publish!(
      context({ subject: subject({ assets: [asset()] }) }),
    )
    expect(write(calls, "POST")!.body!.downloads).toEqual([])
    expect(result.purchasable).toBe(false)
  })

  it("reads nothing but its own stamp before a create", async () => {
    // No product exists to ask about. The one read is the guard's search for
    // a create whose answer was lost, and the create then carries the stamp
    // that search looks for.
    const calls: Call[] = []
    scriptStore(store(calls))
    await woocommerceAdapter.publish!(context())
    expect(calls.filter((c) => c.method === "GET").map((c) => c.url)).toEqual([
      "https://shop.example.com/wp-json/wc/v3/products?sku=fanwise-listing-1",
    ])
    expect(write(calls, "POST")!.body!.sku).toBe("fanwise-listing-1")
  })
})

describe("update", () => {
  it("reads first, keeps each download's id, and omits images the store already holds", async () => {
    const calls: Call[] = []
    scriptStore(
      store(calls, {
        held: {
          status: "publish",
          images: [{ id: 1 }],
          downloads: [
            {
              id: "d-1",
              name: "aster.zip",
              file: "https://fanwise.test/api/public/delivery/token-asset-2",
            },
          ],
        },
      }),
    )

    const result = await woocommerceAdapter.update!(
      context({ listing: listing({ external_listing_id: "900", metadata: {} }) }),
    )

    expect(calls[0]!.method).toBe("GET")
    const put = write(calls, "PUT")!
    expect(put.url).toBe("https://shop.example.com/wp-json/wc/v3/products/900")
    expect(put.body!.status).toBe("publish")
    expect(put.body).not.toHaveProperty("images")
    // The same address the store holds goes back with its id, so every past
    // buyer's download still points at the file.
    expect(put.body!.downloads).toEqual([
      {
        id: "d-1",
        name: "aster.zip",
        file: "https://fanwise.test/api/public/delivery/token-asset-2",
      },
    ])
    expect(result.externalState).toBe("live")
    expect(result.purchasable).toBe(true)
  })

  it("puts a draft left over from the old manual file step on sale, with its download", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { held: { status: "draft", downloads: [], images: [{ id: 1 }] } }))
    const result = await woocommerceAdapter.update!(
      context({
        listing: listing({
          external_listing_id: "900",
          metadata: { externalState: "draft", purchasable: false },
        }),
      }),
    )
    const put = write(calls, "PUT")!
    expect(put.body!.status).toBe("publish")
    expect(put.body!.downloads).toHaveLength(1)
    expect(result.purchasable).toBe(true)
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

describe("the create guard", () => {
  // ADR 0005. A create whose answer was lost on the wire may have landed, so
  // the product carries the listing id as its SKU and a later attempt looks
  // for that SKU before creating again.

  it("adopts the product an earlier create left behind, and updates it in place", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { stamped: [{ id: 900, sku: "fanwise-listing-1" }] }))

    const result = await woocommerceAdapter.publish!(context())

    expect(write(calls, "POST")).toBeUndefined()
    const update = write(calls, "PUT")!
    expect(update.url).toBe("https://shop.example.com/wp-json/wc/v3/products/900")
    expect(update.body).not.toHaveProperty("sku")
    // The adopted product is read before it is written, like any update.
    expect(calls.map((c) => `${c.method} ${c.url.split("/wc/v3/")[1]}`)).toEqual(
      expect.arrayContaining(["GET products?sku=fanwise-listing-1", "GET products/900"]),
    )
    expect(result).toMatchObject({
      externalListingId: "900",
      externalState: "live",
      providerResponse: { adopted: "900" },
    })
  })

  it("ignores a hit whose SKU is not exactly the stamp", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { stamped: [{ id: 900, sku: "fanwise-listing-12" }] }))
    await woocommerceAdapter.publish!(context())
    expect(write(calls, "POST")).toBeDefined()
    expect(write(calls, "PUT")).toBeUndefined()
  })

  it("never sends the SKU on an update, so a creator's own SKU survives", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { held: { status: "publish", sku: "ASTER-01" } }))
    await woocommerceAdapter.update!(context({ listing: listing({ external_listing_id: "900" }) }))
    expect(write(calls, "PUT")!.body).not.toHaveProperty("sku")
    expect(calls.some((c) => /products\?sku=/.test(c.url))).toBe(false)
  })
})
