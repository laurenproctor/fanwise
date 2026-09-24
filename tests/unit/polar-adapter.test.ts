import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const credentialsMock = vi.hoisted(() => ({
  read: vi.fn(),
  store: vi.fn(async () => {}),
}))
vi.mock("@/lib/credentials", () => ({
  readConnectionCredentials: credentialsMock.read,
  storeConnectionCredentials: credentialsMock.store,
}))

import { polarAdapter, IMAGE_POLICY } from "@/lib/channels/adapters/polar"
import { createPolarClient } from "@/lib/channels/adapters/polar/client"
import { resetConfigCacheForTests } from "@/lib/channels/adapters/polar/config"
import {
  imageMimeType,
  toBenefitDescription,
  toName,
  toPrice,
} from "@/lib/channels/adapters/polar/transform"
import { declareParts } from "@/lib/channels/adapters/polar/upload"
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
 * The Polar adapter, with Polar replaced by a fetch that answers from a
 * script. What is proved is Fanwise's side of the wire: a publish searches
 * for its stamp, uploads the file and the image in parts, creates the
 * benefit, creates the product as a draft with the stamp in its metadata,
 * attaches the benefit, creates the checkout link, makes the product public,
 * and reads back before reporting live; a publish that finds its stamp
 * resumes rather than creates; an update reads first, keeps visibility,
 * keeps the seller's other benefits and prices, and sends only what the
 * product is short of; a token near expiry is refreshed and re-sealed; and a
 * deleted product is raised by the one code the runner acts on.
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
    short_description: null,
    price: 48,
    currency: "USD",
    category: null,
    seo_title: null,
    seo_description: null,
    tags: [],
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
    mime_type: "image/png",
    byte_size: 1000,
    sort_order: 0,
    created_at: "2026-09-23T00:00:00Z",
    derived_from: null,
    metadata: {},
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
      asset({
        id: "asset-2",
        asset_type: "deliverable",
        filename: "aster.zip",
        mime_type: "application/zip",
        byte_size: 5,
      }),
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
      external_account_id: "org-1",
      metadata: {},
      scopes: [
        "organizations:read",
        "products:read",
        "products:write",
        "files:write",
        "benefits:write",
        "checkout_links:read",
        "checkout_links:write",
      ],
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
  headers: Record<string, string>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const API = "https://api.polar.sh/v1/"
const CHECKOUT_URL = "https://buy.polar.sh/polar_cl_1"

interface Held {
  visibility?: "draft" | "private" | "public"
  archived?: boolean
  stamped?: boolean
  benefits?: { id: string; type: string }[]
  prices?: { id: string; amount_type: string; price_currency?: string; price_amount?: number }[]
  medias?: string[]
  links?: boolean
}

/**
 * A Polar that holds one product, P1, when `held` is given, and creates it
 * otherwise. Files are numbered as they are created; benefits and links too.
 */
function polar(
  calls: Call[],
  options: { held?: Held; missing?: boolean; failAt?: "benefit" | "link" | "part" } = {},
) {
  let files = 0
  let benefits = 0
  let links = 0
  let product: Record<string, unknown> | null = null
  const held = options.held
  if (held) {
    product = {
      id: "P1",
      name: "Aster Grotesk",
      visibility: held.visibility ?? "public",
      is_archived: held.archived ?? false,
      metadata: held.stamped === false ? {} : { fanwise_listing_id: "listing-1" },
      prices: held.prices ?? [
        { id: "PR1", amount_type: "fixed", price_currency: "usd", price_amount: 4800 },
      ],
      benefits: held.benefits ?? [{ id: "B1", type: "downloadables" }],
      medias: (held.medias ?? ["F2"]).map((id) => ({ id, public_url: `https://cdn/${id}` })),
    }
  }

  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body
    calls.push({
      method,
      url,
      json: typeof body === "string" && body.startsWith("{") ? JSON.parse(body) : null,
      headers: (init?.headers as Record<string, string>) ?? {},
    })

    if (url.startsWith("https://signed.example/"))
      return new Response(new Blob(["bytes"]), { status: 200 })
    if (url.startsWith("https://s3.example/part/")) {
      if (options.failAt === "part") return new Response(null, { status: 403 })
      return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } })
    }

    const api = url.replace(API, "")
    const [path, search] = api.split("?")
    const query = new URLSearchParams(search ?? "")

    if (path === "files" && method === "POST") {
      files += 1
      const id = `F${files}`
      const parts = (calls.at(-1)!.json!.upload as { parts: { number: number }[] }).parts
      return json(
        {
          id,
          path: `org-1/${id}`,
          upload: {
            id: `up-${id}`,
            path: `org-1/${id}`,
            parts: parts.map((p) => ({
              ...p,
              url: `https://s3.example/part/${id}/${p.number}`,
              expires_at: "2026-09-23T01:00:00Z",
              headers: { "x-amz-meta-test": "1" },
            })),
          },
        },
        201,
      )
    }
    if (/^files\/F\d+\/uploaded$/.test(path!) && method === "POST") {
      return json({ id: path!.split("/")[1], is_uploaded: true })
    }
    if (path === "benefits" && method === "POST") {
      if (options.failAt === "benefit")
        return json(
          { detail: [{ loc: ["body", "description"], msg: "String too long", type: "x" }] },
          422,
        )
      benefits += 1
      return json({ id: `B${benefits}`, type: "downloadables" }, 201)
    }
    if (/^benefits\/B\d+$/.test(path!) && method === "PATCH") {
      return json({ id: path!.split("/")[1], type: "downloadables" })
    }
    if (path === "products" && method === "GET") {
      const stamped = product && (product.metadata as Record<string, unknown>).fanwise_listing_id
      const wanted = query.get("metadata[fanwise_listing_id]")
      return json({
        items: product && stamped === wanted ? [product] : [],
        pagination: { total_count: 0, max_page: 1 },
      })
    }
    if (path === "products" && method === "POST") {
      const sent = calls.at(-1)!.json!
      product = {
        id: "P1",
        name: sent.name,
        visibility: sent.visibility,
        is_archived: false,
        metadata: sent.metadata,
        prices: [{ id: "PR1", amount_type: "fixed", price_currency: "usd", price_amount: 4800 }],
        benefits: [],
        medias: (sent.medias as string[]).map((id) => ({ id, public_url: `https://cdn/${id}` })),
      }
      return json(product, 201)
    }
    if (path === "products/P1" && method === "GET") {
      if (options.missing || !product)
        return json({ error: "ResourceNotFound", detail: "Product not found." }, 404)
      return json(product)
    }
    if (path === "products/P1" && method === "PATCH") {
      const sent = calls.at(-1)!.json!
      product = {
        ...product!,
        ...(sent.name ? { name: sent.name } : {}),
        ...(sent.visibility ? { visibility: sent.visibility } : {}),
        ...(sent.medias
          ? {
              medias: (sent.medias as string[]).map((id) => ({
                id,
                public_url: `https://cdn/${id}`,
              })),
            }
          : {}),
      }
      return json(product)
    }
    if (path === "products/P1/benefits" && method === "POST") {
      const sent = calls.at(-1)!.json!.benefits as string[]
      product = { ...product!, benefits: sent.map((id) => ({ id, type: "downloadables" })) }
      return json(product)
    }
    if (path === "checkout-links" && method === "GET") {
      return json({
        items: held?.links ? [{ id: "CL1", url: CHECKOUT_URL }] : [],
        pagination: { total_count: 0, max_page: 1 },
      })
    }
    if (path === "checkout-links" && method === "POST") {
      if (options.failAt === "link") return new Response("", { status: 500 })
      links += 1
      return json({ id: `CL${links}`, url: CHECKOUT_URL }, 201)
    }
    return json({ error: "ResourceNotFound", detail: `no route ${method} ${url}` }, 404)
  })
}

const apiCalls = (calls: Call[]) =>
  calls
    .filter((c) => c.url.startsWith(API))
    .map((c) => `${c.method} ${c.url.replace(API, "").split("?")[0]}`)

const FRESH = {
  accessToken: "polar_at_1",
  refreshToken: "polar_rt_1",
  expiresAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(),
}

beforeEach(() => {
  process.env.POLAR_CLIENT_ID = "client-id-test"
  process.env.POLAR_CLIENT_SECRET = "client-secret-test"
  delete process.env.POLAR_ENVIRONMENT
  resetConfigCacheForTests()
  credentialsMock.read.mockReset()
  credentialsMock.store.mockClear()
  credentialsMock.read.mockResolvedValue(FRESH)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("declaration", () => {
  it("takes the file, needs no manual step, holds nothing as a draft, and has no tags or category", () => {
    expect(polarAdapter.capabilities.digitalFileUpload).toBe(true)
    expect(polarAdapter.manualSteps).toEqual([])
    expect(polarAdapter.capabilities.drafts).toBe(false)
    expect(polarAdapter.fields).toEqual(["title", "description", "price"])
    expect(polarAdapter.oauth?.pkce).toBe(true)
    expect(polarAdapter.oauth?.revoke).toBeTypeOf("function")
    expect(polarAdapter.pace).toBeUndefined()
    expect(IMAGE_POLICY.accepts).toContain("image/webp")
  })

  it("is ready with a title, a supported currency, a price at the minimum, and a file", () => {
    const draft = resolveDraft(polarAdapter.buildListing(subject()), product, polarAdapter)
    const { readiness } = evaluate(polarAdapter, draft, subject())
    expect(readiness.ready).toBe(true)

    const cheap = evaluate(polarAdapter, { ...draft, price: 0.25 }, subject())
    expect(cheap.readiness.ready).toBe(false)
    expect(cheap.results.find((r) => r.key === "price")?.message).toContain("0.5")

    const free = evaluate(polarAdapter, { ...draft, price: 0 }, subject())
    expect(free.readiness.ready).toBe(true)

    const exotic = evaluate(polarAdapter, { ...draft, currency: "XXX" }, subject())
    expect(exotic.readiness.blocking.map((r) => r.key)).toContain("currency_supported")

    const longTitle = evaluate(polarAdapter, { ...draft, title: "x".repeat(65) }, subject())
    expect(longTitle.readiness.blocking.map((r) => r.key)).toContain("title")

    const noFile = evaluate(polarAdapter, draft, subject({ assets: [asset()] }))
    expect(noFile.readiness.blocking.map((r) => r.key)).toContain("deliverable")
  })
})

describe("transforms", () => {
  it("prices in the smallest unit, which is the unit itself for yen", () => {
    expect(toPrice(48, "USD")).toBe(4800)
    expect(toPrice(12.5, "eur")).toBe(1250)
    expect(toPrice(1000, "JPY")).toBe(1000)
    expect(toPrice(null, "USD")).toBeNull()
  })

  it("keeps a name inside 3 to 64 characters and a benefit label inside 42", () => {
    expect(toName("  Aster Grotesk  ")).toBe("Aster Grotesk")
    expect(toName("x".repeat(80))).toHaveLength(64)
    expect(toName("A")).toBe("A..")
    expect(toBenefitDescription("Aster Grotesk")).toBe("Aster Grotesk files")
    expect(toBenefitDescription("x".repeat(80))).toHaveLength(42)
  })

  it("names an image's type from the rendition's extension", () => {
    expect(imageMimeType("cover.jpg")).toBe("image/jpeg")
    expect(imageMimeType("cover.WEBP")).toBe("image/webp")
    expect(imageMimeType("cover.tiff")).toBeNull()
  })

  it("declares parts as end-exclusive byte ranges numbered from one", () => {
    expect(declareParts(25, 10)).toEqual([
      { number: 1, chunk_start: 0, chunk_end: 10 },
      { number: 2, chunk_start: 10, chunk_end: 20 },
      { number: 3, chunk_start: 20, chunk_end: 25 },
    ])
    expect(declareParts(10, 10)).toEqual([{ number: 1, chunk_start: 0, chunk_end: 10 }])
  })
})

describe("the client", () => {
  it("pins the API version, turns a 422 into the field's sentence, and a 401 into a dead credential", async () => {
    const headers: Record<string, string>[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        headers.push((init?.headers as Record<string, string>) ?? {})
        return String(input).endsWith("/refused")
          ? json({ detail: [{ loc: ["body", "name"], msg: "String too short", type: "x" }] }, 422)
          : json({ error: "invalid_token", error_description: "expired" }, 401)
      }),
    )
    const client = createPolarClient({ accessToken: "t" })
    await expect(
      client.request({ method: "GET", path: "refused", schema: z.unknown() }),
    ).rejects.toMatchObject({
      normalized: {
        code: "validation_rejected",
        message: "Polar rejected this: name: String too short.",
      },
    })
    await expect(
      client.request({ method: "GET", path: "dead", schema: z.unknown() }),
    ).rejects.toMatchObject({ normalized: { code: "credentials_invalid" } })
    expect(headers[0]!["Polar-Version"]).toBe("2026-04")
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
          : json({ ok: true })
      }),
    )
    const client = createPolarClient({
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
  it("searches for its stamp, uploads, creates the benefit and the draft, attaches, links, goes public, and reads back", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", polar(calls))

    const result = await polarAdapter.publish!(context())

    expect(apiCalls(calls)).toEqual([
      "GET products",
      "POST files",
      "POST files/F1/uploaded",
      "POST files",
      "POST files/F2/uploaded",
      "POST benefits",
      "POST products",
      "POST products/P1/benefits",
      "GET checkout-links",
      "POST checkout-links",
      "PATCH products/P1",
      "GET products/P1",
    ])

    const search = calls[0]!
    expect(new URL(search.url).searchParams.get("metadata[fanwise_listing_id]")).toBe("listing-1")

    const fileCreate = calls.find((c) => c.url === `${API}files` && c.method === "POST")!.json!
    expect(fileCreate).toMatchObject({
      organization_id: "org-1",
      service: "downloadable",
      name: "aster.zip",
      mime_type: "application/zip",
      size: 5,
      upload: { parts: [{ number: 1, chunk_start: 0, chunk_end: 5 }] },
    })
    const part = calls.find((c) => c.url.startsWith("https://s3.example/part/F1/1"))!
    expect(part.method).toBe("PUT")
    expect(part.headers["x-amz-meta-test"]).toBe("1")
    expect(calls.find((c) => c.url.endsWith("files/F1/uploaded"))?.json).toEqual({
      id: "up-F1",
      path: "org-1/F1",
      parts: [{ number: 1, checksum_etag: '"etag-1"', checksum_sha256_base64: null }],
    })

    const media = calls.filter((c) => c.url === `${API}files` && c.method === "POST")[1]!.json!
    expect(media).toMatchObject({
      service: "product_media",
      name: "cover.png",
      mime_type: "image/png",
    })

    expect(
      calls.find(
        (c) => c.url.endsWith("/benefits") && c.method === "POST" && !c.url.includes("products"),
      )?.json,
    ).toEqual({
      type: "downloadables",
      description: "Aster Grotesk files",
      organization_id: "org-1",
      properties: { files: ["F1"] },
    })

    const create = calls.find((c) => c.url === `${API}products` && c.method === "POST")!.json!
    expect(create).toEqual({
      organization_id: "org-1",
      name: "Aster Grotesk",
      description: "A grotesque in **nine** weights.\n\nDrawn for long text.",
      visibility: "draft",
      recurring_interval: null,
      prices: [{ amount_type: "fixed", price_currency: "usd", price_amount: 4800 }],
      medias: ["F2"],
      metadata: { fanwise_listing_id: "listing-1" },
    })
    expect(calls.find((c) => c.url.endsWith("products/P1/benefits"))?.json).toEqual({
      benefits: ["B1"],
    })
    expect(
      calls.find((c) => c.url === `${API}checkout-links` && c.method === "POST")?.json,
    ).toEqual({
      payment_processor: "stripe",
      products: ["P1"],
      label: "Aster Grotesk",
      allow_discount_codes: true,
      metadata: { fanwise_listing_id: "listing-1" },
    })
    expect(calls.find((c) => c.method === "PATCH")?.json).toEqual({ visibility: "public" })

    expect(result).toMatchObject({
      externalListingId: "P1",
      externalUrl: CHECKOUT_URL,
      publicUrl: CHECKOUT_URL,
      externalState: "live",
      purchasable: true,
      listingMetadata: {
        files: [{ assetId: "asset-2", fileId: "F1" }],
        medias: [{ assetId: "asset-1", fileId: "F2" }],
        benefitId: "B1",
        checkoutLinkId: "CL1",
        checkoutUrl: CHECKOUT_URL,
      },
    })
    expect(result.providerResponse).toMatchObject({ resumed: false })
  })

  it("sends a cover as a rendition when Polar would refuse the source's format", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", polar(calls))

    await polarAdapter.publish!(
      context({
        subject: subject({
          assets: [
            asset({ mime_type: "image/tiff", filename: "cover.tiff" }),
            asset({
              id: "asset-2",
              asset_type: "deliverable",
              filename: "aster.zip",
              mime_type: "application/zip",
              byte_size: 5,
            }),
          ],
        }),
      }),
    )

    expect(calls.some((c) => c.url === "https://signed.example/fit-2560-jpeg/cover.tiff")).toBe(
      true,
    )
    const media = calls.filter((c) => c.url === `${API}files` && c.method === "POST")[1]!.json!
    expect(media).toMatchObject({
      service: "product_media",
      name: "cover.jpg",
      mime_type: "image/jpeg",
    })
  })

  it("resumes a product a lost create left behind rather than creating a second", async () => {
    const calls: Call[] = []
    // The earlier attempt got as far as the draft, with no benefit attached
    // and no link; the listing remembers nothing.
    vi.stubGlobal(
      "fetch",
      polar(calls, { held: { visibility: "draft", benefits: [], medias: [] } }),
    )

    const result = await polarAdapter.publish!(context())

    expect(apiCalls(calls)).not.toContain("POST products")
    expect(apiCalls(calls)).toContain("PATCH products/P1")
    expect(apiCalls(calls)).toContain("POST products/P1/benefits")
    expect(calls.filter((c) => c.method === "PATCH").at(-1)?.json).toEqual({
      visibility: "public",
    })
    expect(result.externalListingId).toBe("P1")
    expect(result.externalState).toBe("live")
    expect(result.providerResponse).toMatchObject({ resumed: true })
  })

  it("stops at the failed step and creates nothing after it, so the next attempt resumes", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", polar(calls, { failAt: "link" }))

    await expect(polarAdapter.publish!(context())).rejects.toMatchObject({
      normalized: { code: "provider_unavailable" },
    })
    expect(apiCalls(calls)).toContain("POST products")
    expect(apiCalls(calls)).not.toContain("GET products/P1")
    expect(calls.some((c) => c.method === "PATCH")).toBe(false)
  })

  it("reports a refused benefit in the creator's terms and creates no product after it", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", polar(calls, { failAt: "benefit" }))

    await expect(polarAdapter.publish!(context())).rejects.toMatchObject({
      normalized: {
        code: "validation_rejected",
        message: "Polar rejected this: description: String too long.",
      },
    })
    expect(apiCalls(calls)).not.toContain("POST products")
  })

  it("fails the upload when storage refuses a part, before any product exists", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", polar(calls, { failAt: "part" }))

    await expect(polarAdapter.publish!(context())).rejects.toMatchObject({
      normalized: { code: "unknown", message: expect.stringContaining("storage") },
    })
    expect(apiCalls(calls)).not.toContain("POST benefits")
    expect(apiCalls(calls)).not.toContain("POST products")
  })

  it("refuses before any call when the currency is one Polar cannot take", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", polar(calls))
    await expect(
      polarAdapter.publish!(context({ listing: listing({ currency: "XXX" }) })),
    ).rejects.toMatchObject({ normalized: { code: "validation_rejected" } })
    expect(calls).toHaveLength(0)
  })

  it("asks for a reconnect when the connection is short a scope", async () => {
    await expect(
      polarAdapter.publish!(
        context({
          connection: {
            id: "c",
            workspace_id: "w",
            external_account_id: "org-1",
            scopes: ["products:read"],
          } as unknown as ChannelConnection,
        }),
      ),
    ).rejects.toMatchObject({ normalized: { code: "permission_denied" } })
  })

  it("refreshes a token near expiry and re-seals what came back before the first call", async () => {
    const calls: Call[] = []
    const script = polar(calls)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === `${API}oauth2/token`) {
          calls.push({ method: "POST", url: String(input), json: null, headers: {} })
          return json({
            access_token: "polar_at_2",
            refresh_token: "polar_rt_2",
            token_type: "Bearer",
            expires_in: 864000,
            scope: "",
          })
        }
        return script(input, init)
      }),
    )
    credentialsMock.read.mockResolvedValue({
      ...FRESH,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })

    await polarAdapter.publish!(context())

    expect(apiCalls(calls)[0]).toBe("POST oauth2/token")
    expect(credentialsMock.store).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        connectionId: "conn-1",
        credentials: expect.objectContaining({
          accessToken: "polar_at_2",
          refreshToken: "polar_rt_2",
        }),
      }),
    )
    const first = calls.find((c) => c.url.startsWith(`${API}products`))!
    expect(first.headers.Authorization).toBe("Bearer polar_at_2")
  })
})

describe("update", () => {
  const published = (metadata: Record<string, unknown> = {}) =>
    listing({
      external_listing_id: "P1",
      external_url: CHECKOUT_URL,
      metadata: {
        externalState: "live",
        files: [{ assetId: "asset-2", fileId: "F1" }],
        medias: [{ assetId: "asset-1", fileId: "F2" }],
        benefitId: "B1",
        checkoutLinkId: "CL1",
        checkoutUrl: CHECKOUT_URL,
        ...metadata,
      },
    })

  it("reads first, keeps the price by id, keeps visibility, and uploads nothing it already sent", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", polar(calls, { held: { visibility: "private", links: true } }))

    const result = await polarAdapter.update!(context({ listing: published() }))

    expect(apiCalls(calls)).toEqual(["GET products/P1", "PATCH products/P1"])
    const patch = calls.find((c) => c.method === "PATCH")!.json!
    expect(patch).toEqual({
      name: "Aster Grotesk",
      description: "A grotesque in **nine** weights.\n\nDrawn for long text.",
      prices: [{ id: "PR1" }],
      medias: ["F2"],
    })
    expect(patch).not.toHaveProperty("visibility")
    expect(result.externalState).toBe("draft")
    expect(result.purchasable).toBe(false)
    expect(result.listingMetadata).toMatchObject({ benefitId: "B1", checkoutLinkId: "CL1" })
  })

  it("replaces the fixed price when the amount changed and keeps the seller's other prices and benefits", async () => {
    const calls: Call[] = []
    vi.stubGlobal(
      "fetch",
      polar(calls, {
        held: {
          links: true,
          prices: [
            { id: "PR1", amount_type: "fixed", price_currency: "usd", price_amount: 4800 },
            { id: "PR9", amount_type: "custom", price_currency: "usd" },
          ],
          benefits: [
            { id: "B9", type: "license_keys" },
            { id: "B1", type: "downloadables" },
          ],
        },
      }),
    )

    await polarAdapter.update!(context({ listing: published({}), subject: subject() }))
    const cheaper = await polarAdapter.update!(
      context({ listing: { ...published(), price: 36 } as ChannelListing }),
    )

    const patch = calls.filter((c) => c.method === "PATCH").at(-1)!.json!
    expect(patch.prices).toEqual([
      { id: "PR9" },
      { amount_type: "fixed", price_currency: "usd", price_amount: 3600 },
    ])
    expect(apiCalls(calls)).not.toContain("POST products/P1/benefits")
    expect(cheaper.externalState).toBe("live")
  })

  it("uploads a new file, replaces the benefit's list with every file it knows, and sends a new image", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", polar(calls, { held: { links: true } }))
    const withMore = subject({
      assets: [
        asset(),
        asset({
          id: "asset-2",
          asset_type: "deliverable",
          filename: "aster.zip",
          mime_type: "application/zip",
          byte_size: 5,
        }),
        asset({
          id: "asset-3",
          asset_type: "archive",
          filename: "extras.zip",
          mime_type: "application/zip",
          byte_size: 5,
          sort_order: 1,
        }),
        asset({ id: "asset-4", asset_type: "preview_image", filename: "p.png", sort_order: 1 }),
      ],
    })

    const result = await polarAdapter.update!(context({ listing: published(), subject: withMore }))

    expect(apiCalls(calls)).toEqual([
      "GET products/P1",
      "POST files",
      "POST files/F1/uploaded",
      "POST files",
      "POST files/F2/uploaded",
      "PATCH benefits/B1",
      "PATCH products/P1",
    ])
    expect(calls.find((c) => c.url.endsWith("benefits/B1"))?.json).toEqual({
      type: "downloadables",
      properties: { files: ["F1", "F1"] },
    })
    expect(result.listingMetadata).toMatchObject({
      files: [
        { assetId: "asset-2", fileId: "F1" },
        { assetId: "asset-3", fileId: "F1" },
      ],
      medias: [
        { assetId: "asset-1", fileId: "F2" },
        { assetId: "asset-4", fileId: "F2" },
      ],
    })
  })

  it("raises the one code the runner acts on when the product is gone", async () => {
    const calls: Call[] = []
    vi.stubGlobal("fetch", polar(calls, { missing: true }))
    await expect(polarAdapter.update!(context({ listing: published() }))).rejects.toMatchObject({
      normalized: { code: "external_object_missing" },
    })
    expect(apiCalls(calls)).toEqual(["GET products/P1"])
  })

  it("refuses to update a listing that was never published", async () => {
    await expect(polarAdapter.update!(context())).rejects.toMatchObject({
      normalized: { code: "unknown" },
    })
  })
})
