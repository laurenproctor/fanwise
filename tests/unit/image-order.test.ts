import { describe, expect, it } from "vitest"
import {
  REORDERABLE_ASSET_TYPES,
  isReorderable,
  planImageOrder,
  type ImageOrderPlan,
} from "@/lib/products/image-order"
import { IMAGE_ASSET_TYPES, type AssetType, type ProductAsset } from "@/lib/products/types"

/**
 * The reorder decision, which is the part of dragging an image that can be
 * wrong in a way nobody notices.
 *
 * The database test next door proves the trigger permits the write. This proves
 * the write is the right one: that position one becomes the cover, that the
 * rest do not, and that an order which cannot be trusted is refused whole
 * rather than applied in part.
 */

type Row = Pick<ProductAsset, "id" | "asset_type">

function row(id: string, asset_type: AssetType = "preview_image"): Row {
  return { id, asset_type }
}

/** Narrows to the success case, and fails the test rather than throwing on it. */
function writesOf(plan: ImageOrderPlan) {
  expect(plan.ok, "expected the plan to be accepted").toBe(true)
  if (!plan.ok) throw new Error("unreachable")
  return plan.writes
}

describe("position is the model", () => {
  const rows = [row("a"), row("b"), row("c")]

  it("numbers positions from zero, in the order given", () => {
    const writes = writesOf(planImageOrder(["c", "a", "b"], rows))
    expect(writes.map((w) => [w.id, w.sortOrder])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ])
  })

  it("makes the first image the cover and every other one a preview", () => {
    const writes = writesOf(planImageOrder(["b", "a", "c"], rows))
    expect(writes.map((w) => w.assetType)).toEqual([
      "cover_image",
      "preview_image",
      "preview_image",
    ])
  })

  it("demotes the outgoing cover", () => {
    // The whole point of writing asset_type as well as sort_order. Without this
    // the comparator would keep floating the old cover to the front and the
    // drag would appear not to have worked.
    const withCover = [row("a", "cover_image"), row("b")]
    const writes = writesOf(planImageOrder(["b", "a"], withCover))
    expect(writes.find((w) => w.id === "a")?.assetType).toBe("preview_image")
    expect(writes.find((w) => w.id === "b")?.assetType).toBe("cover_image")
  })

  it("makes a lone image the cover", () => {
    expect(writesOf(planImageOrder(["a"], [row("a")]))).toEqual([
      { id: "a", sortOrder: 0, assetType: "cover_image" },
    ])
  })

  it("treats an empty gallery as nothing to do rather than an error", () => {
    expect(planImageOrder([], [])).toEqual({ ok: true, writes: [] })
  })

  it("is stable: the same order twice produces the same writes", () => {
    expect(planImageOrder(["a", "b", "c"], rows)).toEqual(planImageOrder(["a", "b", "c"], rows))
  })
})

describe("an order that cannot be trusted is refused whole", () => {
  it("refuses an id the workspace cannot see", () => {
    // The authorization case. An id from another workspace does not come back
    // from the scoped select, so it arrives here as an id with no row.
    const plan = planImageOrder(["a", "stolen"], [row("a")])
    expect(plan).toEqual({ ok: false, reason: "unknown_assets" })
  })

  it("refuses a duplicated id", () => {
    // Would write two positions to one row and silently drop another asset out
    // of the ordering.
    const plan = planImageOrder(["a", "a", "b"], [row("a"), row("b")])
    expect(plan).toEqual({ ok: false, reason: "unknown_assets" })
  })

  it("refuses a deliverable, which is the outcome the selector exists to prevent", () => {
    // A buyer's zip promoted to a public product picture.
    const plan = planImageOrder(["d"], [row("d", "deliverable")])
    expect(plan).toEqual({ ok: false, reason: "not_reorderable" })
  })

  it("refuses a thumbnail, which is an image and still not reorderable", () => {
    // The distinction this module exists to hold. isImageAssetType would accept
    // a thumbnail; the database trigger would not, and the creator would get a
    // constraint violation instead of a sentence.
    const plan = planImageOrder(["t"], [row("t", "thumbnail")])
    expect(plan).toEqual({ ok: false, reason: "not_reorderable" })
  })

  it("refuses the whole order when one member of it is bad", () => {
    const plan = planImageOrder(["a", "b", "d"], [row("a"), row("b"), row("d", "deliverable")])
    expect(plan.ok).toBe(false)
  })
})

describe("the reorderable pair matches the migration", () => {
  it("is exactly cover_image and preview_image", () => {
    // These two move together with enforce_asset_immutability(). If the trigger
    // ever widens, this is the line that has to change with it.
    expect([...REORDERABLE_ASSET_TYPES].sort()).toEqual(["cover_image", "preview_image"])
  })

  it("is narrower than the set of image types", () => {
    const images = IMAGE_ASSET_TYPES as readonly AssetType[]
    for (const type of REORDERABLE_ASSET_TYPES) expect(images).toContain(type)
    expect(REORDERABLE_ASSET_TYPES.length).toBeLessThan(images.length)
    expect(isReorderable("thumbnail")).toBe(false)
  })
})
