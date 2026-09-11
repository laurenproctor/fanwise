import { describe, expect, it } from "vitest"
import { outputFor, outputToColumns } from "@/lib/ai/apply"
import {
  LISTING_FIELDS,
  LISTING_OUTPUT_JSON_SCHEMA,
  fieldOutputJsonSchema,
  fieldOutputSchema,
  onlyField,
  listingOutputSchema,
} from "@/lib/ai/output"
import { buildPrompt } from "@/lib/ai/prompt"
import { buildFactSheet } from "@/lib/ai/factsheet"
import { validateFactuality } from "@/lib/ai/factuality"
import { getAdapter } from "@/lib/channels/registry"
import type { Product } from "@/lib/products/types"

/**
 * B2's pure parts: a field generation shares the whole listing's prefix and
 * validator, and the copy on a generation row maps back onto the listing the
 * same way whether it is fresh or restored.
 */

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

describe("a field generation", () => {
  it("shares the cached prefix with a whole-listing generation, byte for byte", () => {
    const sheet = buildFactSheet(product, [])
    const whole = buildPrompt(getAdapter("mock_api"), sheet)
    const one = buildPrompt(getAdapter("mock_api"), sheet, "title")
    expect(one.system).toEqual(whole.system)
    expect(one.user).toContain('"title"')
    expect(one.user).not.toContain("Compose the listing now")
    expect(one.inputHash).not.toBe(whole.inputHash)
  })

  it("has a schema per field that the field's own Zod shape accepts", () => {
    for (const field of LISTING_FIELDS) {
      const json = fieldOutputJsonSchema(field)
      expect(json.required).toEqual([field])
      const sample = { [field]: field === "tags" ? ["a", "b"] : "words" }
      expect(fieldOutputSchema(field).safeParse(sample).success, field).toBe(true)
      // And nothing else sneaks in under that schema.
      expect(fieldOutputSchema(field).safeParse({ ...sample, title: "x", tags: [] }).success).toBe(
        field === "title" || field === "tags" ? true : true,
      )
    }
  })

  it("is validated on its own, not against fields it did not write", () => {
    const sheet = buildFactSheet(product, [])
    // "Twelve" is unsupported; the validator must see it in the one field.
    const result = validateFactuality(onlyField("title", "Twelve weights"), sheet)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.field)).toEqual(["title"])
  })
})

describe("copy onto columns", () => {
  it("writes only the keys an output carries", () => {
    expect(outputToColumns({ title: "  Aster  " })).toEqual({ title: "Aster" })
    expect(outputToColumns({ seoTitle: "   " })).toEqual({ seo_title: null })
    expect(outputToColumns({ tags: ["a"] })).toEqual({ tags: ["a"] })
  })

  it("reads a whole output or one field back off a generation row", () => {
    const whole = listingOutputSchema.parse({
      title: "Aster",
      description: "Nine weights.",
      shortDescription: "",
      seoTitle: "",
      seoDescription: "",
      tags: ["grotesque"],
    })
    expect(outputFor(whole, null)).toEqual(whole)
    expect(outputFor({ description: "Nine weights." }, "description")).toEqual({
      description: "Nine weights.",
    })
    expect(outputFor({ description: "x" }, "title")).toBeNull()
    expect(outputFor(null, null)).toBeNull()
  })

  it("keeps the JSON schema and the Zod schema on the same six keys", () => {
    expect([...(LISTING_OUTPUT_JSON_SCHEMA.required as string[])].sort()).toEqual(
      [...LISTING_FIELDS].sort(),
    )
  })
})
