import { describe, expect, it } from "vitest"
import { planImageDrop } from "@/lib/products/image-drop"

/**
 * What a drop onto the images panel means.
 *
 * The interesting case is the batch. Position is the model — the first image is
 * the cover and there is no separate cover picker — so a drop of several files
 * has to number itself against the images already there. Judging each file on
 * its own would give a product four covers, and the ordering trigger would
 * refuse the write after the bytes had already been uploaded.
 */

function file(name: string, type: string) {
  return { name, type }
}

describe("which dropped files are taken", () => {
  it("takes images", () => {
    const plan = planImageDrop([file("cover.png", "image/png")], 0)
    expect(plan.ok && plan.uploads.map((u) => u.file.name)).toEqual(["cover.png"])
  })

  it("skips the files that are not images, and keeps the ones that are", () => {
    // Selecting a folder's worth of files and dragging the lot is ordinary.
    // Refusing the whole drop because one zip came along would be hostile.
    const plan = planImageDrop(
      [file("aster.zip", "application/zip"), file("shot.jpg", "image/jpeg")],
      0,
    )
    expect(plan.ok && plan.uploads.map((u) => u.file.name)).toEqual(["shot.jpg"])
    expect(plan.ok && plan.skipped).toBe(1)
  })

  it("falls back to the extension when the browser volunteers no type", () => {
    // Empty type is common rather than exotic: several file managers and
    // archive viewers hand over a file with no type at all.
    const plan = planImageDrop([file("shot.WEBP", "")], 0)
    expect(plan.ok && plan.uploads).toHaveLength(1)
  })

  it("does not guess at an extension it cannot derive from", () => {
    // Accepting a TIFF here would mint a row the derivative pipeline cannot
    // read, so the creator gets a tile that fails minutes later instead of a
    // sentence now. The set has to track DERIVABLE in sniff.ts.
    const plan = planImageDrop([file("scan.tiff", "")], 0)
    expect(plan).toEqual({ ok: false, reason: "not_images" })
  })

  it("tells an empty drag apart from a wrong one", () => {
    // Dragged text and a dragged zip need different sentences, because they
    // are different mistakes.
    expect(planImageDrop([], 0)).toEqual({ ok: false, reason: "no_files" })
    expect(planImageDrop([file("aster.zip", "application/zip")], 0)).toEqual({
      ok: false,
      reason: "not_images",
    })
  })
})

describe("what each dropped file becomes", () => {
  it("makes the first image of an empty product the cover, and only the first", () => {
    const plan = planImageDrop(
      [file("a.png", "image/png"), file("b.png", "image/png"), file("c.png", "image/png")],
      0,
    )
    expect(plan.ok && plan.uploads.map((u) => u.assetType)).toEqual([
      "cover_image",
      "preview_image",
      "preview_image",
    ])
  })

  it("adds previews when the product already has a cover", () => {
    const plan = planImageDrop([file("a.png", "image/png"), file("b.png", "image/png")], 1)
    expect(plan.ok && plan.uploads.map((u) => u.assetType)).toEqual([
      "preview_image",
      "preview_image",
    ])
  })

  it("counts existing images, not dropped ones, when choosing the cover", () => {
    // The skipped zip must not consume the cover slot.
    const plan = planImageDrop(
      [file("aster.zip", "application/zip"), file("a.png", "image/png")],
      0,
    )
    expect(plan.ok && plan.uploads[0]?.assetType).toBe("cover_image")
  })
})
