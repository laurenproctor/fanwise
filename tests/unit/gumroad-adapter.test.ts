import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const credentialsMock = vi.hoisted(() => ({
  read: vi.fn(),
}))
vi.mock("@/lib/credentials", () => ({
  readConnectionCredentials: credentialsMock.read,
  storeConnectionCredentials: vi.fn(async () => {}),
}))

import { gumroadAdapter, THUMBNAIL_SPEC } from "@/lib/channels/adapters/gumroad"
import {
  CATEGORIES,
  categoryPath,
  defaultCategoryLabel,
} from "@/lib/channels/adapters/gumroad/categories"
import { createGumroadClient } from "@/lib/channels/adapters/gumroad/client"
import { resetConfigCacheForTests } from "@/lib/channels/adapters/gumroad/config"
import { toPermalink, toPrice, toTags } from "@/lib/channels/adapters/gumroad/transform"
import { evaluate, resolveDraft } from "@/lib/channels/listings"
import type {
  AdapterSubject,
  ChannelConnection,
  ChannelListing,
  PublishContext,
} from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"
import { z } from "zod"

/**
 * The Gumroad adapter, with Gumroad replaced by a fetch that answers from a
 * script. What is proved is Fanwise's side of the wire: a publish uploads the
 * file in parts, creates a draft, sends covers and a thumbnail, enables, and
 * reads back before reporting live; a refusal that arrives as HTTP 200 is a
 * refusal; a failure after the draft deletes it; an update reads first, keeps
 * the state, never resends the permalink, and never replaces files it cannot
 * account for; and a deleted product is raised by the one code the runner
 * acts on.
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
    description: "A grotesque in **nine** weights.\n\nDrawn for long text.",
    short_description: "Nine weights, one family.",
    price: 48,
    currency: "USD",
    category: "Fonts",
    seo_title: null,
    seo_description: null,
    tags: ["Grotesque Font", "sans, serif", "#type", "grotesque font"],
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
    created_at: "2026-09-16T00:00:00Z",
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
      asset({ id: "asset-2", asset_type: "deliverable", filename: "aster.zip", byte_size: 5 }),
    ],
    connectionMetadata: {},
    ...overrides,
  }
}

function context(overrides: Partial<PublishContext> = {}): PublishContext {
  return {
    listing: listing(),
    connection: {
      id: "conn-1",
      workspace_id: "ws-1",
      external_account_id: "G_1",
      metadata: {},
      scopes: ["edit_products"],
    } as unknown as ChannelConnection,
    subject: subject(),
    assetUrl: async (a) => `https://signed.example/${a.filename}`,
    deliveryUrl: async (a) => `https://fanwise.test/api/public/delivery/token-${a.id}`,
    derivativeUrl: async (a, spec) => `https://signed.example/${spec.key}/${a.filename}`,
    ...overrides,
  }
}

interface Call {
  method: string
  url: string
  json: Record<string, unknown> | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const FILE_URL = "https://gumroad-specials.s3.amazonaws.com/attachments/G_1/abc/original/aster.zip"

function gumroad(
  calls: Call[],
  options: {
    held?: { published?: boolean; covers?: number; files?: string[] }
    missing?: boolean
    failAt?: "covers" | "enable" | "thumbnail" | "complete"
    failDelete?: boolean
  } = {},
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body
    calls.push({
      method,
      url,
      json: typeof body === "string" && body.startsWith("{") ? JSON.parse(body) : null,
    })

    if (url.startsWith("https://signed.example/"))
      return new Response(new Blob(["bytes"]), { status: 200 })
    if (url.startsWith("https://s3.example/part/"))
      return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } })

    const api = url.replace("https://api.gumroad.com/v2/", "")
    if (api === "files/presign") {
      return json({
        success: true,
        upload_id: "up-1",
        key: "attachments/G_1/abc/original/aster.zip",
        file_url: FILE_URL,
        parts: [{ part_number: 1, presigned_url: "https://s3.example/part/1" }],
      })
    }
    if (api === "files/complete") {
      if (options.failAt === "complete") return json({ status: 400, error: "NoSuchUpload" }, 400)
      return json({ success: true, file_url: FILE_URL })
    }
    if (api === "files/abort") return json({ success: true, status: "already_gone" })

    const held = options.held ?? {}
    // What Gumroad holds before any files PUT, then one more after it: the
    // update test attaches a second file and reads the id back.
    const replaced = calls.some(
      (c) => c.method === "PUT" && c.url.endsWith("/products/P1") && c.json?.files,
    )
    const heldFiles = [...(held.files ?? ["F1"]), ...(replaced ? ["F2"] : [])].map((id) => ({
      id,
      name: "aster",
    }))
    const heldCovers = Array.from({ length: held.covers ?? 1 }, (_, i) => ({ id: `C${i + 1}` }))
    const productBody = (published: boolean) =>
      json({
        success: true,
        product: {
          id: "P1",
          name: "Aster Grotesk",
          published,
          short_url: "https://astertype.gumroad.com/l/aster-grotesk",
          custom_permalink: "aster-grotesk",
          files: heldFiles,
          covers: heldCovers,
        },
      })

    if (api === "products" && method === "POST") return productBody(false)
    if (api === "products/P1/covers" && method === "POST") {
      if (options.failAt === "covers")
        return json({ success: false, message: "Could not process your cover, please try again." })
      const sent = calls.filter((c) => c.url.endsWith("/covers")).length
      return json({
        success: true,
        covers: Array.from({ length: sent }, (_, i) => ({ id: `C${i + 1}` })),
        main_cover_id: "C1",
      })
    }
    if (api === "products/P1/thumbnail" && method === "POST") {
      if (options.failAt === "thumbnail")
        return json({
          success: false,
          message:
            "Could not process your thumbnail, please upload an image with size smaller than 5 MB.",
        })
      return json({ success: true, thumbnail: { url: "https://public-files.gumroad.com/t" } })
    }
    if (api === "products/P1/enable" && method === "PUT") {
      if (options.failAt === "enable")
        return json({
          success: false,
          message: "You have to confirm your email address before you can do that.",
        })
      return productBody(true)
    }
    if (api === "products/P1" && method === "GET") {
      if (options.missing) return json({ success: false, message: "The product was not found." })
      return productBody(held.published ?? true)
    }
    if (api === "products/P1" && method === "PUT") return productBody(held.published ?? true)
    if (api === "products/P1" && method === "DELETE") {
      if (options.failDelete) return json({ success: false, message: "nope" }, 500)
      return json({ success: true, message: "The product has been deleted successfully." })
    }
    return json({ success: false, message: `no route ${method} ${url}` }, 404)
  })
}

const apiCalls = (calls: Call[]) =>
  calls
    .filter((c) => c.url.includes("api.gumroad.com"))
    .map((c) => `${c.method} ${c.url.replace("https://api.gumroad.com/v2/", "")}`)

beforeEach(() => {
  process.env.GUMROAD_CLIENT_ID = "app-id-test"
  process.env.GUMROAD_CLIENT_SECRET = "app-secret-test"
  resetConfigCacheForTests()
  credentialsMock.read.mockReset()
  credentialsMock.read.mockResolvedValue({ accessToken: "tok-1", refreshToken: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("declaration", () => {
  it("takes the file, needs no manual step, holds nothing as a draft, and paces its creates", () => {
    expect(gumroadAdapter.capabilities.digitalFileUpload).toBe(true)
    expect(gumroadAdapter.manualSteps).toEqual([])
    expect(gumroadAdapter.capabilities.drafts).toBe(false)
    expect(gumroadAdapter.oauth?.pkce).toBe(true)
    expect(gumroadAdapter.oauth?.revoke).toBeTypeOf("function")
    expect(gumroadAdapter.pace).toEqual({ queue: "paced_creates", minIntervalMs: 10_000 })
    expect(THUMBNAIL_SPEC).toMatchObject({ width: 1200, height: 1200, format: "jpeg" })
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
      expect(categoryPath(label), type).not.toBeUndefined()
    }
    expect(categoryPath("Fonts")).toBe("design/fonts")
    expect(categoryPath("Other")).toBeNull()
    expect(categoryPath("Yarn")).toBeUndefined()
  })

  it("is ready with a title, a supported currency, a price at the minimum, and a file", () => {
    const draft = resolveDraft(gumroadAdapter.buildListing(subject()), product, gumroadAdapter)
    const { readiness } = evaluate(gumroadAdapter, draft, subject())
    expect(readiness.ready).toBe(true)

    const cheap = evaluate(gumroadAdapter, { ...draft, price: 0.5 }, subject())
    expect(cheap.readiness.ready).toBe(false)
    expect(cheap.results.find((r) => r.key === "price")?.message).toContain("0.99")

    const free = evaluate(gumroadAdapter, { ...draft, price: 0 }, subject())
    expect(free.readiness.ready).toBe(true)

    const exotic = evaluate(gumroadAdapter, { ...draft, currency: "SEK" }, subject())
    expect(exotic.readiness.blocking.map((r) => r.key)).toContain("currency_supported")

    const badTag = evaluate(gumroadAdapter, { ...draft, tags: ["ok tag", "#no"] }, subject())
    expect(badTag.readiness.blocking.map((r) => r.key)).toContain("tags")

    const noFile = evaluate(gumroadAdapter, draft, subject({ assets: [asset()] }))
    expect(noFile.readiness.blocking.map((r) => r.key)).toContain("deliverable")
  })
})

describe("transforms", () => {
  it("lowercases tags, drops commas and hashes, deduplicates and keeps twenty characters", () => {
    expect(
      toTags([
        "Grotesque Font",
        "sans, serif",
        "#type",
        "grotesque font",
        "a",
        "a very long tag name indeed",
      ]),
    ).toEqual(["grotesque font", "sans serif", "type", "a very long tag name"])
  })

  it("prices in the smallest unit, which is the unit itself for yen", () => {
    expect(toPrice(48, "USD")).toBe(4800)
    expect(toPrice(12.5, "eur")).toBe(1250)
    expect(toPrice(1000, "JPY")).toBe(1000)
    expect(toPrice(null, "USD")).toBeNull()
  })

  it("accepts a slug as a permalink only in Gumroad's alphabet", () => {
    expect(toPermalink("aster-grotesk_2")).toBe("aster-grotesk_2")
    expect(toPermalink("aster grotesk")).toBeNull()
  })
})

describe("the client", () => {
  it("treats a 200 that says no as a refusal, and a 401 as a dead credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/refused")
          ? json({ success: false, message: "Name can't be blank." })
          : new Response("", { status: 401 }),
      ),
    )
    const client = createGumroadClient({ accessToken: "t" })
    await expect(
      client.request({ method: "GET", path: "refused", schema: z.unknown() }),
    ).rejects.toMatchObject({
      normalized: {
        code: "validation_rejected",
        message: "Gumroad rejected this: Name can't be blank.",
      },
    })
    await expect(
      client.request({ method: "GET", path: "dead", schema: z.unknown() }),
    ).rejects.toMatchObject({ normalized: { code: "credentials_invalid" } })
  })

  it("waits as long as a 429 asks before trying again", async () => {
    let attempts = 0
    const waits: number[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1
        return attempts === 1
          ? new Response("", { status: 429, headers: { "Retry-After": "7" } })
          : json({ success: true, ok: true })
      }),
    )
    const client = createGumroadClient({
      accessToken: "t",
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    await client.request({ method: "GET", path: "x", schema: z.object({ ok: z.boolean() }) })
    expect(waits).toEqual([7000])
  })
})

describe("publish", () => {
  it("uploads the file in parts, creates a draft, sends covers and a thumbnail, enables, and reads back", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", gumroad(calls))

    const result = await gumroadAdapter.publish!(context())

    expect(apiCalls(calls)).toEqual([
      "POST files/presign",
      "POST files/complete",
      "POST products",
      "POST products/P1/covers",
      "POST products/P1/thumbnail",
      "PUT products/P1/enable",
      "GET products/P1",
    ])
    const part = calls.find((c) => c.url.startsWith("https://s3.example/part/1"))
    expect(part?.method).toBe("PUT")
    expect(calls.find((c) => c.url.endsWith("files/complete"))?.json).toEqual({
      upload_id: "up-1",
      key: "attachments/G_1/abc/original/aster.zip",
      parts: [{ part_number: 1, etag: '"etag-1"' }],
    })

    const create = calls.find((c) => c.url.endsWith("/products") && c.method === "POST")!.json!
    expect(create).toMatchObject({
      name: "Aster Grotesk",
      description:
        "<p>A grotesque in <strong>nine</strong> weights.</p><p>Drawn for long text.</p>",
      custom_summary: "Nine weights, one family.",
      price: 4800,
      price_currency_type: "usd",
      category: "design/fonts",
      tags: ["grotesque font", "sans serif", "type"],
      native_type: "digital",
      draft: true,
      custom_permalink: "aster-grotesk",
      files: [{ url: FILE_URL }],
    })
    expect(calls.find((c) => c.url.endsWith("/covers"))?.json).toEqual({
      url: "https://signed.example/cover.png",
    })
    expect(calls.find((c) => c.url.endsWith("/thumbnail"))?.json).toEqual({
      url: "https://signed.example/square-1200/cover.png",
    })

    expect(result).toMatchObject({
      externalListingId: "P1",
      externalUrl: "https://astertype.gumroad.com/l/aster-grotesk",
      publicUrl: "https://astertype.gumroad.com/l/aster-grotesk",
      externalState: "live",
      purchasable: true,
      listingMetadata: {
        permalink: "aster-grotesk",
        coverIds: ["C1"],
        files: [{ assetId: "asset-2", fileId: "F1", fileUrl: FILE_URL }],
      },
    })
  })

  it("goes live without a thumbnail when the runner cannot make one or Gumroad refuses it", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", gumroad(calls, { failAt: "thumbnail" }))
    const refused = await gumroadAdapter.publish!(context())
    expect(refused.externalState).toBe("live")
    expect(refused.providerResponse).toMatchObject({
      thumbnail: { skipped: "validation_rejected" },
    })

    const withoutRunner: Call[] = []
    vi.stubGlobal("fetch", gumroad(withoutRunner))
    const ctx = context()
    delete ctx.derivativeUrl
    const skipped = await gumroadAdapter.publish!(ctx)
    expect(apiCalls(withoutRunner)).not.toContain("POST products/P1/thumbnail")
    expect(skipped.providerResponse).toMatchObject({ thumbnail: "skipped" })
  })

  it("deletes the draft when a later step fails, so a retry starts clean", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", gumroad(calls, { failAt: "covers" }))

    await expect(gumroadAdapter.publish!(context())).rejects.toMatchObject({
      normalized: { code: "validation_rejected", raw: { cleanup: "deleted" } },
    })
    expect(apiCalls(calls)).toContain("DELETE products/P1")
    expect(apiCalls(calls)).not.toContain("PUT products/P1/enable")
  })

  it("turns an enable refused for an unconfirmed email into a sentence the creator can act on", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", gumroad(calls, { failAt: "enable", failDelete: true }))

    await expect(gumroadAdapter.publish!(context())).rejects.toMatchObject({
      normalized: {
        code: "validation_rejected",
        message: expect.stringContaining("email address is confirmed"),
        raw: { cleanup: { orphanedDraft: "P1" } },
      },
    })
  })

  it("aborts the upload and creates nothing when the upload cannot complete", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", gumroad(calls, { failAt: "complete" }))

    await expect(gumroadAdapter.publish!(context())).rejects.toMatchObject({
      normalized: { code: "validation_rejected" },
    })
    expect(apiCalls(calls)).toContain("POST files/abort")
    expect(apiCalls(calls)).not.toContain("POST products")
  })

  it("refuses before any call when the currency or the slug is one Gumroad cannot take", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", gumroad(calls))
    await expect(
      gumroadAdapter.publish!(context({ listing: listing({ currency: "SEK" }) })),
    ).rejects.toMatchObject({ normalized: { code: "validation_rejected" } })
    await expect(
      gumroadAdapter.publish!(
        context({
          subject: subject({ product: { ...product, slug: "aster grotesk" } as Product }),
        }),
      ),
    ).rejects.toMatchObject({ normalized: { code: "validation_rejected" } })
    expect(calls).toHaveLength(0)
  })

  it("asks for a reconnect when the connection is short a scope", async () => {
    await expect(
      gumroadAdapter.publish!(
        context({
          connection: {
            id: "c",
            workspace_id: "w",
            external_account_id: "G_1",
            scopes: ["view_public"],
          } as unknown as ChannelConnection,
        }),
      ),
    ).rejects.toMatchObject({ normalized: { code: "permission_denied" } })
  })
})

describe("update", () => {
  const published = (metadata: Record<string, unknown> = {}) =>
    listing({
      external_listing_id: "P1",
      metadata: {
        externalState: "live",
        files: [{ assetId: "asset-2", fileId: "F1", fileUrl: FILE_URL }],
        ...metadata,
      },
    })

  it("reads first, keeps the state, leaves the permalink and the files alone, and adds missing covers", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", gumroad(calls, { held: { published: true, covers: 0 } }))

    const result = await gumroadAdapter.update!(context({ listing: published() }))

    expect(apiCalls(calls)).toEqual([
      "GET products/P1",
      "PUT products/P1",
      "POST products/P1/covers",
    ])
    const put = calls.find((c) => c.method === "PUT")!.json!
    expect(put).not.toHaveProperty("custom_permalink")
    expect(put).not.toHaveProperty("files")
    expect(put).not.toHaveProperty("draft")
    expect(put).toMatchObject({ name: "Aster Grotesk", price: 4800 })
    expect(result.externalState).toBe("live")
    expect(result.listingMetadata).toMatchObject({
      files: [{ assetId: "asset-2", fileId: "F1", fileUrl: FILE_URL }],
    })
  })

  it("uploads a new file and resends every known one by id and canonical url", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", gumroad(calls))
    const withSecond = subject({
      assets: [
        asset(),
        asset({ id: "asset-2", asset_type: "deliverable", filename: "aster.zip", byte_size: 5 }),
        asset({
          id: "asset-3",
          asset_type: "archive",
          filename: "extras.zip",
          byte_size: 5,
          sort_order: 1,
        }),
      ],
    })

    const result = await gumroadAdapter.update!(
      context({ listing: published(), subject: withSecond }),
    )

    const puts = calls.filter((c) => c.method === "PUT" && c.url.endsWith("/products/P1"))
    expect(puts).toHaveLength(2)
    expect(puts[1]!.json).toEqual({
      files: [{ id: "F1", url: FILE_URL }, { url: FILE_URL }],
    })
    expect(result.listingMetadata).toMatchObject({
      files: [
        { assetId: "asset-2", fileId: "F1" },
        { assetId: "asset-3", fileId: "F2" },
      ],
    })
  })

  it("refuses to replace files it cannot account for, because a wrong guess deletes the buyer's download", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", gumroad(calls, { held: { files: ["F9"] } }))
    const withSecond = subject({
      assets: [
        asset({ id: "asset-2", asset_type: "deliverable", filename: "aster.zip", byte_size: 5 }),
        asset({ id: "asset-3", asset_type: "archive", filename: "extras.zip", byte_size: 5 }),
      ],
    })
    await expect(
      gumroadAdapter.update!(context({ listing: published(), subject: withSecond })),
    ).rejects.toMatchObject({ normalized: { code: "validation_rejected" } })
    expect(apiCalls(calls)).not.toContain("POST files/presign")
  })

  it("raises external_object_missing when Gumroad says the product is gone", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", gumroad(calls, { missing: true }))
    await expect(gumroadAdapter.update!(context({ listing: published() }))).rejects.toMatchObject({
      normalized: { code: "external_object_missing" },
    })
    expect(calls.some((c) => c.method === "PUT")).toBe(false)
  })
})
