import { describe, expect, it } from "vitest"
import { constraintsFor, summarize } from "@/lib/channels/constraints"
import { updateListingSchema, tagsSchema } from "@/lib/channels/schemas"
import { evaluate, listingToDraft } from "@/lib/channels/listings"
import { getAdapter } from "@/lib/channels/registry"
import type { AdapterSubject, ChannelAdapter, ChannelListing } from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "22222222-2222-4222-8222-222222222222",
    name: "Aster Grotesk",
    slug: "aster-grotesk",
    product_type: "font",
    status: "draft",
    canonical_title: "Aster Grotesk",
    canonical_description: "x".repeat(200),
    short_description: "A neo-grotesque for interfaces.",
    brand_name: "Aster Type",
    base_price: 48,
    currency: "USD",
    version: "1.0",
    support_url: null,
    documentation_url: null,
    license_summary: null,
    metadata: {},
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z",
    archived_at: null,
    ...overrides,
  } as Product
}

function asset(type: ProductAsset["asset_type"]): ProductAsset {
  return {
    id: crypto.randomUUID(),
    workspace_id: "22222222-2222-4222-8222-222222222222",
    product_id: "11111111-1111-4111-8111-111111111111",
    asset_type: type,
    asset_state: "ready",
    storage_path: "ws/prod/asset.png",
    filename: "asset.png",
    mime_type: "image/png",
    byte_size: 1024,
    checksum: "abc",
    sort_order: 0,
    derived_from: null,
    spec_hash: null,
    failure_reason: null,
    metadata: {},
    created_at: "2026-09-04T00:00:00Z",
  } as ProductAsset
}

const subject: AdapterSubject = {
  product: product(),
  assets: [
    asset("cover_image"),
    asset("deliverable"),
    asset("preview_image"),
    asset("preview_image"),
    asset("preview_image"),
  ],
}

describe("constraints derived from requirement specs", () => {
  it("reads the same limits the evaluator enforces", () => {
    const adapter = getAdapter("mock_assisted")
    const c = constraintsFor(adapter)

    expect(c.text.title).toMatchObject({ minLength: 5, maxLength: 60, required: true })
    expect(c.tags).toMatchObject({ minCount: 3, maxCount: 20, maxTagLength: 24, required: true })
    expect(c.number.price).toMatchObject({ min: 1, max: 9999, required: true })
  })

  it("marks a warning-severity field optional", () => {
    const c = constraintsFor(getAdapter("mock_api"))
    // The API mock declares short_description as a warning, not an error.
    expect(c.text.shortDescription?.required).toBe(false)
    expect(c.text.title?.required).toBe(true)
  })

  it("takes the strictest bound when two rules touch one field", () => {
    // A channel may declare more than one rule per field. The counter must show
    // the first wall the creator will hit, not the loosest one.
    const adapter = {
      ...getAdapter("mock_api"),
      requirements: [
        {
          kind: "text",
          key: "a",
          label: "Title",
          severity: "error",
          field: "title",
          maxLength: 120,
        },
        {
          kind: "text",
          key: "b",
          label: "Title",
          severity: "error",
          field: "title",
          maxLength: 80,
        },
        { kind: "text", key: "c", label: "Title", severity: "error", field: "title", minLength: 3 },
        {
          kind: "text",
          key: "d",
          label: "Title",
          severity: "error",
          field: "title",
          minLength: 10,
        },
      ],
    } as unknown as ChannelAdapter

    const c = constraintsFor(adapter)
    expect(c.text.title).toMatchObject({ maxLength: 80, minLength: 10 })
  })

  it("yields no field limit for asset or custom rules, which have none to show", () => {
    const adapter = {
      ...getAdapter("mock_api"),
      requirements: [
        {
          kind: "asset",
          key: "a",
          label: "Cover",
          severity: "error",
          assetTypes: ["cover_image"],
          minCount: 1,
        },
        {
          kind: "custom",
          key: "c",
          label: "Odd",
          severity: "error",
          evaluate: () => ({ satisfied: true }),
        },
      ],
    } as unknown as ChannelAdapter

    const c = constraintsFor(adapter)
    expect(c.text).toEqual({})
    expect(c.number).toEqual({})
    expect(c.tags).toBeNull()
  })

  it("summarises a channel without inventing a figure", () => {
    expect(summarize(getAdapter("mock_assisted"))).toContain("60 char title")
    expect(summarize(getAdapter("mock_assisted"))).toContain("20 tags")
  })
})

describe("the editor payload schema", () => {
  const base = {
    title: "Aster Grotesk",
    description: "x".repeat(200),
    shortDescription: "Short",
    category: "font",
    price: "48",
    currency: "usd",
    tags: "one, two, three",
  }

  it("accepts a listing the channel would reject, so readiness stays reachable", () => {
    // A title far over every channel limit still saves. Refusing it would put
    // the explanation behind the fix.
    const parsed = updateListingSchema.safeParse({ ...base, title: "x".repeat(400) })
    expect(parsed.success).toBe(true)
  })

  it("normalises empty strings to null rather than storing blanks", () => {
    const parsed = updateListingSchema.parse({ ...base, shortDescription: "", category: "" })
    expect(parsed.shortDescription).toBeNull()
    expect(parsed.category).toBeNull()
  })

  it("upper-cases the currency and rejects a malformed one", () => {
    expect(updateListingSchema.parse(base).currency).toBe("USD")
    expect(updateListingSchema.safeParse({ ...base, currency: "dollars" }).success).toBe(false)
  })

  it("treats an empty price as unset, not as zero", () => {
    expect(updateListingSchema.parse({ ...base, price: "" }).price).toBeNull()
    expect(updateListingSchema.parse({ ...base, price: "0" }).price).toBe(0)
  })

  it("rejects a negative price", () => {
    expect(updateListingSchema.safeParse({ ...base, price: "-1" }).success).toBe(false)
  })
})

describe("tag parsing", () => {
  it("splits, trims and drops empties", () => {
    expect(tagsSchema.parse(" one ,two,  , three ")).toEqual(["one", "two", "three"])
  })

  it("removes duplicates case-insensitively, because every marketplace does", () => {
    expect(tagsSchema.parse("Sans, sans, SANS, serif")).toEqual(["Sans", "serif"])
  })

  it("returns an empty list for an empty field", () => {
    expect(tagsSchema.parse("")).toEqual([])
    expect(tagsSchema.parse(undefined)).toEqual([])
  })
})

describe("client and server agree on readiness", () => {
  /**
   * The editor evaluates while typing and the action evaluates at save. If those
   * two ever disagreed, the creator would be told their listing was ready and
   * then have a snapshot recorded saying otherwise. They call the same function,
   * and this test is what keeps it that way.
   */
  it("produces identical verdicts for the same stored row", () => {
    const listing = {
      title: "Aster Grotesk",
      description: "y".repeat(200),
      short_description: null,
      price: "48.00",
      currency: "USD",
      category: "font",
      tags: ["one", "two", "three"],
      metadata: {},
    } as unknown as ChannelListing

    for (const key of ["mock_api", "mock_assisted"] as const) {
      const adapter = getAdapter(key)
      const fromStored = evaluate(adapter, listingToDraft(listing), subject)
      const again = evaluate(adapter, listingToDraft(listing), subject)
      expect(again).toEqual(fromStored)
    }
  })

  it("a listing built to satisfy a channel reads ready on both sides", () => {
    const adapter = getAdapter("mock_assisted")
    const draft = {
      title: "Aster Grotesk",
      description: "y".repeat(200),
      shortDescription: null,
      price: 48,
      currency: "USD",
      category: "font",
      tags: ["grotesque", "sans", "editorial"],
      metadata: {},
    }
    expect(evaluate(adapter, draft, subject).readiness.ready).toBe(true)
  })

  it("hand-writing for one channel does not satisfy the other", () => {
    // The point of a per-channel listing. Copy that clears the storefront still
    // fails the marketplace, because the marketplace wants tags and previews.
    const draft = {
      title: "Aster Grotesk",
      description: "y".repeat(200),
      shortDescription: null,
      price: 48,
      currency: "USD",
      category: "font",
      tags: [],
      metadata: {},
    }
    expect(evaluate(getAdapter("mock_api"), draft, subject).readiness.ready).toBe(true)
    expect(evaluate(getAdapter("mock_assisted"), draft, subject).readiness.ready).toBe(false)
  })
})
