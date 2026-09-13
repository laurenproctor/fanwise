import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

/*
  The disclosure reads the path to close itself after a navigation. Rendering
  never navigates, so a fixed path is all the import needs.
*/
vi.mock("next/navigation", () => ({
  usePathname: () => "/pricing",
}))

import { SiteNav } from "@/components/marketing/site-nav"
import { PublicNavMenu } from "@/components/public/public-nav-menu"

/**
 * The nav as it leaves the server, for both shells.
 *
 * Below 900px (640px on a creator's page) the links move into a disclosure, and
 * which of the two rows is shown is a media query — so both are in the markup
 * and this pins what that markup contains. The browser half — the button
 * opening the panel, Escape closing it, focus going back to the button — is
 * tests/e2e/marketing.spec.ts, because none of it exists until hydration.
 *
 * The point of the duplication is that a phone gets the same links the laptop
 * does. A link that reaches the desktop row and not the panel is unreachable on
 * a phone, which is the bug this file exists to catch.
 */

const LINKS = [
  { label: "Product", href: "/" },
  { label: "Marketplaces", href: "/marketplaces" },
  { label: "FAQ", href: "#faq" },
]

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

/** The disclosure panel only, so a match cannot be the desktop row's copy. */
function panelOf(markup: string): string {
  const marker = markup.indexOf('class="fw-nav__panel')
  expect(marker, "panel is in the markup").toBeGreaterThan(-1)
  // From the tag itself, not from the class attribute: React emits id and
  // hidden ahead of class, and this assertion is partly about hidden.
  return markup.slice(markup.lastIndexOf("<div", marker))
}

describe("the marketing nav", () => {
  it("carries every link in the panel as well as the row", () => {
    const panel = panelOf(render(createElement(SiteNav, { links: LINKS })))

    for (const link of LINKS) {
      expect(panel, `${link.label} in the panel`).toContain(`href="${link.href}"`)
      expect(panel, `${link.label} in the panel`).toContain(link.label)
    }

    // The two the panel adds itself rather than receiving as links.
    expect(panel).toContain("Sign in")
    expect(panel).toContain("Get started")
  })

  it("ships the panel closed, and says so", () => {
    const markup = render(createElement(SiteNav, { links: LINKS }))

    // hidden, not absent: aria-controls has to point at something real, and a
    // panel that only exists once opened cannot be styled closed.
    expect(panelOf(markup)).toMatch(/^<div [^>]*hidden[^>]*class="fw-nav__panel/)
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain("Open menu")
    expect(markup).not.toContain("Close menu")
  })

  it("drops Sign in and the call to action from the panel when the page has none", () => {
    const panel = panelOf(
      render(createElement(SiteNav, { links: LINKS, signIn: false, cta: null })),
    )

    expect(panel).not.toContain("Sign in")
    // The separator divides links from those two; with neither, it is nothing.
    expect(panel).not.toContain("fw-nav__panel-sep")
  })

  it("names the toggle for a screen reader, with no text in the icon", () => {
    const markup = render(createElement(SiteNav, { links: LINKS }))

    expect(markup).toMatch(/<span class="sr-only">Open menu<\/span>/)
    expect(markup).toContain('aria-hidden="true"')
  })
})

describe("the public profile nav", () => {
  it("carries its links, Sign in and the call to action", () => {
    const markup = render(createElement(PublicNavMenu, { links: LINKS }))

    for (const link of LINKS) {
      expect(markup, `${link.label}`).toContain(`href="${link.href}"`)
    }
    expect(markup).toContain("Sign in")
    expect(markup).toContain("Create your profile")
    expect(markup).toContain('aria-expanded="false"')
  })
})
