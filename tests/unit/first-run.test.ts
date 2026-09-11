import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { FirstRun } from "@/components/onboarding/first-run"
import { ImportListingAction } from "@/components/onboarding/import-listing-action"
import { PUBLISH_STEPS, PublishPath, publishStepStates } from "@/components/onboarding/publish-path"
import { FanOutGraphic } from "@/components/channels/fan-out-graphic"
import { routes } from "@/lib/routes"

/**
 * The first-run catalog, rendered to markup.
 *
 * The browser half, including navigation, keyboard order and narrow widths, is
 * tests/e2e/first-run.spec.ts. This half is fast and pins what the screen
 * promises: one primary action, an import that does not pretend, and progress
 * that comes from its input rather than from decoration.
 */

const SLUG = "laurens-studio-ab12"

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * The text a reader sees in a fragment of rendered markup.
 *
 * Splits on tags and keeps what lies between them, rather than deleting tags
 * with a replace. The output is only ever compared in these assertions and never
 * rendered, but a tag-stripping replace reads to code scanning as an HTML
 * sanitizer that misses nested cases, and it is not one.
 */
function textOf(markup: string): string {
  return markup
    .split(/<[^>]*>/)
    .join("")
    .trim()
}

function anchors(markup: string): Array<{ href: string; text: string }> {
  return [...markup.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1] ?? "",
    text: textOf(m[2] ?? ""),
  }))
}

describe("the first-run catalog", () => {
  const markup = render(createElement(FirstRun, { workspaceSlug: SLUG }))

  it("says what this is, once, as the page's only h1", () => {
    // Compared as text: a span keeps "marketplace-ready" from breaking at its
    // hyphen, and the words are what the specification fixes, not the markup.
    const text = textOf(markup)

    expect(count(markup, "<h1")).toBe(1)
    expect(text).toContain("Your first product starts here.")
    expect(text).toContain(
      "Add the source once. Fanwise will build the marketplace-ready versions.",
    )
    expect(markup).toContain(">Catalog<")
  })

  it("keeps heading order: the hero's h1, then the path's h2, and nothing skipped", () => {
    const levels = [...markup.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]))
    expect(levels).toEqual([1, 2])
  })

  it("has exactly one primary action, and it goes to this workspace's new-product route", () => {
    const links = anchors(markup)

    expect(links).toEqual([{ href: routes.newProduct(SLUG), text: "Create first product" }])
    expect(count(markup, "Create first product")).toBe(1)
    expect(markup).not.toMatch(/New product|Create your first product|Create product/)
  })

  it("does not render the populated catalog's table", () => {
    expect(markup).not.toContain("<table")
  })

  it("marks import as unavailable, because no import flow exists", () => {
    expect(markup).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Import a live listing<\/button>/)
    expect(markup).toContain("Coming soon")
  })

  it("starts the path at step one with nothing complete", () => {
    expect(count(markup, 'aria-current="step"')).toBe(1)
    expect(count(markup, "Complete: ")).toBe(0)
  })
})

describe("the import action", () => {
  it("is a disabled-but-focusable button described as coming soon when there is no route", () => {
    const markup = render(createElement(ImportListingAction, { href: null }))

    expect(markup).not.toContain("<a")
    expect(markup).not.toMatch(/\bdisabled=""/)
    const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1]
    expect(describedBy).toBeTruthy()
    expect(markup).toMatch(new RegExp(`id="${describedBy}"[^>]*>Coming soon<`))
  })

  it("becomes a real link, with no coming-soon label, once a route exists", () => {
    const markup = render(createElement(ImportListingAction, { href: "/studio/import" }))

    expect(anchors(markup)).toEqual([{ href: "/studio/import", text: "Import a live listing" }])
    expect(markup).not.toContain("Coming soon")
    expect(markup).not.toContain("aria-disabled")
  })
})

describe("the path to publish", () => {
  it("has the four steps, in order", () => {
    expect(PUBLISH_STEPS.map((step) => step.title)).toEqual([
      "Create a product",
      "Choose marketplaces",
      "Review your listings",
      "Publish",
    ])
  })

  it("derives every step's state from the completed count alone", () => {
    expect(publishStepStates(0)).toEqual(["current", "upcoming", "upcoming", "upcoming"])
    expect(publishStepStates(2)).toEqual(["complete", "complete", "current", "upcoming"])
    expect(publishStepStates(4)).toEqual(["complete", "complete", "complete", "complete"])
  })

  it("clamps a count it cannot honour rather than inventing progress", () => {
    expect(publishStepStates(-3)).toEqual(publishStepStates(0))
    expect(publishStepStates(9)).toEqual(publishStepStates(4))
    expect(publishStepStates(1.7)).toEqual(publishStepStates(1))
  })

  it("states each step in words as well as form, and counts nothing in prose", () => {
    const markup = render(createElement(PublishPath, { completed: 2 }))

    expect(markup).not.toMatch(/\d of \d complete/)
    expect(count(markup, "Complete: ")).toBe(2)
    expect(count(markup, "Current step: ")).toBe(1)
    expect(count(markup, "Upcoming: ")).toBe(1)
    expect(markup).toMatch(/aria-current="step"[\s\S]*?Current step: <\/span>Review your listings/)
  })
})

describe("the fan-out graphic", () => {
  const markup = render(createElement(FanOutGraphic))

  it("names each destination as text in a labelled list", () => {
    expect(markup).toContain('aria-label="Channels"')
    for (const name of ["Etsy", "Creative Market", "Gumroad", "Shopify", "Adobe", "And more"]) {
      expect(markup, name).toMatch(new RegExp(`<li[^>]*>[\\s\\S]*?>${name}</span></li>`))
    }
  })

  it("hides the drawing from assistive technology and ships no logo images", () => {
    expect(markup).toMatch(/<div aria-hidden="true"[^>]*><svg/)
    expect(markup).not.toContain("<img")
  })
})
