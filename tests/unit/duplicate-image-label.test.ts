import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

/*
  The images panel is a client component wired to the router and to upload and
  reorder actions. Rendering touches none of them, so each is the smallest thing
  that satisfies the import.
*/
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}))
vi.mock("@/lib/products/actions", () => ({
  createUploadIntent: async () => ({ error: null }),
  deleteAssetAction: async () => ({ error: null }),
  finalizeUploadAction: async () => ({ error: null }),
  reorderProductImagesAction: async () => ({ error: null }),
}))

import { ListingImages, type ListingImage } from "@/components/channels/listing-images"

/**
 * A repeated image says which one it repeats.
 *
 * Which images repeat is decided by checksum in tests/unit/duplicate-images.test.ts,
 * and a real drop of the same bytes under another name is read back in
 * journey-01-product.spec.ts. This is the sentence on each tile: said on the
 * copy, never on the original, naming the cover or the position of the image it
 * repeats, and never said about a pending tile whose bytes are unmeasured.
 */

function image(id: string, checksum: string | null, state: ListingImage["state"] = "ready") {
  return {
    id,
    filename: `${id}.png`,
    assetType: id === "cover" ? "cover_image" : "preview_image",
    state,
    checksum,
  } satisfies ListingImage
}

function render(images: ListingImage[]): string {
  return renderToStaticMarkup(
    createElement(ListingImages, {
      workspaceSlug: "northbound-type",
      productId: "product-1",
      channelName: null,
      images,
    }),
  )
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe("the duplicate label on an image tile", () => {
  it("names the cover on the copy, once, whatever the copy is called", () => {
    const markup = render([image("cover", "aaa"), image("a-completely-different-name", "aaa")])

    expect(count(markup, "Same image as the cover")).toBe(1)
    // On the second tile, after its filename, not on the first.
    expect(markup.indexOf("Same image as the cover")).toBeGreaterThan(
      markup.indexOf("a-completely-different-name.png"),
    )
  })

  it("names the position of an original that is not the cover", () => {
    const markup = render([image("cover", "aaa"), image("second", "bbb"), image("third", "bbb")])

    expect(markup).toContain("Same image as #2")
    expect(markup).not.toContain("Same image as the cover")
  })

  it("says nothing about distinct images, or about one whose bytes are not measured yet", () => {
    expect(render([image("cover", "aaa"), image("second", "bbb")])).not.toContain("Same image")
    expect(render([image("cover", "aaa"), image("pending", null, "pending")])).not.toContain(
      "Same image",
    )
  })
})
