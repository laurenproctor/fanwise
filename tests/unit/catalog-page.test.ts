import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CatalogList, toRow, type CatalogRow } from "@/app/[slug]/catalog-list"
import { liveChannelsDetail, liveChannelsLabel } from "@/lib/catalog/summary"
import { routes } from "@/lib/routes"
import type { CatalogEntry } from "@/lib/catalog/queries"
import type { Product } from "@/lib/products/types"

/**
 * The populated catalog, rendered to markup.
 *
 * The browser half — hover, focus, narrow widths, the tip actually opening —
 * is tests/e2e/catalog.spec.ts. This half is fast and pins what the rows are
 * made of: a status that is a word and not only a colour, a live count that is
 * a sentence on its own, one action per row, and no tip on a row with nothing
 * to put in one.
 */

const SLUG = "laurens-studio-ab12"

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * The text a reader sees. Splits on tags and keeps what lies between them
 * rather than deleting tags with a replace: the output is only ever compared in
 * these assertions, but a tag-stripping replace reads to code scanning as an
 * HTML sanitizer that misses nested cases, and it is not one.
 */
function textOf(markup: string): string {
  return markup
    .split(/<[^>]*>/)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * The rows alone, without the column header.
 *
 * The header carries four glossary tips, each a <button> with its own
 * described-by copy. Assertions about what a row contains have to exclude it or
 * they are really assertions about the header.
 */
function rowsOnly(markup: string): string {
  return /<ul\b[\s\S]*<\/ul>/.exec(markup)?.[0] ?? ""
}

function anchors(markup: string): Array<{ href: string; text: string }> {
  return [...markup.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1] ?? "",
    text: textOf(m[2] ?? ""),
  }))
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Aster Grotesk",
    slug: "aster-grotesk",
    product_type: "font",
    status: "draft",
    workspace_id: "w1",
    updated_at: "2026-09-09T10:00:00.000Z",
    created_at: "2026-09-01T10:00:00.000Z",
    metadata: {},
    archived_at: null,
    base_price: null,
    brand_name: null,
    canonical_description: null,
    canonical_title: null,
    currency: "USD",
    documentation_url: null,
    license_summary: null,
    short_description: null,
    support_url: null,
    version: null,
    ...overrides,
  } as Product
}

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    product: product(),
    facts: { listings: [], assets: { preparing: 0, failed: 0 } },
    liveChannelNames: [],
    thumbnail: null,
    ...overrides,
  }
}

function rowOf(overrides: Partial<CatalogEntry> = {}): CatalogRow {
  return toRow(entry(overrides), SLUG)
}

describe("one product, one row", () => {
  it("links the name and its thumbnail to this workspace's product route", () => {
    const row = rowOf({ thumbnail: { assetId: "a1", filename: "cover.png" } })
    const markup = render(createElement(CatalogList, { rows: [row] }))

    expect(row.href).toBe(routes.product(SLUG, "aster-grotesk"))
    expect(anchors(markup).some((a) => a.href === row.href && a.text === "Aster Grotesk")).toBe(
      true,
    )
    // One link over the name and the picture, not two to the same place.
    expect(count(markup, `href="${routes.product(SLUG, "aster-grotesk")}"`)).toBe(2)
  })

  it("shows the stored cover image through the preview route, decoratively", () => {
    const markup = render(
      createElement(CatalogList, {
        rows: [rowOf({ thumbnail: { assetId: "a1", filename: "cover.png" } })],
      }),
    )

    expect(markup).toContain(`src="${routes.assetPreview(SLUG, "a1")}"`)
    // The name is the link this sits inside; an alt text would read it twice.
    expect(markup).toMatch(/<img[^>]*alt=""/)
  })

  it("falls back to a drawn placeholder rather than inventing artwork", () => {
    const markup = render(createElement(CatalogList, { rows: [rowOf()] }))

    expect(markup).not.toContain("<img")
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/)
  })

  it("names the product's type beside it", () => {
    expect(textOf(render(createElement(CatalogList, { rows: [rowOf()] })))).toContain("Font")
  })
})

describe("status is a word, never a colour", () => {
  it("writes the status out and marks the coloured dot as decoration", () => {
    const markup = render(createElement(CatalogList, { rows: [rowOf()] }))

    expect(textOf(markup)).toContain("No listings yet")
    // Every coloured dot is aria-hidden, so nothing depends on seeing it.
    expect(markup).toMatch(/aria-hidden="true"[^>]*class="[^"]*rounded-full/)
  })

  it("labels each cell for a reader who never sees the column header", () => {
    const markup = render(createElement(CatalogList, { rows: [rowOf()] }))

    // The header row is hidden below the width the grid appears at, so the
    // labels have to live in the cells or a phone loses them entirely.
    expect(markup).toContain("Status: ")
    expect(markup).toContain("Next action: ")
  })

  it("puts exactly one action on a row", () => {
    const markup = render(createElement(CatalogList, { rows: [rowOf()] }))
    expect(count(markup, "Next action: ")).toBe(1)
  })
})

describe("the live channel count and its tip", () => {
  function liveRow(names: string[]): CatalogRow {
    return {
      ...rowOf(),
      liveCount: names.length,
      liveLabel: liveChannelsLabel(names.length),
      liveDetail: liveChannelsDetail(names),
    }
  }

  it("reads as a sentence without opening anything", () => {
    const markup = render(createElement(CatalogList, { rows: [liveRow(["One", "Two"])] }))
    expect(textOf(markup)).toContain("2 live channels")
  })

  it("carries the channel names in the DOM, not only on hover", () => {
    const rows = rowsOnly(render(createElement(CatalogList, { rows: [liveRow(["One", "Two"])] })))

    // The tip's body is always present in a visually hidden span the trigger
    // points at, so it is reachable without a pointer.
    expect(rows).toContain("Live on One and Two.")
    const describedBy = /aria-describedby="([^"]+)"/.exec(rows)?.[1]
    expect(describedBy).toBeTruthy()
    expect(rows).toMatch(new RegExp(`id="${describedBy}"[^>]*>Live on One and Two\\.<`))
  })

  it("gives the tip trigger a name that says which row it belongs to", () => {
    const markup = render(createElement(CatalogList, { rows: [liveRow(["One"])] }))
    expect(markup).toContain('aria-label="Which channels Aster Grotesk is live on"')
  })

  it("renders no tip at all when nothing is live", () => {
    const rows = rowsOnly(render(createElement(CatalogList, { rows: [liveRow([])] })))

    expect(textOf(rows)).toContain("No live channels")
    expect(rows).not.toContain("aria-describedby")
    expect(rows).not.toContain("Live on")
  })
})

describe("the next action", () => {
  it("is a real link with a real route when there is something to do", () => {
    const row: CatalogRow = {
      ...rowOf(),
      action: {
        kind: "link",
        label: "Resolve issues",
        href: routes.product(SLUG, "aster-grotesk"),
      },
    }
    const markup = render(createElement(CatalogList, { rows: [row] }))

    expect(anchors(markup)).toContainEqual({
      href: routes.product(SLUG, "aster-grotesk"),
      text: "Next action: Resolve issues for Aster Grotesk",
    })
  })

  it("renders no control at all for work nobody can affect", () => {
    const row: CatalogRow = { ...rowOf(), action: { kind: "inert", label: "Preparing files" } }
    const rows = rowsOnly(render(createElement(CatalogList, { rows: [row] })))

    expect(textOf(rows)).toContain("Preparing files")
    // Not a disabled button, and not a link. A greyed-out control would suggest
    // the wait is a decision the creator could make differently.
    expect(rows).not.toMatch(/Preparing files<\/a>/)
    expect(rows).not.toContain("<button")
    expect(rows).toContain("nothing to do while this finishes")
  })
})

describe("a catalog that has grown", () => {
  it("keeps every row distinct and offers one action each", () => {
    const rows = [
      rowOf({ product: product({ id: "p1", name: "One", slug: "one" }) }),
      rowOf({ product: product({ id: "p2", name: "Two", slug: "two" }) }),
      rowOf({ product: product({ id: "p3", name: "Three", slug: "three" }) }),
    ]
    const markup = render(createElement(CatalogList, { rows }))

    expect(count(markup, "<li")).toBe(3)
    expect(count(markup, "Next action: ")).toBe(3)
    expect(markup).toContain(`href="${routes.product(SLUG, "three")}"`)
  })

  it("lets a very long name wrap rather than pushing the row sideways", () => {
    const name = "A Preposterously Long Product Name That Nobody Would Reasonably Choose To Type"
    const markup = render(
      createElement(CatalogList, { rows: [rowOf({ product: product({ name }) })] }),
    )

    expect(textOf(markup)).toContain(name)
    // min-w-0 lets the flex child shrink; break-words lets the word itself
    // break. Without both, one long name widens the whole grid column.
    expect(markup).toContain("break-words")
    expect(markup).toContain("min-w-0")
  })

  it("exposes the list as a list, with a name", () => {
    const markup = render(createElement(CatalogList, { rows: [rowOf()] }))
    expect(markup).toMatch(/<ul[^>]*role="list"[^>]*aria-label="Products"/)
  })
})
