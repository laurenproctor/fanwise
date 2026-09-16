import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { buildHandoffSteps, formatHandoffPrice, type HandoffImage } from "@/lib/channels/handoff"
import { HandoffPanel } from "@/components/channels/handoff-panel"
import { CompanionWindow } from "@/components/channels/companion-window"
import type { ChannelListingDraft } from "@/lib/channels/types"

/**
 * The assisted handoff, and the companion window that can show it.
 *
 * docs/companion-window.md is the plan. What is proven here is what can be
 * proven without a browser: the order and content of the steps, that the panel
 * says nothing implying Fanwise acted on the channel, and that the server
 * render offers no pop-out, because the server cannot know the browser has one.
 * The window itself is lib/ui/companion.ts and tests/unit/companion.test.ts.
 */

function draft(overrides: Partial<ChannelListingDraft> = {}): ChannelListingDraft {
  return {
    title: "Aster Grotesk Display",
    description: "A grotesque for editorial work.\n\nFourteen weights.",
    shortDescription: null,
    seoTitle: null,
    seoDescription: null,
    price: 15,
    currency: "USD",
    category: "font",
    tags: ["grotesque", "sans serif", "editorial"],
    metadata: {},
    ...overrides,
  }
}

const IMAGES: HandoffImage[] = [
  { assetId: "a1", filename: "01-specimen.jpg", ready: true },
  { assetId: "a2", filename: "02-waterfall.jpg", ready: false },
  { assetId: "a3", filename: "03-in-use.jpg", ready: true },
]

describe("buildHandoffSteps", () => {
  it("runs title, description, tags, price, images, submit", () => {
    const steps = buildHandoffSteps(draft(), IMAGES, "Mock Marketplace")
    expect(steps.map((step) => step.key)).toEqual([
      "title",
      "description",
      "tags",
      "price",
      "images",
      "submit",
    ])
  })

  it("gives each field the value a marketplace field accepts", () => {
    const steps = buildHandoffSteps(draft(), IMAGES, "Mock Marketplace")
    const byKey = new Map(steps.map((step) => [step.key, step]))
    expect(byKey.get("tags")).toMatchObject({
      kind: "copy",
      value: "grotesque, sans serif, editorial",
    })
    // A number with no symbol, and the currency in the label instead.
    expect(byKey.get("price")).toMatchObject({ kind: "copy", label: "Price, USD", value: "15.00" })
    expect(byKey.get("description")).toMatchObject({ kind: "copy", multiline: true })
  })

  it("leaves out images that cannot be downloaded yet, keeping channel order", () => {
    const images = buildHandoffSteps(draft(), IMAGES, "Mock Marketplace").find(
      (step) => step.key === "images",
    )
    expect(images).toMatchObject({
      kind: "files",
      files: [
        { assetId: "a1", filename: "01-specimen.jpg" },
        { assetId: "a3", filename: "03-in-use.jpg" },
      ],
    })
  })

  it("says a field is missing rather than offering an empty copy", () => {
    const steps = buildHandoffSteps(
      draft({ title: "   ", description: null, tags: [], price: null }),
      [],
      "Mock Marketplace",
    )
    for (const key of ["title", "description", "tags", "price", "images"]) {
      expect(steps.find((step) => step.key === key)?.kind).toBe("missing")
    }
  })

  it("formats prices to two decimals", () => {
    expect(formatHandoffPrice(9)).toBe("9.00")
    expect(formatHandoffPrice(23.5)).toBe("23.50")
  })
})

describe("HandoffPanel", () => {
  function render() {
    return renderToStaticMarkup(
      createElement(HandoffPanel, {
        workspaceSlug: "studio",
        channelName: "Mock Marketplace",
        productName: "Aster Grotesk",
        readiness: { resolved: 5, total: 6 },
        steps: buildHandoffSteps(draft(), IMAGES, "Mock Marketplace"),
      }),
    )
  }

  it("renders every step, the readiness count and a copy control per field", () => {
    const html = render()
    expect(html).toContain("Mock Marketplace handoff")
    expect(html).toContain("Readiness 5/6")
    for (const label of ["Copy title", "Copy description", "Copy tags", "Copy price, USD"]) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    expect(html).toContain("/studio/assets/a1/download")
    expect(html).not.toContain("/studio/assets/a2/download")
  })

  it("never says Publish, and never links to the channel", () => {
    const html = render()
    expect(html).not.toMatch(/publish/i)
    // Downloads are Fanwise's own routes. No marketplace address appears.
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1])
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) expect(href).toMatch(/^\/studio\/assets\//)
  })
})

describe("CompanionWindow", () => {
  it("renders its children once, and offers no pop-out before the browser says it can", () => {
    const html = renderToStaticMarkup(
      // createElement's types want a required `children` in props; the
      // third-argument form this rule prefers does not type-check.
      // eslint-disable-next-line react/no-children-prop
      createElement(CompanionWindow, {
        title: "t",
        children: createElement("p", null, "the handoff"),
      }),
    )
    expect(html.match(/the handoff/g)).toHaveLength(1)
    expect(html).not.toContain("Pop out")
  })
})
