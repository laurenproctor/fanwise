import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  buildHandoffSteps,
  formatHandoffPrice,
  handoffSteps,
  type HandoffImage,
  type HandoffStep,
} from "@/lib/channels/handoff"
import { HandoffPanel, groupSteps } from "@/components/channels/handoff-panel"
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

/**
 * A channel with an editor of its own shape declares its order on the
 * adapter, and the panel groups what it declares. What is held here is the
 * shared half: delegation, grouping, the note step, the renamed download, and
 * that a sectioned handoff still says nothing a flat one would not.
 */
describe("a channel-ordered handoff", () => {
  const sectioned: HandoffStep[] = [
    {
      kind: "files",
      key: "canvas",
      label: "Images",
      section: "Canvas",
      files: [{ assetId: "a1", filename: "01-specimen.jpg", downloadAs: "01-specimen.jpg" }],
      note: "In order.",
    },
    {
      kind: "copy",
      key: "price",
      label: "Price, USD",
      section: "Attach",
      value: "24.00",
      multiline: false,
      note: "You receive about $15.80.",
    },
    { kind: "note", key: "add", label: "Add it", section: "Attach", text: "Click Add, then Done." },
    {
      kind: "submit",
      key: "submit",
      label: "Make it public",
      section: "Finish",
      text: "Then paste the address below.",
    },
  ]

  it("is used when the adapter declares one, and the generic order otherwise", () => {
    const input = {
      draft: draft(),
      subject: { product: {} as never, assets: [] },
      images: IMAGES,
      renditions: [],
    }
    expect(handoffSteps({ name: "Mock Marketplace" }, input).map((s) => s.key)).toEqual([
      "title",
      "description",
      "tags",
      "price",
      "images",
      "submit",
    ])
    expect(handoffSteps({ name: "Own", buildHandoff: () => sectioned }, input)).toBe(sectioned)
  })

  it("groups consecutive steps by section and leaves unsectioned steps alone", () => {
    expect(groupSteps(sectioned).map((g) => [g.section, g.steps.length])).toEqual([
      ["Canvas", 1],
      ["Attach", 2],
      ["Finish", 1],
    ])
    expect(
      groupSteps(buildHandoffSteps(draft(), IMAGES, "M")).every((g) => g.section === null),
    ).toBe(true)
  })

  it("renders the sections numbered, the note under the price, and the renamed download", () => {
    const html = renderToStaticMarkup(
      createElement(HandoffPanel, {
        workspaceSlug: "studio",
        channelName: "Own",
        productName: "Aster Grotesk",
        readiness: null,
        steps: sectioned,
      }),
    )
    expect(html).toContain("Canvas")
    expect(html).toContain("Attach")
    expect(html).toContain("You receive about $15.80.")
    expect(html).toContain("Click Add, then Done.")
    expect(html).toContain('href="/studio/assets/a1/download?name=01-specimen.jpg"')
    expect(html).toContain('aria-label="Copy price, USD"')
    expect(html).not.toMatch(/fanwise (has )?published/i)
  })
})
