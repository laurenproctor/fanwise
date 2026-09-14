import { afterEach, describe, expect, it, vi } from "vitest"
import { resetStore, scriptStore } from "./outbound-support"

vi.mock("@/lib/credentials", () => ({
  readConnectionCredentials: vi.fn(async () => ({
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  })),
}))

import { planDownloads, woocommerceAdapter } from "@/lib/channels/adapters/woocommerce"
import { buildDeliverableLinkUrl } from "@/lib/channels/deliverable-link"
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
 * Fanwise's side of the wire: a publish creates a live digital product with
 * its file and no slug, and never leaves one on sale without it; an update
 * preserves the store's status and a creator's own downloads; tags are created
 * by name and matched when they exist; a deleted product is raised by the one
 * code the runner acts on; and activate takes an older draft live with its file.
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

const APP = "https://app.fanwise.test"

/** A well-formed, stable token per asset, as the runner's links would be. */
function tokenFor(assetId: string): string {
  return (assetId.replace(/[^A-Za-z0-9]/g, "") + "t".repeat(43)).slice(0, 43)
}

function linkFor(a: Pick<ProductAsset, "id" | "filename">): string {
  return buildDeliverableLinkUrl(APP, a.filename, tokenFor(a.id))
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
    deliverableUrl: async (a) => linkFor(a),
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
    /** Answers 2xx but keeps no downloads, as an interfering plugin might. */
    dropDownloads?: boolean
    /** Refuses a download address that ends in a file extension. */
    refuseExtensions?: boolean
    /** Refuses every download address, as an unapproved directory is. */
    refuseDownloads?: boolean
  } = {},
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    calls.push({ method, url, body })

    const sent = (body?.downloads ?? null) as { file: string }[] | null
    if (sent && (method === "POST" || method === "PUT") && !url.endsWith("/products/tags")) {
      const refused = options.refuseDownloads
        ? sent.length > 0
        : options.refuseExtensions &&
          sent.some((d) => /\.[A-Za-z0-9]+$/.test(new URL(d.file).pathname))
      if (refused) {
        return json(
          {
            code: "product_invalid_download",
            message: "The downloadable file cannot be used.",
            data: { status: 400 },
          },
          400,
        )
      }
    }
    const kept = (fallback: unknown) => (options.dropDownloads ? [] : (sent ?? fallback))

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
          downloads: kept(options.held?.downloads ?? []),
        }),
      )
    }
    if (url.endsWith("/products") && method === "POST") {
      return json(
        productOk({ status: String(body?.status), images: [{ id: 1 }], downloads: kept([]) }),
        201,
      )
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
  it("needs no app credentials, attaches the file itself, and leaves no manual step", () => {
    expect(woocommerceAdapter.oauth?.grant).toBeDefined()
    expect(woocommerceAdapter.capabilities.digitalFileUpload).toBe(true)
    expect(woocommerceAdapter.manualSteps).toEqual([])
    // Kept for drafts created before the file was automatic.
    expect(typeof woocommerceAdapter.activate).toBe("function")
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
  it("creates a live digital product with its file, images, tags by id, and no slug", async () => {
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
      downloads: [{ name: "aster.zip", file: linkFor({ id: "asset-2", filename: "aster.zip" }) }],
    })
    expect(create.body).not.toHaveProperty("slug")
    expect(result).toMatchObject({
      externalListingId: "900",
      externalUrl: adminProductUrl("https://shop.example.com", 900),
      externalState: "live",
      purchasable: true,
    })
  })

  it("does not read the store before a create", async () => {
    const calls: Call[] = []
    scriptStore(store(calls))
    await woocommerceAdapter.publish!(context())
    expect(calls.some((c) => c.method === "GET")).toBe(false)
  })

  it("sends only ready buyer files, never a cover, a pending file, or a source file", async () => {
    const calls: Call[] = []
    scriptStore(store(calls))
    const assets = [
      asset(),
      asset({ id: "asset-2", asset_type: "deliverable", filename: "aster.zip" }),
      asset({ id: "asset-3", asset_type: "archive", filename: "extras.zip" }),
      asset({
        id: "asset-4",
        asset_type: "deliverable",
        filename: "late.zip",
        asset_state: "pending",
      }),
      asset({ id: "asset-5", asset_type: "source_file", filename: "aster.glyphs" }),
    ]
    await woocommerceAdapter.publish!(context({ subject: subject({ assets }) }))
    const sent = write(calls, "POST")!.body!.downloads as { name: string }[]
    expect(sent.map((d) => d.name)).toEqual(["aster.zip", "extras.zip"])
  })

  it("keeps the product a draft, without failing, when the store drops the file", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { dropDownloads: true }))

    const result = await woocommerceAdapter.publish!(context())

    // Created live, then taken straight back by id so nobody can pay for nothing.
    const demote = calls.find((c) => c.method === "PUT")!
    expect(demote.url).toBe("https://shop.example.com/wp-json/wc/v3/products/900")
    expect(demote.body).toEqual({ status: "draft" })
    // Recorded rather than failed, so the next Publish cannot create a second product.
    expect(result).toMatchObject({
      externalListingId: "900",
      externalState: "draft",
      purchasable: false,
    })
  })

  it("retries once without the extension when the store refuses the file type", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { refuseExtensions: true }))

    const result = await woocommerceAdapter.publish!(context())

    const creates = calls.filter((c) => c.method === "POST" && c.url.endsWith("/products"))
    expect(creates).toHaveLength(2)
    const retried = (creates[1]!.body!.downloads as { file: string }[])[0]!.file
    expect(new URL(retried).pathname).toBe("/api/public/deliverable/aster")
    expect(new URL(retried).searchParams.get("token")).toBe(tokenFor("asset-2"))
    expect(result.purchasable).toBe(true)
  })

  it("says which store setting to switch on when every address is refused", async () => {
    scriptStore(store([], { refuseDownloads: true }))
    await expect(woocommerceAdapter.publish!(context())).rejects.toMatchObject({
      normalized: {
        code: "validation_rejected",
        message: expect.stringContaining("Approved download directories"),
      },
    })
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

describe("update and the store's own downloads", () => {
  const ours = {
    id: "dl-ours",
    name: "aster.zip",
    file: linkFor({ id: "asset-2", filename: "aster.zip" }),
  }
  const theirs = {
    id: "dl-theirs",
    name: "bonus.pdf",
    file: "https://shop.example.com/wp-content/uploads/woocommerce_uploads/bonus.pdf",
  }

  it("sends no download list when the store already has the file", async () => {
    const calls: Call[] = []
    scriptStore(
      store(calls, { held: { status: "publish", images: [{ id: 1 }], downloads: [ours] } }),
    )
    await woocommerceAdapter.update!(context({ listing: listing({ external_listing_id: "900" }) }))
    expect(write(calls, "PUT")!.body).not.toHaveProperty("downloads")
  })

  it("adds Fanwise's file beside a creator's own, keeping theirs and its id", async () => {
    const calls: Call[] = []
    scriptStore(
      store(calls, { held: { status: "publish", images: [{ id: 1 }], downloads: [theirs] } }),
    )
    await woocommerceAdapter.update!(context({ listing: listing({ external_listing_id: "900" }) }))
    expect(write(calls, "PUT")!.body!.downloads).toEqual([
      theirs,
      { name: "aster.zip", file: ours.file },
    ])
  })

  it("drops Fanwise's entry for a file that is no longer on the product", async () => {
    const calls: Call[] = []
    const gone = {
      id: "dl-gone",
      name: "old.zip",
      file: linkFor({ id: "asset-9", filename: "old.zip" }),
    }
    scriptStore(
      store(calls, {
        held: { status: "publish", images: [{ id: 1 }], downloads: [ours, gone, theirs] },
      }),
    )
    await woocommerceAdapter.update!(context({ listing: listing({ external_listing_id: "900" }) }))
    expect(write(calls, "PUT")!.body!.downloads).toEqual([ours, theirs])
  })
})

describe("planDownloads", () => {
  const file = linkFor({ id: "asset-2", filename: "aster.zip" })

  it("keeps the stored address and id when the token matches, and takes the new name", () => {
    const stored = buildDeliverableLinkUrl(APP, "aster", tokenFor("asset-2"))
    expect(
      planDownloads(
        [{ id: "dl-1", name: "old name", file: stored }],
        [{ name: "aster.zip", file }],
      ),
    ).toEqual([{ id: "dl-1", name: "aster.zip", file: stored }])
  })

  it("is null when nothing would change", () => {
    expect(
      planDownloads([{ id: "dl-1", name: "aster.zip", file }], [{ name: "aster.zip", file }]),
    ).toBeNull()
  })

  it("never lists one token twice", () => {
    expect(
      planDownloads(
        [
          { id: "a", name: "aster.zip", file },
          { id: "b", name: "aster.zip", file },
        ],
        [{ name: "aster.zip", file }],
      ),
    ).toEqual([{ id: "a", name: "aster.zip", file }])
  })
})

describe("activate", () => {
  it("attaches the file to a draft made before it was automatic, and takes it live", async () => {
    const calls: Call[] = []
    scriptStore(store(calls, { held: { status: "draft", images: [{ id: 1 }], downloads: [] } }))

    const result = await woocommerceAdapter.activate!(
      context({
        listing: listing({ external_listing_id: "900", metadata: { externalState: "draft" } }),
      }),
    )

    const put = write(calls, "PUT")!
    expect(put.body!.status).toBe("publish")
    expect(put.body!.downloads).toEqual([
      { name: "aster.zip", file: linkFor({ id: "asset-2", filename: "aster.zip" }) },
    ])
    expect(result).toMatchObject({ externalState: "live", purchasable: true })
  })

  it("fails, and leaves a draft, when the store still drops the file", async () => {
    const calls: Call[] = []
    scriptStore(
      store(calls, { held: { status: "draft", images: [{ id: 1 }] }, dropDownloads: true }),
    )

    await expect(
      woocommerceAdapter.activate!(context({ listing: listing({ external_listing_id: "900" }) })),
    ).rejects.toMatchObject({ normalized: { code: "validation_rejected" } })

    const puts = calls.filter((c) => c.method === "PUT")
    expect(puts.at(-1)!.body).toEqual({ status: "draft" })
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
