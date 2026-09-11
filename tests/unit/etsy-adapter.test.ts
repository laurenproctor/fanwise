import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const credentialsMock = vi.hoisted(() => ({
  read: vi.fn(),
  store: vi.fn(async () => {}),
}))
vi.mock("@/lib/credentials", () => ({
  readConnectionCredentials: credentialsMock.read,
  storeConnectionCredentials: credentialsMock.store,
}))

import { etsyAdapter } from "@/lib/channels/adapters/etsy"
import { resetConfigCacheForTests } from "@/lib/channels/adapters/etsy/config"
import {
  CATEGORIES,
  defaultCategoryLabel,
  taxonomyId,
} from "@/lib/channels/adapters/etsy/categories"
import { toTags } from "@/lib/channels/adapters/etsy/transform"
import { evaluate } from "@/lib/channels/listings"
import type {
  AdapterSubject,
  ChannelConnection,
  ChannelListing,
  PublishContext,
} from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

/**
 * The Etsy adapter, with Etsy replaced by a fetch that answers from a script.
 * What is proved is Fanwise's side of the wire: a publish is four calls in
 * order and ends active; a failure after the draft deletes it; an update
 * reads first, keeps the state, and uploads only what the listing is short of;
 * a deleted listing is raised by the one code the runner acts on; and the
 * token refreshes and is re-sealed when its hour is nearly up.
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
    description: "A grotesque in nine weights.\r\n\r\nDrawn for long text.",
    short_description: null,
    price: 48,
    currency: "USD",
    category: "Graphic Design",
    seo_title: null,
    seo_description: null,
    tags: ["grotesque font", "sans & serif", "grotesque font"],
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
    byte_size: 1000,
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
  canonical_title: "Aster Grotesk",
  canonical_description: "A grotesque in nine weights.",
  short_description: null,
  base_price: 48,
  currency: "USD",
} as unknown as Product

function subject(overrides: Partial<AdapterSubject> = {}): AdapterSubject {
  return {
    product,
    assets: [
      asset(),
      asset({ id: "asset-2", asset_type: "deliverable", filename: "aster.zip", byte_size: 5000 }),
    ],
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
      external_account_id: "777",
      metadata: { currencyCode: "USD" },
      scopes: ["listings_r", "listings_w", "listings_d", "shops_r"],
    } as unknown as ChannelConnection,
    subject: subject(),
    assetUrl: async (a) => `https://signed.example/${a.filename}`,
    ...overrides,
  }
}

interface Call {
  method: string
  url: string
  json: Record<string, unknown> | null
  form: FormData | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function etsy(
  calls: Call[],
  options: {
    held?: { state?: string; images?: number; files?: number }
    missing?: boolean
    failAt?: "images" | "files" | "activate"
    failDelete?: boolean
  } = {},
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body
    const call: Call = {
      method,
      url,
      json: typeof body === "string" && body.startsWith("{") ? JSON.parse(body) : null,
      form: body instanceof FormData ? body : null,
    }
    calls.push(call)

    if (url.startsWith("https://signed.example/"))
      return new Response(new Blob(["bytes"]), { status: 200 })
    if (url.endsWith("/public/oauth/token"))
      return json({ access_token: "1.new", expires_in: 3600, refresh_token: "1.newref" })

    if (/\/listings$/.test(url) && method === "POST")
      return json({ listing_id: 900, state: "draft", url: null })
    if (/\/listings\/900\/images$/.test(url)) {
      if (options.failAt === "images") return json({ error: "Image too small" }, 400)
      return json({ listing_image_id: 10 + calls.filter((c) => c.url.endsWith("/images")).length })
    }
    if (/\/listings\/900\/files$/.test(url) && method === "POST") {
      if (options.failAt === "files") return json({ error: "File too large" }, 400)
      return json({ listing_file_id: 20 })
    }
    if (/\/listings\/900\/files$/.test(url) && method === "GET") {
      return json({
        count: options.held?.files ?? 0,
        results: Array.from({ length: options.held?.files ?? 0 }, (_, i) => ({
          listing_file_id: 20 + i,
        })),
      })
    }
    if (/\/listings\/900$/.test(url) && method === "PATCH") {
      if (options.failAt === "activate" && call.json?.state === "active")
        return json({ error: "Listing needs an image" }, 400)
      return json({
        listing_id: 900,
        state: call.json?.state === "active" ? "active" : (options.held?.state ?? "draft"),
        url: "https://www.etsy.com/listing/900",
      })
    }
    if (/\/listings\/900$/.test(url) && method === "DELETE") {
      if (options.failDelete) return json({ error: "nope" }, 500)
      return new Response(null, { status: 204 })
    }
    if (/\/application\/listings\/900/.test(url) && method === "GET") {
      if (options.missing) return json({ error: "Listing not found" }, 404)
      return json({
        listing_id: 900,
        state: options.held?.state ?? "active",
        url: "https://www.etsy.com/listing/900",
        images: Array.from({ length: options.held?.images ?? 1 }, (_, i) => ({
          listing_image_id: 10 + i,
        })),
      })
    }
    return json({ error: `no route ${method} ${url}` }, 404)
  })
}

const fresh = () => ({
  accessToken: "1.tok",
  refreshToken: "1.ref",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  shopId: 777,
  userId: 1,
})

beforeEach(() => {
  process.env.ETSY_CLIENT_ID = "keystring-test"
  process.env.ETSY_CLIENT_SECRET = "secret-test"
  resetConfigCacheForTests()
  credentialsMock.read.mockReset()
  credentialsMock.read.mockResolvedValue(fresh())
  credentialsMock.store.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("declaration", () => {
  it("takes the file, needs no manual step, and holds nothing as a draft", () => {
    expect(etsyAdapter.capabilities.digitalFileUpload).toBe(true)
    expect(etsyAdapter.manualSteps).toEqual([])
    expect(etsyAdapter.capabilities.drafts).toBe(false)
    expect(etsyAdapter.oauth?.pkce).toBe(true)
  })

  it("defaults every product type to a category the requirement accepts", () => {
    for (const type of [
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
    ] as const) {
      const label = defaultCategoryLabel(type)
      expect(
        CATEGORIES.map((c) => c.label),
        type,
      ).toContain(label)
      expect(taxonomyId(label), type).toBeGreaterThan(0)
    }
    expect(taxonomyId("Nope")).toBeNull()
  })

  it("is ready with a title, price, category, image and a file under 20 MB", () => {
    const draft = etsyAdapter.buildListing(subject())
    const { readiness } = evaluate(etsyAdapter, draft, subject())
    expect(readiness.ready).toBe(true)
    const big = subject({
      assets: [
        asset(),
        asset({
          id: "a2",
          asset_type: "deliverable",
          filename: "big.zip",
          byte_size: 25 * 1024 * 1024,
        }),
      ],
    })
    const { readiness: notReady, results } = evaluate(etsyAdapter, draft, big)
    expect(notReady.ready).toBe(false)
    expect(results.find((r) => r.key === "deliverable")?.message).toContain("20 MB")
  })
})

describe("tags", () => {
  it("strips what Etsy refuses, deduplicates, and keeps twenty characters", () => {
    expect(
      toTags(["grotesque font", "sans & serif", "Grotesque Font", "a very long tag name indeed"]),
    ).toEqual(["grotesque font", "sans serif", "a very long tag name"])
  })
})

describe("publish", () => {
  it("creates a download draft, uploads the images and the file, and activates it", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", etsy(calls))

    const result = await etsyAdapter.publish!(context())

    const etsyCalls = calls.filter((c) => c.url.includes("api.etsy.com"))
    expect(
      etsyCalls.map((c) => `${c.method} ${c.url.replace("https://api.etsy.com/v3/", "")}`),
    ).toEqual([
      "POST application/shops/777/listings",
      "POST application/shops/777/listings/900/images",
      "POST application/shops/777/listings/900/files",
      "PATCH application/shops/777/listings/900",
    ])
    expect(etsyCalls[0]!.json).toMatchObject({
      title: "Aster Grotesk",
      description: "A grotesque in nine weights.\n\nDrawn for long text.",
      price: 48,
      taxonomy_id: 1875,
      tags: ["grotesque font", "sans serif"],
      type: "download",
      who_made: "i_did",
      quantity: 999,
    })
    expect(etsyCalls[1]!.form?.get("rank")).toBe("1")
    expect((etsyCalls[1]!.form?.get("image") as File).name).toBe("cover.png")
    expect((etsyCalls[2]!.form?.get("file") as File).name).toBe("aster.zip")
    expect(etsyCalls[3]!.json).toEqual({ state: "active" })
    expect(result).toMatchObject({
      externalListingId: "900",
      externalUrl: "https://www.etsy.com/listing/900",
      externalState: "live",
      purchasable: true,
    })
  })

  it("deletes the draft when a later step fails, so a retry starts clean", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", etsy(calls, { failAt: "files" }))

    await expect(etsyAdapter.publish!(context())).rejects.toMatchObject({
      normalized: { code: "validation_rejected", raw: { cleanup: "deleted" } },
    })
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/listings/900"))).toBe(true)
    expect(calls.some((c) => c.json?.state === "active")).toBe(false)
  })

  it("reports the orphan when the cleanup itself fails", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", etsy(calls, { failAt: "activate", failDelete: true }))
    await expect(etsyAdapter.publish!(context())).rejects.toMatchObject({
      normalized: { raw: { cleanup: { orphanedDraft: 900 } } },
    })
  })

  it("refuses before any call when the category is not one it knows", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", etsy(calls))
    await expect(
      etsyAdapter.publish!(context({ listing: listing({ category: "Yarn" }) })),
    ).rejects.toMatchObject({
      normalized: { code: "validation_rejected" },
    })
    expect(calls.filter((c) => c.url.includes("api.etsy.com"))).toHaveLength(0)
  })
})

describe("update", () => {
  it("reads first, keeps the state, and uploads only what the listing is short of", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", etsy(calls, { held: { state: "active", images: 0, files: 1 } }))

    const result = await etsyAdapter.update!(
      context({ listing: listing({ external_listing_id: "900" }) }),
    )

    const etsyCalls = calls.filter((c) => c.url.includes("api.etsy.com"))
    expect(etsyCalls[0]!.method).toBe("GET")
    const patch = etsyCalls.find((c) => c.method === "PATCH")!
    expect(patch.json).not.toHaveProperty("state")
    expect(etsyCalls.filter((c) => c.url.endsWith("/images") && c.method === "POST")).toHaveLength(
      1,
    )
    expect(etsyCalls.filter((c) => c.url.endsWith("/files") && c.method === "POST")).toHaveLength(0)
    expect(result.externalState).toBe("live")
  })

  it("raises external_object_missing when Etsy says the listing is gone", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", etsy(calls, { missing: true }))
    await expect(
      etsyAdapter.update!(context({ listing: listing({ external_listing_id: "900" }) })),
    ).rejects.toMatchObject({
      normalized: { code: "external_object_missing" },
    })
    expect(calls.some((c) => c.method === "PATCH")).toBe(false)
  })
})

describe("the token", () => {
  it("refreshes near expiry and re-seals what came back before the first shop call", async () => {
    credentialsMock.read.mockResolvedValue({
      ...fresh(),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    })
    const calls: Call[] = []
    vi.stubGlobal("fetch", etsy(calls))

    await etsyAdapter.update!(context({ listing: listing({ external_listing_id: "900" }) }))

    expect(calls[0]!.url).toBe("https://api.etsy.com/v3/public/oauth/token")
    expect(credentialsMock.store).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          accessToken: "1.new",
          refreshToken: "1.newref",
          shopId: 777,
        }),
      }),
    )
  })

  it("asks for a reconnect when the connection is short a scope", async () => {
    await expect(
      etsyAdapter.publish!(
        context({
          connection: {
            id: "c",
            workspace_id: "w",
            external_account_id: "777",
            scopes: ["listings_r"],
          } as unknown as ChannelConnection,
        }),
      ),
    ).rejects.toMatchObject({ normalized: { code: "permission_denied" } })
  })
})
