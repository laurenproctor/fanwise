import { describe, expect, it } from "vitest"
import { buildFactSheet } from "@/lib/ai/factsheet"
import { guidanceFor } from "@/lib/ai/guidance"
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

  it("rules out invented history and visual qualities for every product", () => {
    const rules = buildPrompt(getAdapter("mock_api"), buildFactSheet(product, [])).system[0]?.text
    expect(rules).toContain("Not a history, an inspiration, an influence")
    expect(rules).toContain("You cannot see the product")
  })

  it("has a profile on every adapter, with a version", () => {
    for (const adapter of listAdapters()) {
      expect(adapter.merchandising.promptVersion, adapter.key).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
      expect(adapter.merchandising.audience.length, adapter.key).toBeGreaterThan(20)
    }
  })
})

describe("product type guidance", () => {
  const sheet = buildFactSheet(product, [])

  it("puts the typeface standard between the rules and the channel profile", () => {
    const prompt = buildPrompt(getAdapter("mock_api"), sheet, undefined, "font")
    expect(prompt.system).toHaveLength(3)
    expect(prompt.system[0]?.text).toContain("never introduce a factual claim")
    expect(prompt.system[1]?.text).toContain("PRODUCT TYPE GUIDANCE: TYPEFACES")
    expect(prompt.system[2]?.text).toBe(renderProfile(getAdapter("mock_api")))
    // One boundary, at the end of the profile, so the whole prefix caches.
    expect(prompt.system.map((block) => block.cacheBoundary === true)).toEqual([false, false, true])
  })

  it("keeps the guidance free of anything that varies per product", () => {
    const other = buildFactSheet({ ...product, name: "Other", canonical_title: "Other" }, [])
    const a = buildPrompt(getAdapter("mock_api"), sheet, undefined, "font")
    const b = buildPrompt(getAdapter("mock_api"), other, undefined, "font")
    expect(a.system).toEqual(b.system)
    expect(a.system.some((block) => block.text.includes("Aster"))).toBe(false)
  })

  it("shares the prefix between a field and a whole-listing generation", () => {
    const whole = buildPrompt(getAdapter("mock_api"), sheet, undefined, "font")
    const one = buildPrompt(getAdapter("mock_api"), sheet, "description", "font")
    expect(one.system).toEqual(whole.system)
  })

  it("versions the guidance on the row when there is guidance", () => {
    const prompt = buildPrompt(getAdapter("mock_api"), sheet, undefined, "font")
    expect(prompt.promptVersion).toMatch(
      /^\d{4}-\d{2}-\d{2}\.\d+\+\d{4}-\d{2}-\d{2}\.\d+\+font\.\d{4}-\d{2}-\d{2}\.\d+$/,
    )
    expect(prompt.inputHash).not.toBe(buildPrompt(getAdapter("mock_api"), sheet).inputHash)
  })

  it("leaves a type without a written standard exactly as it was", () => {
    const plain = buildPrompt(getAdapter("mock_api"), sheet)
    const template = buildPrompt(getAdapter("mock_api"), sheet, undefined, "template")
    expect(guidanceFor("template")).toBeNull()
    expect(template.system).toEqual(plain.system)
    expect(template.promptVersion).toBe(plain.promptVersion)
  })

  it("never hands the model a number it could repeat as a fact", () => {
    // The validator refuses a numeral or number word the FactSheet lacks, so
    // an example in the guidance ("six stylistic sets") would teach the model
    // to write a refusal. Counts in instructions are spelled as ranges of
    // advice, not as sample copy, and there are no digits at all.
    const text = guidanceFor("font")!.text
    expect(text).not.toMatch(/\d/)
    expect(text).not.toMatch(/\[[^\]]*\]/)
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
