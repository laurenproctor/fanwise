import { describe, expect, it } from "vitest"
import { buildFactSheet } from "@/lib/ai/factsheet"
import { buildPrompt, renderProfile } from "@/lib/ai/prompt"
import { LISTING_OUTPUT_JSON_SCHEMA, listingOutputSchema } from "@/lib/ai/output"
import { awaitingReview } from "@/lib/ai/review"
import { listAdapters, getAdapter } from "@/lib/channels/registry"
import type { Product } from "@/lib/products/types"

const product = {
  id: "p",
  workspace_id: "w",
  name: "Aster Grotesk",
  slug: "aster",
  product_type: "font",
  canonical_title: "Aster Grotesk",
  canonical_description: "Nine weights.",
  short_description: null,
  brand_name: null,
  base_price: 48,
  currency: "USD",
  version: null,
  support_url: null,
  documentation_url: null,
  license_summary: null,
  metadata: { kind: "font", styleCount: 9 },
} as unknown as Product

describe("the prompt", () => {
  it("delimits the facts from the instruction, as the merchandising doc asks", () => {
    const prompt = buildPrompt(getAdapter("mock_api"), buildFactSheet(product, []))
    expect(prompt.user).toContain("=== VERIFIED PRODUCT FACTS ===")
    expect(prompt.user).toContain("=== MERCHANDISING INSTRUCTIONS ===")
    expect(prompt.user.indexOf("VERIFIED PRODUCT FACTS")).toBeLessThan(
      prompt.user.indexOf("MERCHANDISING INSTRUCTIONS"),
    )
  })

  it("keeps everything that varies per product below the cache boundary", () => {
    const a = buildPrompt(getAdapter("mock_api"), buildFactSheet(product, []))
    const b = buildPrompt(
      getAdapter("mock_api"),
      buildFactSheet({ ...product, name: "Other", canonical_title: "Other" }, []),
    )
    // Same system blocks, byte for byte, so the prefix caches across products.
    expect(a.system).toEqual(b.system)
    expect(a.system.at(-1)?.cacheBoundary).toBe(true)
    expect(a.system.slice(0, -1).some((block) => block.cacheBoundary)).toBe(false)
    // And the product is only in the user turn.
    expect(a.system.some((block) => block.text.includes("Aster"))).toBe(false)
    expect(a.user).toContain("Aster Grotesk")
    expect(a.inputHash).not.toBe(b.inputHash)
  })

  it("states the factual rule in the stable prefix", () => {
    const prompt = buildPrompt(getAdapter("mock_api"), buildFactSheet(product, []))
    expect(prompt.system[0]?.text).toContain("never introduce a factual claim")
  })

  it("carries the channel's limits from the same specs the evaluator walks", () => {
    const text = renderProfile(getAdapter("mock_api"))
    expect(text).toContain("title: at least 3 characters, at most 120 characters, required")
  })

  it("versions the prompt by rules and profile together", () => {
    const prompt = buildPrompt(getAdapter("mock_api"), buildFactSheet(product, []))
    expect(prompt.promptVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+\+\d{4}-\d{2}-\d{2}\.\d+$/)
  })

  it("has a profile on every adapter, with a version", () => {
    for (const adapter of listAdapters()) {
      expect(adapter.merchandising.promptVersion, adapter.key).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
      expect(adapter.merchandising.audience.length, adapter.key).toBeGreaterThan(20)
    }
  })
})

describe("the output schema", () => {
  it("parses an answer shaped by the JSON schema", () => {
    const required = LISTING_OUTPUT_JSON_SCHEMA.required as string[]
    const sample = Object.fromEntries(
      required.map((k) => [k, k === "tags" ? ["a", "A", "b"] : "x"]),
    )
    const parsed = listingOutputSchema.parse(sample)
    expect(Object.keys(parsed).sort()).toEqual([...required].sort())
    // Duplicate tags collapse case-insensitively.
    expect(parsed.tags).toEqual(["a", "b"])
  })

  it("refuses an empty title or description", () => {
    expect(
      listingOutputSchema.safeParse({
        title: "",
        description: "x",
        shortDescription: "",
        seoTitle: "",
        seoDescription: "",
        tags: [],
      }).success,
    ).toBe(false)
  })
})

describe("awaitingReview", () => {
  it("is false for a listing that was never composed", () => {
    expect(awaitingReview({ metadata: {}, approved_at: null })).toBe(false)
  })

  it("is true once copy has landed and nobody has saved", () => {
    expect(
      awaitingReview({ metadata: { composedAt: "2026-09-07T10:00:00Z" }, approved_at: null }),
    ).toBe(true)
    expect(
      awaitingReview({
        metadata: { composedAt: "2026-09-07T10:00:00Z" },
        approved_at: "2026-09-07T09:00:00Z",
      }),
    ).toBe(true)
  })

  it("is false once a save follows the generation", () => {
    expect(
      awaitingReview({
        metadata: { composedAt: "2026-09-07T10:00:00Z" },
        approved_at: "2026-09-07T10:05:00Z",
      }),
    ).toBe(false)
  })
})
