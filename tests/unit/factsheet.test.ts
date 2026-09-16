import { describe, expect, it } from "vitest"
import { buildFactSheet, canonicalJson, factSheetHash, renderFactSheet } from "@/lib/ai/factsheet"
import type { Product, ProductAsset } from "@/lib/products/types"

/**
 * The FactSheet is derived, deterministic, and the only thing a model may
 * state. These tests pin the derivation: what goes in, what is left out, and
 * that the hash is a function of the facts alone.
 */

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    workspace_id: "ws-1",
    name: "Aster Grotesk",
    slug: "aster-grotesk",
    product_type: "font",
    status: "draft",
    canonical_title: "Aster Grotesk",
    canonical_description: "A grotesque in nine weights, drawn for long text.",
    short_description: "Nine weights.",
    brand_name: "Aster Type",
    base_price: 48,
    currency: "USD",
    version: "1.2",
    support_url: null,
    documentation_url: null,
    license_summary: "Desktop and web license for one user.",
    metadata: { kind: "font", styleCount: 9, formats: ["otf", "woff2"], glyphCount: 612 },
    created_at: "2026-09-07T00:00:00Z",
    updated_at: "2026-09-07T00:00:00Z",
    archived_at: null,
    ...overrides,
  } as Product
}

function asset(overrides: Partial<ProductAsset>): ProductAsset {
  return {
    id: "asset-1",
    workspace_id: "ws-1",
    product_id: "product-1",
    asset_type: "deliverable",
    asset_state: "ready",
    filename: "aster.zip",
    derived_from: null,
    ...overrides,
  } as ProductAsset
}

describe("buildFactSheet", () => {
  it("carries identity, price and the typed details", () => {
    const sheet = buildFactSheet(product(), [])
    expect(sheet.title).toBe("Aster Grotesk")
    expect(sheet.productType).toBe("Font")
    expect(sheet.price).toEqual({ amount: 48, currency: "USD" })
    expect(sheet.details).toEqual({
      kind: "font",
      styleCount: 9,
      formats: ["otf", "woff2"],
      glyphCount: 612,
    })
  })

  it("measures deliverable formats from ready assets only", () => {
    const sheet = buildFactSheet(product(), [
      asset({ id: "a", filename: "aster.zip" }),
      asset({ id: "b", filename: "Aster.OTF", asset_type: "archive" }),
      asset({ id: "c", filename: "pending.ttf", asset_state: "pending" }),
      asset({ id: "d", filename: "cover.png", asset_type: "cover_image" }),
    ])
    expect(sheet.files).toEqual({ deliverableCount: 2, formats: ["zip", "otf"] })
    expect(sheet.imageCount).toBe(1)
  })

  it("falls back to the product name when there is no canonical title", () => {
    const sheet = buildFactSheet(product({ canonical_title: null }), [])
    expect(sheet.title).toBe("Aster Grotesk")
  })

  it("treats blank strings as absent rather than as facts", () => {
    const sheet = buildFactSheet(
      product({ brand_name: "   ", license_summary: "", short_description: null }),
      [],
    )
    expect(sheet.brand).toBeNull()
    expect(sheet.licenseSummary).toBeNull()
    expect(sheet.shortDescription).toBeNull()
  })

  it("degrades unknown metadata to generic rather than throwing", () => {
    const sheet = buildFactSheet(product({ metadata: { kind: "nope" } as never }), [])
    expect(sheet.details).toEqual({ kind: "generic" })
  })
})

describe("a font's family, coverage and features", () => {
  const rich = product({
    metadata: {
      kind: "font",
      classification: "sans_serif",
      styles: [
        { key: "A-Thin", name: "Thin", weight: 100 },
        { key: "A-Regular", name: "Regular", weight: 400, width: 5 },
        { key: "A-Italic", name: "Italic", weight: 400, width: 5, italic: true },
        { key: "A-BoldCond", name: "Bold Condensed", weight: 700, width: 3 },
      ],
      axes: [{ tag: "wght", min: 100, default: 400, max: 700 }],
      scripts: ["Latin", "Cyrillic"],
      features: ["liga", "SMCP", "ss01", "ss02", "xxxx"],
      licenses: [{ kind: "desktop" }, { kind: "web", monthlyPageviews: 10000 }],
      tags: ["grotesk", "editorial"],
      eulaUrl: "https://example.com/eula",
    },
  })

  it("carries the creator's confirmed values, in words where the enum is not a word", () => {
    const d = buildFactSheet(rich, []).details
    expect(d).toMatchObject({
      kind: "font",
      classification: "Sans serif",
      scripts: ["Latin", "Cyrillic"],
      features: ["liga", "smcp", "ss01", "ss02", "xxxx"],
      licenses: ["Desktop license", "Webfont license"],
      keywords: ["grotesk", "editorial"],
    })
    // The style key is an internal join, not a fact.
    expect(d.kind === "font" && d.styles?.[0]).toEqual({ name: "Thin", weight: 100 })
    // License limits and the EULA address are not stated to the model.
    expect(JSON.stringify(d)).not.toContain("10000")
    expect(JSON.stringify(d)).not.toContain("eula")
  })

  it("renders weights, widths, axes and features the way a buyer reads them", () => {
    const text = renderFactSheet(buildFactSheet(rich, []))
    expect(text).toContain("Classification: Sans serif")
    expect(text).toContain("Weights: 3 (Thin, Regular, Bold)")
    expect(text).toContain("Italic styles: 1")
    expect(text).toContain("Widths: Normal, Condensed")
    expect(text).toContain("- Bold Condensed (weight 700, Bold; condensed width)")
    expect(text).toContain("- Italic (weight 400, Regular; normal width; italic)")
    expect(text).toContain("- Weight (wght): 100 to 700, default 400")
    expect(text).toContain("Writing systems: Latin, Cyrillic")
    expect(text).toContain("Stylistic sets: 2")
    expect(text).toContain(
      "OpenType features: Standard ligatures (liga), Small capitals (smcp), Stylistic set 1 (ss01), Stylistic set 2 (ss02), xxxx",
    )
    expect(text).toContain("License types sold: Desktop license, Webfont license")
  })

  it("leaves a font with none of these exactly as it was", () => {
    const text = renderFactSheet(buildFactSheet(product(), []))
    for (const label of ["Classification", "Weights", "Styles:", "Variable axes", "OpenType"]) {
      expect(text).not.toContain(label)
    }
  })
})

describe("factSheetHash", () => {
  it("is stable across key order", () => {
    const a = canonicalJson({ b: 1, a: { d: [1, 2], c: "x" } })
    const b = canonicalJson({ a: { c: "x", d: [1, 2] }, b: 1 })
    expect(a).toBe(b)
  })

  it("changes when a fact changes and not otherwise", () => {
    const base = factSheetHash(buildFactSheet(product(), []))
    expect(factSheetHash(buildFactSheet(product(), []))).toBe(base)
    expect(factSheetHash(buildFactSheet(product({ base_price: 49 }), []))).not.toBe(base)
    // updated_at is not a fact.
    expect(factSheetHash(buildFactSheet(product({ updated_at: "2027-01-01T00:00:00Z" }), []))).toBe(
      base,
    )
  })
})

describe("renderFactSheet", () => {
  it("prints only what is known", () => {
    const text = renderFactSheet(buildFactSheet(product({ support_url: null }), []))
    expect(text).toContain("Styles included: 9")
    expect(text).toContain("Glyph count: 612")
    expect(text).toContain("Price: 48 USD")
    expect(text).not.toContain("Support URL")
    expect(text).not.toContain("unknown")
  })
})
