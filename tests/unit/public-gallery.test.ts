import { describe, expect, it } from "vitest"
import { orderGallery } from "@/lib/public/gallery"

/**
 * The public gallery's order. The first image is the one a visitor sees
 * large, the one search engines are shown, and the one the creator chose.
 */

const assets = [
  { id: "b", asset_type: "preview_image", sort_order: 0, created_at: "2026-09-14T00:00:02Z" },
  { id: "a", asset_type: "cover_image", sort_order: 0, created_at: "2026-09-14T00:00:03Z" },
  { id: "c", asset_type: "preview_image", sort_order: 0, created_at: "2026-09-14T00:00:01Z" },
]

describe("the gallery order", () => {
  it("puts the product's cover first when every image ties on sort order", () => {
    // Uploads take the column's default, so a product nobody reordered ties
    // at zero and the cover used to land wherever the database put it.
    expect(orderGallery(assets, null).map((a) => a.id)).toEqual(["a", "c", "b"])
  })

  it("puts the page's own choice ahead of the product's cover", () => {
    expect(orderGallery(assets, "b").map((a) => a.id)).toEqual(["b", "a", "c"])
  })

  it("ignores a chosen cover that is not in the gallery", () => {
    expect(orderGallery(assets, "missing").map((a) => a.id)).toEqual(["a", "c", "b"])
  })

  it("respects a creator's order below the cover", () => {
    const ordered = [
      { id: "x", asset_type: "preview_image", sort_order: 2 },
      { id: "y", asset_type: "preview_image", sort_order: 1 },
      { id: "z", asset_type: "cover_image", sort_order: 0 },
    ]
    expect(orderGallery(ordered, null).map((a) => a.id)).toEqual(["z", "y", "x"])
  })

  it("does not change its input", () => {
    const copy = [...assets]
    orderGallery(assets, "b")
    expect(assets).toEqual(copy)
  })
})
