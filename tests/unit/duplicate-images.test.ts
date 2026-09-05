import { describe, expect, it } from "vitest"
import { duplicateOrigins } from "@/lib/products/duplicate-images"

/**
 * The same picture twice in one product, which reaches a storefront as two
 * identical tiles in front of a buyer. The panel says every channel receives
 * this list in this order, so a duplicate here is a duplicate there.
 */

describe("finding a repeated image", () => {
  it("says nothing about a list with no repeats", () => {
    expect(duplicateOrigins(["a", "b", "c"])).toEqual([null, null, null])
  })

  it("points a repeat back at the first time those bytes appeared", () => {
    expect(duplicateOrigins(["a", "b", "a"])).toEqual([null, null, 0])
  })

  it("points every later copy at the original, not at each other", () => {
    // Otherwise a run of three reads as a chain, and removing the middle one
    // leaves the third claiming to duplicate something that is gone.
    expect(duplicateOrigins(["a", "a", "a"])).toEqual([null, 0, 0])
  })

  it("never marks the first occurrence, which is the one to keep", () => {
    expect(duplicateOrigins(["a", "a"])[0]).toBeNull()
  })

  it("treats a file still being measured as nothing to compare", () => {
    // A pending row has no checksum. Claiming it duplicates the cover before
    // anyone knows what it contains would be a guess.
    expect(duplicateOrigins([null, null, "a"])).toEqual([null, null, null])
  })

  it("does not treat two unmeasured files as copies of each other", () => {
    expect(duplicateOrigins(["a", null, null])).toEqual([null, null, null])
  })

  it("compares bytes, not names", () => {
    // Two different crops saved under one name are two images; the same image
    // saved twice under different names is one. Only the checksum knows.
    expect(duplicateOrigins(["a", "b"])).toEqual([null, null])
  })
})
