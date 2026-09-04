import { describe, expect, it } from "vitest"
import { evaluateRequirements } from "@/lib/channels/requirements"
import { computeReadiness, readinessPercent } from "@/lib/channels/readiness"
import { buildDraft, evaluate, listingToDraft, snapshotPayload } from "@/lib/channels/listings"
import { getAdapter, listAdapters } from "@/lib/channels/registry"
import type {
  AdapterSubject,
  ChannelListing,
  ChannelListingDraft,
  RequirementResult,
  RequirementSpec,
} from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

/** A canonical product with everything filled in. Tests subtract from it. */
function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "22222222-2222-4222-8222-222222222222",
    name: "Aster Grotesk",
    slug: "aster-grotesk",
    product_type: "font",
    status: "draft",
    canonical_title: "Aster Grotesk",
    canonical_description:
      "A neo-grotesque family drawn for interfaces, with a tall x-height and tight spacing that holds up at small sizes.",
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

function asset(overrides: Partial<ProductAsset> = {}): ProductAsset {
  return {
    id: crypto.randomUUID(),
    workspace_id: "22222222-2222-4222-8222-222222222222",
    product_id: "11111111-1111-4111-8111-111111111111",
    asset_type: "cover_image",
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
    ...overrides,
  } as ProductAsset
}

function subject(overrides: { product?: Product; assets?: ProductAsset[] } = {}): AdapterSubject {
  return {
    product: overrides.product ?? product(),
    assets: overrides.assets ?? [
      asset({ asset_type: "cover_image" }),
      asset({ asset_type: "deliverable", filename: "aster.zip", mime_type: "application/zip" }),
      asset({ asset_type: "preview_image" }),
      asset({ asset_type: "preview_image" }),
      asset({ asset_type: "preview_image" }),
    ],
  }
}

const draft = (overrides: Partial<ChannelListingDraft> = {}): ChannelListingDraft => ({
  title: "Aster Grotesk",
  description: "x".repeat(200),
  shortDescription: "A neo-grotesque for interfaces.",
  price: 48,
  currency: "USD",
  category: "font",
  tags: ["font", "sans", "interface"],
  metadata: {},
  ...overrides,
})

/**
 * Evaluates one spec and returns its result. Exists so the assertions below read
 * as assertions rather than as index-access ceremony.
 */
function evaluateOne(
  spec: RequirementSpec,
  d: ChannelListingDraft,
  s: AdapterSubject,
): RequirementResult {
  const [result] = evaluateRequirements([spec], d, s)
  if (!result) throw new Error("the evaluator returned nothing for a spec")
  return result
}

describe("requirement evaluation", () => {
  const textSpec: RequirementSpec = {
    kind: "text",
    key: "title",
    label: "Title",
    severity: "error",
    field: "title",
    minLength: 5,
    maxLength: 10,
  }

  it("passes a value inside the bounds", () => {
    expect(evaluateOne(textSpec, draft({ title: "Aster Gro" }), subject()).satisfied).toBe(true)
  })

  it("fails an empty value and says so plainly", () => {
    const result = evaluateOne(textSpec, draft({ title: "" }), subject())
    expect(result.satisfied).toBe(false)
    expect(result.message).toContain("empty")
  })

  it("treats whitespace as empty", () => {
    expect(evaluateOne(textSpec, draft({ title: "     " }), subject()).satisfied).toBe(false)
  })

  it("reports how far over a limit a value is, not just that it is over", () => {
    const result = evaluateOne(textSpec, draft({ title: "Aster Grotesk Display" }), subject())
    expect(result.satisfied).toBe(false)
    // 21 characters against a limit of 10.
    expect(result.message).toContain("11 over")
  })

  it("fails a null number rather than coercing it to zero", () => {
    const spec: RequirementSpec = {
      kind: "number",
      key: "price",
      label: "Price",
      severity: "error",
      field: "price",
      min: 0,
    }
    const result = evaluateOne(spec, draft({ price: null }), subject())
    expect(result.satisfied).toBe(false)
    expect(result.message).toContain("not set")
  })

  it("checks tag count and per-tag length separately", () => {
    const spec: RequirementSpec = {
      kind: "tags",
      key: "tags",
      label: "Tags",
      severity: "error",
      minCount: 2,
      maxCount: 5,
      maxTagLength: 6,
    }

    expect(evaluateOne(spec, draft({ tags: ["one"] }), subject()).satisfied).toBe(false)

    const overlong = evaluateOne(spec, draft({ tags: ["one", "supercalifragilistic"] }), subject())
    expect(overlong.satisfied).toBe(false)
    expect(overlong.message).toContain("supercalifragilistic")
  })

  it("counts only ready assets, never pending ones", () => {
    const spec: RequirementSpec = {
      kind: "asset",
      key: "cover",
      label: "A cover image",
      severity: "error",
      assetTypes: ["cover_image"],
      minCount: 1,
    }

    const pending = subject({
      assets: [asset({ asset_type: "cover_image", asset_state: "pending" })],
    })
    expect(evaluateOne(spec, draft(), pending).satisfied).toBe(false)

    const ready = subject({ assets: [asset({ asset_type: "cover_image", asset_state: "ready" })] })
    expect(evaluateOne(spec, draft(), ready).satisfied).toBe(true)
  })

  it("runs a custom rule and passes its message through", () => {
    const spec: RequirementSpec = {
      kind: "custom",
      key: "custom",
      label: "Custom",
      severity: "warning",
      evaluate: () => ({ satisfied: false, message: "because" }),
    }
    expect(evaluateOne(spec, draft(), subject())).toMatchObject({
      satisfied: false,
      message: "because",
      severity: "warning",
    })
  })

  it("is deterministic: the same inputs give the same results", () => {
    const adapter = getAdapter("mock_assisted")
    const a = evaluateRequirements(adapter.requirements, draft(), subject())
    const b = evaluateRequirements(adapter.requirements, draft(), subject())
    expect(a).toEqual(b)
  })
})

describe("readiness", () => {
  const result = (overrides: Partial<RequirementResult>): RequirementResult => ({
    key: "k",
    label: "L",
    severity: "error",
    satisfied: true,
    ...overrides,
  })

  it("is errors resolved over errors total", () => {
    const readiness = computeReadiness([
      result({ key: "a", satisfied: true }),
      result({ key: "b", satisfied: false }),
      result({ key: "c", satisfied: false }),
      result({ key: "d", satisfied: true }),
    ])
    expect(readiness.errorsTotal).toBe(4)
    expect(readiness.errorsResolved).toBe(2)
    expect(readinessPercent(readiness)).toBe(50)
    expect(readiness.ready).toBe(false)
  })

  it("excludes warnings from the score entirely", () => {
    const readiness = computeReadiness([
      result({ key: "a", satisfied: true }),
      result({ key: "w", severity: "warning", satisfied: false }),
    ])
    expect(readiness.errorsTotal).toBe(1)
    expect(readiness.score).toBe(1)
    expect(readiness.ready).toBe(true)
    expect(readiness.advisory).toHaveLength(1)
  })

  it("is ready, not broken, when a channel declares no error rules", () => {
    const readiness = computeReadiness([result({ severity: "info", satisfied: false })])
    expect(readiness.score).toBe(1)
    expect(readiness.ready).toBe(true)
    expect(Number.isNaN(readiness.score)).toBe(false)
  })

  it("ready means no unsatisfied errors, never a score threshold", () => {
    const nearlyThere = computeReadiness([
      ...Array.from({ length: 9 }, (_, i) => result({ key: `ok-${i}`, satisfied: true })),
      result({ key: "last", satisfied: false }),
    ])
    expect(readinessPercent(nearlyThere)).toBe(90)
    expect(nearlyThere.ready).toBe(false)
  })

  it("keeps info results advisory even when they are satisfied", () => {
    const readiness = computeReadiness([result({ severity: "info", satisfied: true })])
    expect(readiness.advisory).toHaveLength(1)
    expect(readiness.blocking).toHaveLength(0)
  })
})

describe("the adapters", () => {
  it("derives a listing from the canonical product without touching it", () => {
    const s = subject()
    const before = structuredClone(s.product)
    buildDraft(getAdapter("mock_api"), s)
    expect(s.product).toEqual(before)
  })

  it("falls back to the product name when there is no canonical title", () => {
    const s = subject({ product: product({ canonical_title: null }) })
    expect(buildDraft(getAdapter("mock_api"), s).title).toBe("Aster Grotesk")
  })

  it("gives two channels genuinely independent listings from one product", () => {
    const s = subject()
    const api = evaluate(getAdapter("mock_api"), buildDraft(getAdapter("mock_api"), s), s)
    const assisted = evaluate(
      getAdapter("mock_assisted"),
      buildDraft(getAdapter("mock_assisted"), s),
      s,
    )

    // Same product, different verdicts: the assisted channel wants tags and the
    // API one does not. This is the whole point of the requirements engine.
    expect(api.readiness.ready).toBe(true)
    expect(assisted.readiness.ready).toBe(false)
    expect(assisted.readiness.blocking.map((b) => b.key)).toContain("tags")
  })

  it("rejects contact details in an assisted description", () => {
    const s = subject()
    const adapter = getAdapter("mock_assisted")
    const withEmail = evaluate(
      adapter,
      draft({ description: "Buy at me@example.com " + "x".repeat(150) }),
      s,
    )
    expect(withEmail.readiness.blocking.map((b) => b.key)).toContain("no_contact_details")

    const withLink = evaluate(
      adapter,
      draft({ description: "See https://example.com " + "x".repeat(150) }),
      s,
    )
    expect(withLink.readiness.blocking.map((b) => b.key)).toContain("no_contact_details")
  })
})

describe("capability honesty", () => {
  it("the assisted adapter implements no publishing methods at all", () => {
    const adapter = getAdapter("mock_assisted")
    expect(adapter.publish).toBeUndefined()
    expect(adapter.update).toBeUndefined()
    expect(adapter.unpublish).toBeUndefined()
    expect(adapter.capabilities.automaticPublish).toBe(false)
  })

  it("every adapter claiming a capability implements the method behind it", () => {
    for (const adapter of listAdapters()) {
      if (adapter.capabilities.automaticPublish) {
        expect(typeof adapter.publish, `${adapter.key} claims publish`).toBe("function")
      }
      if (adapter.capabilities.automaticUpdate) {
        expect(typeof adapter.update, `${adapter.key} claims update`).toBe("function")
      }
    }
  })

  it("no adapter implements a method it has not declared", () => {
    for (const adapter of listAdapters()) {
      if (adapter.publish) {
        expect(adapter.capabilities.automaticPublish, `${adapter.key} hides publish`).toBe(true)
      }
      if (adapter.update) {
        expect(adapter.capabilities.automaticUpdate, `${adapter.key} hides update`).toBe(true)
      }
    }
  })

  it("an assisted adapter is never declared able to publish", () => {
    for (const adapter of listAdapters()) {
      if (adapter.integrationType === "assisted") {
        expect(adapter.capabilities.automaticPublish).toBe(false)
        expect(adapter.capabilities.automaticUpdate).toBe(false)
      }
    }
  })
})

describe("listings round trip", () => {
  it("reads a stored row back into the shape requirements are written against", () => {
    const listing = {
      title: "Stored title",
      description: "stored description",
      short_description: null,
      price: "48.00",
      currency: "USD",
      category: "font",
      tags: ["a", "b"],
      metadata: { note: 1 },
    } as unknown as ChannelListing

    expect(listingToDraft(listing)).toEqual({
      title: "Stored title",
      description: "stored description",
      shortDescription: null,
      // numeric arrives from Postgres as a string; a requirement comparing it
      // against a minimum would otherwise compare a string to a number.
      price: 48,
      currency: "USD",
      category: "font",
      tags: ["a", "b"],
      metadata: { note: 1 },
    })
  })

  it("tolerates a listing with no tags", () => {
    const listing = { tags: null, metadata: null, price: null } as unknown as ChannelListing
    const result = listingToDraft(listing)
    expect(result.tags).toEqual([])
    expect(result.metadata).toEqual({})
    expect(result.price).toBeNull()
  })

  it("records the readiness verdict in the snapshot, not just the fields", () => {
    const s = subject()
    const adapter = getAdapter("mock_assisted")
    const d = buildDraft(adapter, s)
    const payload = snapshotPayload(d, evaluate(adapter, d, s))

    expect(payload).toHaveProperty("listing")
    expect(payload).toHaveProperty("readiness")
    expect(payload).toHaveProperty("requirements")
    expect((payload.readiness as { ready: boolean }).ready).toBe(false)
  })
})
