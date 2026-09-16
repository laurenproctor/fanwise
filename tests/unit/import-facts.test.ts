import { describe, expect, it } from "vitest"
import { emptyDraftDetails, type DraftDetails } from "@/lib/imports/draft-output"
import {
  describeDetails,
  detailsFromMetadata,
  metadataWithDetails,
  supportedDetails,
} from "@/lib/imports/facts"
import { listingGaps } from "@/lib/imports/gaps"
import { emptyListingDraft } from "@/lib/imports/draft"
import type { ListingDraft } from "@/lib/imports/types"

/**
 * The structured details of a draft: kept only when the sources contain
 * them, and landing on the product without displacing what it already holds.
 */

function details(overrides: Partial<DraftDetails> = {}): DraftDetails {
  return { ...emptyDraftDetails(), ...overrides }
}

const SPECIMEN = [
  "Blimp Display — Layered Bubble Font (6 Fonts, 524 Glyphs, Cyrillic + Kana)",
  "A fat bubble-letter display typeface in six cuts. Variable? No: six static TTF fonts",
  "plus WOFF web fonts. Latin, Cyrillic and Japanese kana. Stylistic alternates and",
  "ligatures included. Blimp Display Solid, Outline and Color.",
]
  .join(" ")
  .toLowerCase()

describe("which details the sources support", () => {
  it("keeps a count the source states as digits or as a word, and drops one it does not", () => {
    const checked = supportedDetails(
      details({ styleCount: 6, glyphCount: 524, pageCount: 12 }),
      SPECIMEN,
    )
    expect(checked.details.styleCount).toBe(6)
    expect(checked.details.glyphCount).toBe(524)
    expect(checked.details.pageCount).toBeNull()
    expect(checked.dropped).toEqual([{ field: "pageCount", value: "12" }])
  })

  it("does not read 524 out of 1524, or a count out of a price", () => {
    expect(supportedDetails(details({ glyphCount: 524 }), "1524 glyphs").dropped).toHaveLength(1)
    expect(supportedDetails(details({ glyphCount: 24 }), "$24.00 each").dropped).toHaveLength(1)
    expect(supportedDetails(details({ glyphCount: 1024 }), "1,024 glyphs").dropped).toEqual([])
  })

  it("accepts a format by its name or its abbreviation, and nothing else", () => {
    const checked = supportedDetails(
      details({ fontFormats: ["ttf", "woff", "woff2", "otf"] }),
      SPECIMEN,
    )
    expect(checked.details.fontFormats).toEqual(["ttf", "woff"])
    expect(supportedDetails(details({ fontFormats: ["otf"] }), "opentype files").dropped).toEqual(
      [],
    )
  })

  it("reads a classification only in a word a person used for it", () => {
    expect(supportedDetails(details({ classification: "display" }), SPECIMEN).dropped).toEqual([])
    expect(
      supportedDetails(details({ classification: "serif" }), "a friendly sans serif").dropped,
    ).toEqual([{ field: "classification", value: "serif" }])
    expect(
      supportedDetails(details({ classification: "sans_serif" }), "a friendly sans serif").dropped,
    ).toEqual([])
  })

  it("keeps scripts, languages, style names and features the source names", () => {
    const checked = supportedDetails(
      details({
        scripts: ["Latin", "Cyrillic", "Kana", "Greek"],
        styleNames: ["Solid", "Outline", "Color", "Throwie"],
        features: ["salt", "liga", "ss01", "smcp"],
      }),
      SPECIMEN,
    )
    expect(checked.details.scripts).toEqual(["Latin", "Cyrillic", "Kana"])
    expect(checked.details.styleNames).toEqual(["Solid", "Outline", "Color"])
    expect(checked.details.features).toEqual(["salt", "liga"])
  })

  it("keeps a variable-font answer only when the source says which it is", () => {
    expect(supportedDetails(details({ isVariable: true }), SPECIMEN).details.isVariable).toBe(true)
    expect(supportedDetails(details({ isVariable: false }), SPECIMEN).details.isVariable).toBe(
      false,
    )
    expect(
      supportedDetails(details({ isVariable: true }), "a bubble font").details.isVariable,
    ).toBeNull()
  })

  it("is deterministic", () => {
    const input = details({ styleCount: 6, scripts: ["Latin"], classification: "display" })
    expect(supportedDetails(input, SPECIMEN)).toEqual(supportedDetails(input, SPECIMEN))
  })
})

describe("landing details on the product", () => {
  it("gives a product that arrived as other the metadata of the chosen type", () => {
    const metadata = metadataWithDetails({
      existing: { kind: "generic" },
      productType: "font",
      details: details({
        styleCount: 6,
        styleNames: ["Solid", "Outline"],
        isVariable: false,
        fontFormats: ["ttf", "woff"],
        glyphCount: 524,
        classification: "display",
        scripts: ["Latin", "Cyrillic"],
        languages: ["Russian"],
        features: ["SALT"],
        // Not a font's to hold, and dropped.
        pageCount: 12,
      }),
      tags: ["bubble font", "graffiti"],
    })
    expect(metadata).toEqual({
      kind: "font",
      tags: ["bubble font", "graffiti"],
      styleCount: 6,
      isVariable: false,
      formats: ["ttf", "woff"],
      glyphCount: 524,
      classification: "display",
      scripts: ["Latin", "Cyrillic"],
      languageSupport: ["Russian"],
      features: ["salt"],
      styles: [
        { key: "solid", name: "Solid" },
        { key: "outline", name: "Outline" },
      ],
    })
  })

  it("counts the styles from their names when no count was stated", () => {
    const metadata = metadataWithDetails({
      existing: { kind: "font" },
      productType: "font",
      details: details({ styleNames: ["Regular", "Bold", "Italic"] }),
      tags: [],
    })
    expect(metadata).toMatchObject({ kind: "font", styleCount: 3 })
  })

  it("never replaces what the product already holds", () => {
    const metadata = metadataWithDetails({
      existing: {
        kind: "font",
        styleCount: 9,
        formats: ["otf"],
        styles: [{ key: "a", name: "A" }],
        tags: ["typed"],
      },
      productType: "font",
      details: details({
        styleCount: 6,
        styleNames: ["Solid"],
        fontFormats: ["ttf"],
        glyphCount: 524,
      }),
      tags: ["proposed"],
    })
    expect(metadata).toMatchObject({
      styleCount: 9,
      formats: ["otf"],
      styles: [{ key: "a", name: "A" }],
      glyphCount: 524,
      // Tags come from the form, which showed the stored ones first.
      tags: ["proposed"],
    })
  })

  it("maps template and graphic details to their own shapes", () => {
    expect(
      metadataWithDetails({
        existing: { kind: "generic" },
        productType: "template",
        details: details({ software: ["Figma"], pageCount: 12, dimensions: "1920 × 1080" }),
        tags: [],
      }),
    ).toEqual({ kind: "template", software: ["Figma"], pageCount: 12, dimensions: "1920 × 1080" })
    expect(
      metadataWithDetails({
        existing: { kind: "generic" },
        productType: "icon",
        details: details({ fileFormats: ["SVG", "png"], itemCount: 240 }),
        tags: [],
      }),
    ).toEqual({ kind: "raster", fileFormats: ["svg", "png"], itemCount: 240 })
  })

  it("reads stored facts back into the draft's shape", () => {
    const stored = detailsFromMetadata({
      kind: "font",
      styleCount: 2,
      styles: [{ key: "r", name: "Regular" }],
      formats: ["otf"],
      scripts: ["Latin"],
    })
    expect(stored).toMatchObject({
      styleCount: 2,
      styleNames: ["Regular"],
      fontFormats: ["otf"],
      scripts: ["Latin"],
      glyphCount: null,
    })
    expect(detailsFromMetadata({ kind: "generic" })).toEqual(emptyDraftDetails())
  })

  it("describes only the details the chosen type can hold", () => {
    const lines = describeDetails(
      details({ styleCount: 6, classification: "sans_serif", pageCount: 12, isVariable: true }),
      "font",
    )
    expect(lines.map((line) => `${line.label}: ${line.value}`)).toEqual([
      "Classification: Sans serif",
      "Number of styles: 6",
      "Variable font: Yes",
    ])
  })
})

describe("what an import still lacks", () => {
  function draft(overrides: Partial<ListingDraft> = {}): ListingDraft {
    const base = emptyListingDraft()
    return {
      ...base,
      productType: { value: "font", origin: { kind: "creator" } },
      description: {
        value: Array.from({ length: 80 }, () => "word").join(" "),
        origin: { kind: "creator" },
      },
      shortDescription: { value: "Short.", origin: { kind: "creator" } },
      tags: { value: ["font"], origin: { kind: "creator" } },
      ...overrides,
    }
  }

  const ready = [{ id: "f", filename: "blimp.ttf", byteSize: 10, state: "ready" as const }]

  it("names each thing a font listing lacks, and how to supply it", () => {
    const gaps = listingGaps({ draft: draft(), deliverables: [], imageCount: 0 })
    expect(gaps.map((gap) => gap.key)).toEqual([
      "files",
      "images",
      "styles",
      "formats",
      "glyphs",
      "coverage",
      "classification",
    ])
    expect(gaps[0]!.how).toContain("Upload the OTF, TTF or WOFF files")
    expect(gaps.find((gap) => gap.key === "styles")!.how).toContain("Upload the font files")
  })

  it("is quiet once the details are held", () => {
    const filled = draft({
      details: {
        value: details({
          styleCount: 6,
          fontFormats: ["ttf"],
          glyphCount: 524,
          scripts: ["Latin"],
          classification: "display",
        }),
        origin: { kind: "creator" },
      },
    })
    expect(listingGaps({ draft: filled, deliverables: ready, imageCount: 2 })).toEqual([])
  })

  it("asks for a fuller description and for tags when they are thin", () => {
    const thin = draft({
      description: { value: "## Overview\n\nA font.", origin: { kind: "creator" } },
      shortDescription: { value: "", origin: { kind: "creator" } },
      tags: { value: [], origin: { kind: "creator" } },
      details: {
        value: details({
          styleCount: 1,
          fontFormats: ["otf"],
          glyphCount: 1,
          scripts: ["Latin"],
          classification: "serif",
        }),
        origin: { kind: "creator" },
      },
    })
    const gaps = listingGaps({ draft: thin, deliverables: ready, imageCount: 1 })
    expect(gaps.map((gap) => gap.key)).toEqual(["shortDescription", "description", "tags"])
  })

  it("asks a template about software and pages, not glyphs", () => {
    const template = draft({ productType: { value: "template", origin: { kind: "creator" } } })
    const keys = listingGaps({ draft: template, deliverables: ready, imageCount: 1 }).map(
      (gap) => gap.key,
    )
    expect(keys).toEqual(["software", "pages", "dimensions"])
  })

  it("asks nothing type-specific until a type is chosen", () => {
    const untyped = draft({ productType: { value: null, origin: { kind: "creator" } } })
    expect(listingGaps({ draft: untyped, deliverables: ready, imageCount: 1 })).toEqual([])
  })
})
