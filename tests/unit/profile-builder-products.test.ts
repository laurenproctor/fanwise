import { describe, expect, it } from "vitest"
import {
  INELIGIBLE_MESSAGES,
  arrange,
  candidatesFrom,
  counts,
  eligibilityOf,
  isReorderKey,
  moveBy,
  moveForKey,
  moveTo,
  sameArrangement,
  setAllVisible,
  toDraftProducts,
  toPresentationProducts,
  toggleVisible,
  type ArrangementRow,
  type ProductCandidate,
} from "@/lib/public/product-arrangement"

/**
 * Step 2's rules, as pure functions: which products may appear, how a stored
 * arrangement is reconciled with the workspace's current products, and what
 * every gesture does to the order. The screen and the server both call these,
 * so these are the tests that decide what a customer sees.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function candidate(n: number, overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    id: id(n),
    title: `Product ${n}`,
    typeLabel: "Template",
    imageUrl: `/ws/assets/img-${n}/preview`,
    eligibility: { eligible: true },
    existingOrder: null,
    ...overrides,
  }
}

const titles = (rows: readonly ArrangementRow[]) => rows.map((row) => row.product.title)
const shownTitles = (rows: readonly ArrangementRow[]) =>
  toPresentationProducts(rows).map((p) => p.title)

describe("eligibility comes from the product lifecycle", () => {
  it("is eligible when not archived and live on at least one channel", () => {
    expect(eligibilityOf({ archivedAt: null, liveChannelCount: 2 })).toEqual({ eligible: true })
  })

  it("is not eligible when no listing is live", () => {
    expect(eligibilityOf({ archivedAt: null, liveChannelCount: 0 })).toEqual({
      eligible: false,
      reason: "not_live",
    })
  })

  it("is not eligible when archived, even if still live somewhere", () => {
    expect(eligibilityOf({ archivedAt: "2026-09-01T00:00:00Z", liveChannelCount: 3 })).toEqual({
      eligible: false,
      reason: "archived",
    })
  })

  it("explains every ineligibility without blaming the listings", () => {
    for (const message of Object.values(INELIGIBLE_MESSAGES)) {
      expect(message).toMatch(/profile/)
      expect(message).not.toMatch(/unpublish/i)
    }
  })

  it("builds candidates from the catalog, preferring the public page's title and cover", () => {
    const catalog = [
      {
        product: {
          id: id(1),
          name: "internal-name",
          canonical_title: "Editorial Type System",
          product_type: "font",
          archived_at: null,
        },
        liveChannelNames: ["Shopify", "Etsy"],
        thumbnail: { assetId: "thumb-1" },
      },
      {
        product: {
          id: id(2),
          name: "Draft only",
          canonical_title: null,
          product_type: "template",
          archived_at: null,
        },
        liveChannelNames: [],
        thumbnail: null,
      },
    ]
    const pages = [
      {
        product_id: id(1),
        title_override: "Editorial Type",
        cover_asset_id: "cover-1",
        display_order: 3,
      },
    ]
    const candidates = candidatesFrom(catalog, pages, {
      typeLabel: (t) => t.toUpperCase(),
      imageUrl: (asset) => `/img/${asset}`,
    })

    expect(candidates[0]).toEqual({
      id: id(1),
      title: "Editorial Type",
      typeLabel: "FONT",
      imageUrl: "/img/cover-1",
      eligibility: { eligible: true },
      existingOrder: 3,
    })
    expect(candidates[1]).toMatchObject({
      title: "Draft only",
      imageUrl: null,
      eligibility: { eligible: false, reason: "not_live" },
      existingOrder: null,
    })
  })

  it("carries no field beyond what the row shows", () => {
    const [only] = candidatesFrom(
      [
        {
          product: {
            id: id(1),
            name: "n",
            canonical_title: null,
            product_type: "font",
            archived_at: null,
          },
          liveChannelNames: ["Shopify"],
          thumbnail: null,
        },
      ],
      [],
      { typeLabel: (t) => t, imageUrl: (a) => a },
    )
    expect(Object.keys(only!).sort()).toEqual(
      ["eligibility", "existingOrder", "id", "imageUrl", "title", "typeLabel"].sort(),
    )
  })
})

describe("reconciling a draft with the workspace's products", () => {
  it("starts a never-arranged draft with every eligible product shown, and no ineligible ones", () => {
    const rows = arrange(
      [],
      [
        candidate(1),
        candidate(2, { eligibility: { eligible: false, reason: "not_live" } }),
        candidate(3),
      ],
    )
    expect(titles(rows)).toEqual(["Product 1", "Product 3"])
    expect(rows.every((row) => row.visible)).toBe(true)
  })

  it("seeds the first arrangement from what is already on the public profile", () => {
    const rows = arrange(
      [],
      [candidate(1), candidate(2, { existingOrder: 1 }), candidate(3, { existingOrder: 0 })],
    )
    expect(titles(rows)).toEqual(["Product 3", "Product 2", "Product 1"])
  })

  it("keeps a stored order and flags exactly", () => {
    const rows = arrange(
      [
        { productId: id(3), visible: true },
        { productId: id(1), visible: false },
        { productId: id(2), visible: true },
      ],
      [candidate(1), candidate(2), candidate(3)],
    )
    expect(titles(rows)).toEqual(["Product 3", "Product 1", "Product 2"])
    expect(shownTitles(rows)).toEqual(["Product 3", "Product 2"])
  })

  it("appends a newly eligible product hidden, so nothing goes public unchosen", () => {
    const rows = arrange([{ productId: id(1), visible: true }], [candidate(1), candidate(2)])
    expect(titles(rows)).toEqual(["Product 1", "Product 2"])
    expect(rows[1]!.visible).toBe(false)
  })

  it("keeps a product that became ineligible, with its choice, but never shows it", () => {
    const rows = arrange(
      [
        { productId: id(1), visible: true },
        { productId: id(2), visible: true },
      ],
      [candidate(1, { eligibility: { eligible: false, reason: "archived" } }), candidate(2)],
    )
    expect(titles(rows)).toEqual(["Product 1", "Product 2"])
    expect(rows[0]!.visible).toBe(true)
    expect(shownTitles(rows)).toEqual(["Product 2"])
    expect(counts(rows)).toEqual({ selected: 1, selectable: 1 })
    expect(toDraftProducts(rows)[0]).toEqual({ productId: id(1), visible: true })
  })

  it("drops an entry whose product is not in this workspace, and ignores duplicates", () => {
    const rows = arrange(
      [
        { productId: id(99), visible: true },
        { productId: id(1), visible: true },
        { productId: id(1), visible: false },
      ],
      [candidate(1)],
    )
    expect(toDraftProducts(rows)).toEqual([{ productId: id(1), visible: true }])
  })

  it("restores the same order and selection after a refresh", () => {
    const candidates = [candidate(1), candidate(2), candidate(3), candidate(4)]
    let rows: readonly ArrangementRow[] = arrange([], candidates)
    rows = moveTo(rows, id(4), 0)
    rows = toggleVisible(rows, id(2))

    const stored = toDraftProducts(rows)
    const reloaded = arrange(stored, candidates)
    expect(reloaded).toEqual(rows)
    expect(sameArrangement(toDraftProducts(reloaded), stored)).toBe(true)
  })
})

describe("selecting products", () => {
  const base = () => arrange([], [candidate(1), candidate(2), candidate(3)])

  it("hides and shows one product, with the preview following at once", () => {
    const hidden = toggleVisible(base(), id(2))
    expect(shownTitles(hidden)).toEqual(["Product 1", "Product 3"])
    expect(counts(hidden)).toEqual({ selected: 2, selectable: 3 })
    expect(shownTitles(toggleVisible(hidden, id(2)))).toEqual([
      "Product 1",
      "Product 2",
      "Product 3",
    ])
  })

  it("keeps a hidden product's position, so showing it again puts it back where it was", () => {
    let rows: readonly ArrangementRow[] = base()
    rows = toggleVisible(rows, id(1))
    rows = moveTo(rows, id(3), 1)
    rows = toggleVisible(rows, id(1))
    expect(shownTitles(rows)).toEqual(["Product 1", "Product 3", "Product 2"])
  })

  it("selects all and clears all eligible products, leaving ineligible choices alone", () => {
    const rows = arrange(
      [
        { productId: id(1), visible: false },
        { productId: id(2), visible: true },
      ],
      [candidate(1), candidate(2, { eligibility: { eligible: false, reason: "not_live" } })],
    )
    const all = setAllVisible(rows, true)
    expect(counts(all)).toEqual({ selected: 1, selectable: 1 })
    const none = setAllVisible(rows, false)
    expect(counts(none).selected).toBe(0)
    expect(none[1]!.visible).toBe(true)
  })

  it("cannot switch an ineligible product on", () => {
    const rows = arrange(
      [{ productId: id(1), visible: false }],
      [candidate(1, { eligibility: { eligible: false, reason: "archived" } })],
    )
    expect(toggleVisible(rows, id(1))[0]!.visible).toBe(false)
  })

  it("represents an empty selection as no products, not an error", () => {
    const none = setAllVisible(base(), false)
    expect(toPresentationProducts(none)).toEqual([])
    expect(counts(none)).toEqual({ selected: 0, selectable: 3 })
    expect(toDraftProducts(none)).toHaveLength(3)
  })

  it("passes a missing image through as null rather than inventing one", () => {
    const rows = arrange([], [candidate(1, { imageUrl: null })])
    expect(toPresentationProducts(rows)[0]).toMatchObject({ imageUrl: null, imageAlt: "Product 1" })
  })
})

describe("reordering", () => {
  const rows = () => arrange([], [candidate(1), candidate(2), candidate(3), candidate(4)])

  it("moves to an index, clamped, and returns the same array when nothing moves", () => {
    expect(titles(moveTo(rows(), id(1), 2))).toEqual([
      "Product 2",
      "Product 3",
      "Product 1",
      "Product 4",
    ])
    expect(titles(moveTo(rows(), id(1), 99))).toEqual([
      "Product 2",
      "Product 3",
      "Product 4",
      "Product 1",
    ])
    const same = rows()
    expect(moveTo(same, id(1), -5)).toBe(same)
    expect(moveTo(same, id(42), 1)).toBe(same)
  })

  it("moves by one in either direction", () => {
    expect(titles(moveBy(rows(), id(3), -1))).toEqual([
      "Product 1",
      "Product 3",
      "Product 2",
      "Product 4",
    ])
    expect(titles(moveBy(rows(), id(3), 1))).toEqual([
      "Product 1",
      "Product 2",
      "Product 4",
      "Product 3",
    ])
  })

  it("maps the keyboard: arrows move by one, Home and End to the ends", () => {
    const start = rows()
    expect(titles(moveForKey(start, id(2), "ArrowUp"))[0]).toBe("Product 2")
    expect(titles(moveForKey(start, id(2), "ArrowDown"))[2]).toBe("Product 2")
    expect(titles(moveForKey(start, id(3), "Home"))[0]).toBe("Product 3")
    expect(titles(moveForKey(start, id(2), "End"))[3]).toBe("Product 2")
    expect(moveForKey(start, id(1), "ArrowUp")).toBe(start)
  })

  it("only claims reordering keys, so Tab and Space keep their jobs", () => {
    expect(["ArrowUp", "ArrowDown", "Home", "End"].every(isReorderKey)).toBe(true)
    for (const key of ["Tab", " ", "Enter", "ArrowLeft", "Escape"])
      expect(isReorderKey(key)).toBe(false)
  })

  it("stores order as array position, with no separate numbers that could drift", () => {
    const moved = moveTo(rows(), id(4), 0)
    expect(toDraftProducts(moved).map((entry) => entry.productId)).toEqual([
      id(4),
      id(1),
      id(2),
      id(3),
    ])
    expect(Object.keys(toDraftProducts(moved)[0]!).sort()).toEqual(["productId", "visible"])
  })

  it("treats an identical arrangement as unchanged and any difference as a change", () => {
    const a = toDraftProducts(rows())
    expect(sameArrangement(a, toDraftProducts(rows()))).toBe(true)
    expect(sameArrangement(a, toDraftProducts(moveBy(rows(), id(1), 1)))).toBe(false)
    expect(sameArrangement(a, toDraftProducts(toggleVisible(rows(), id(1))))).toBe(false)
  })
})
