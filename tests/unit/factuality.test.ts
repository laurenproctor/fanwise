import { describe, expect, it } from "vitest"
import { describeViolations, validateFactuality } from "@/lib/ai/factuality"
import type { FactSheet } from "@/lib/ai/factsheet"
import type { ListingOutput } from "@/lib/ai/output"

/**
 * The factuality validator: one of the three things that never bend.
 *
 * Every test is a way a model could state something the facts do not support,
 * and the assertion is that the listing is refused. The positive cases matter
 * as much: a validator that refused true statements would be worked around,
 * and a validator that gets worked around is no validator.
 */

const sheet: FactSheet = {
  name: "Aster Grotesk",
  title: "Aster Grotesk",
  productType: "Font",
  description: "A grotesque in nine weights, drawn for long text. Includes Cyrillic.",
  shortDescription: "Nine weights.",
  brand: "Aster Type",
  price: { amount: 48, currency: "USD" },
  version: null,
  licenseSummary: "Desktop and web license for one user. Commercial use permitted.",
  supportUrl: null,
  documentationUrl: null,
  details: { kind: "font", styleCount: 9, formats: ["otf", "woff2"], glyphCount: 612 },
  files: { deliverableCount: 1, formats: ["zip"] },
  imageCount: 3,
}

function output(overrides: Partial<ListingOutput> = {}): ListingOutput {
  return {
    title: "Aster Grotesk",
    description: "A grotesque drawn for long text. Nine weights, from thin to black.",
    shortDescription: "A workhorse grotesque.",
    seoTitle: "",
    seoDescription: "",
    tags: ["grotesque", "sans serif"],
    ...overrides,
  }
}

function violations(o: ListingOutput) {
  const result = validateFactuality(o, sheet)
  return result.ok ? [] : result.violations
}

describe("supported statements pass", () => {
  it("accepts a listing that restates the facts in new words", () => {
    expect(validateFactuality(output(), sheet).ok).toBe(true)
  })

  it("allows numbers the facts state, as numerals or words", () => {
    expect(
      violations(
        output({
          description: "Nine weights and 612 glyphs, priced at $48. OTF and WOFF2 included.",
        }),
      ),
    ).toEqual([])
  })

  it("allows a format measured from the deliverable", () => {
    expect(violations(output({ description: "Delivered as a zip." }))).toEqual([])
  })

  it("allows a compatibility or license claim the creator's own text makes", () => {
    expect(
      violations(output({ description: "Commercial use is permitted under the license." })),
    ).toEqual([])
  })

  it("allows a compound number word that names a fact", () => {
    const withTwentyFive: FactSheet = { ...sheet, details: { kind: "font", styleCount: 25 } }
    const result = validateFactuality(
      output({ description: "Twenty-five styles." }),
      withTwentyFive,
    )
    expect(result.ok).toBe(true)
  })
})

describe("fabricated numbers fail", () => {
  it("refuses a glyph count the facts do not state", () => {
    const v = violations(output({ description: "Over 1,200 glyphs." }))
    expect(v).toEqual([{ kind: "number", value: "1,200", field: "description" }])
  })

  it("refuses a number word", () => {
    expect(violations(output({ description: "Twelve weights." }))).toEqual([
      { kind: "number", value: "Twelve", field: "description" },
    ])
  })

  it("refuses a vague quantity", () => {
    expect(violations(output({ description: "Hundreds of glyphs." }))).toEqual([
      { kind: "number", value: "Hundreds", field: "description" },
    ])
  })

  it("refuses a year and a percentage", () => {
    const v = violations(output({ description: "Updated in 2026. 100% vector." }))
    expect(v.map((x) => x.value)).toEqual(["2026", "100"])
  })

  it("reports the field, including a tag", () => {
    const v = violations(output({ tags: ["grotesque", "9 weights", "300 dpi"] }))
    expect(v).toEqual([{ kind: "number", value: "300", field: "tags" }])
  })

  it("does not read a digit inside a token as a number", () => {
    // woff2 is a format, A4 is a size, v2.1 is a version: none is "2", "4" or "1".
    expect(violations(output({ description: "WOFF2 for the web." }))).toEqual([])
  })
})

describe("fabricated formats and compatibility fail", () => {
  it("refuses a format that was not delivered or declared", () => {
    expect(violations(output({ description: "Includes TTF and EPS files." }))).toEqual([
      { kind: "format", value: "ttf", field: "description" },
      { kind: "format", value: "eps", field: "description" },
    ])
  })

  it("refuses software the facts do not mention", () => {
    expect(violations(output({ description: "Works in Photoshop and Figma." }))).toEqual([
      { kind: "compatibility", value: "photoshop", field: "description" },
      { kind: "compatibility", value: "figma", field: "description" },
    ])
  })

  it("matches the longer phrase before its shorter member", () => {
    const v = violations(output({ description: "Opens in Affinity Designer." }))
    expect(v).toEqual([{ kind: "compatibility", value: "affinity designer", field: "description" }])
  })

  it("does not fire on ordinary words that contain a format", () => {
    expect(violations(output({ description: "A gift for the painter in you." }))).toEqual([])
  })
})

describe("fabricated claims fail", () => {
  it("refuses a guarantee, a refund and a support promise", () => {
    const v = violations(
      output({ description: "Money-back guarantee, with lifetime updates and email support." }),
    )
    expect(v.map((x) => x.value)).toEqual([
      "money-back",
      "guarantee",
      "lifetime updates",
      "email support",
    ])
  })

  it("refuses standing the model cannot know", () => {
    expect(
      violations(output({ seoDescription: "The best-selling grotesque, trusted by studios." })),
    ).toEqual([
      { kind: "claim", value: "best-selling", field: "seoDescription" },
      { kind: "claim", value: "trusted by", field: "seoDescription" },
    ])
  })

  it("refuses a license claim when the facts carry no license", () => {
    const noLicense: FactSheet = { ...sheet, licenseSummary: null }
    const result = validateFactuality(
      output({ description: "Commercial license included." }),
      noLicense,
    )
    expect(result.ok).toBe(false)
  })
})

describe("describeViolations", () => {
  it("names what was claimed, deduplicated, and caps the list", () => {
    const text = describeViolations([
      { kind: "number", value: "12", field: "title" },
      { kind: "number", value: "12", field: "description" },
      { kind: "format", value: "ttf", field: "description" },
    ])
    expect(text).toBe("The model claimed something not in your product data: 12, ttf.")
  })
})
