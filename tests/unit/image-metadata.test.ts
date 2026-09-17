import { describe, expect, it } from "vitest"
import {
  ALT_TEXT_MAX,
  altTextFor,
  altTextSchema,
  readAltText,
  readAltTextSource,
} from "@/lib/products/image-metadata"

describe("alt text on an image's metadata", () => {
  it("reads what was written and nothing for what was not", () => {
    expect(readAltText({ altText: "Facette set large in white on black." })).toBe(
      "Facette set large in white on black.",
    )
    expect(readAltText({})).toBe("")
    expect(readAltText(null)).toBe("")
    expect(readAltText({ altText: 4 })).toBe("")
  })

  it("says who wrote it, treating an unlabelled description as the creator's", () => {
    expect(readAltTextSource({ altText: "x", altTextSource: "generated" })).toBe("generated")
    expect(readAltTextSource({ altText: "x", altTextSource: "creator" })).toBe("creator")
    expect(readAltTextSource({ altText: "x" })).toBe("creator")
    expect(readAltTextSource({ altText: "", altTextSource: "generated" })).toBeNull()
    expect(readAltTextSource({})).toBeNull()
  })

  it("tells a channel the description when there is one and the product's name when there is not", () => {
    expect(altTextFor({ altText: "A specimen sheet." }, "Aster Grotesk")).toBe("A specimen sheet.")
    expect(altTextFor({ altText: "   " }, "Aster Grotesk")).toBe("Aster Grotesk")
    expect(altTextFor(undefined, "Aster Grotesk")).toBe("Aster Grotesk")
  })

  it("never hands a channel more than the cap", () => {
    expect(altTextFor({ altText: "a".repeat(400) }, "x")).toHaveLength(ALT_TEXT_MAX)
    expect(altTextSchema.safeParse("a".repeat(ALT_TEXT_MAX + 1)).success).toBe(false)
    expect(altTextSchema.safeParse(" ok ").data).toBe("ok")
  })
})
