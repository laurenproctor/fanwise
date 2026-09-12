import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import NotFound, { metadata } from "@/app/not-found"
import { marketingRoutes } from "@/lib/routes"

/**
 * The root not-found page, rendered to markup.
 *
 * That an unknown URL actually reaches it, with a 404, is a browser question and
 * lives in tests/e2e/not-found.spec.ts. This half pins what is decidable here:
 * the words, where each way out goes, and that the drawing stays out of the
 * accessibility tree.
 */

const markup = renderToStaticMarkup(createElement(NotFound))

/** The href of the link whose text is `label`. */
function hrefOf(label: string): string | undefined {
  const match = markup.match(new RegExp(`<a[^>]*href="([^"]*)"[^>]*>${label}</a>`))
  return match?.[1]
}

describe("the not-found page", () => {
  it("has one h1, and it says what happened", () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1)
    expect(markup).toContain(">This listing didn’t make it to the marketplace.</h1>")
    expect(markup).toContain("The page may have moved, changed, or never gone live.")
    expect(markup).toContain(">Not found</span>")
  })

  it("offers three ways out, each to a route that exists for a visitor with or without a session", () => {
    // /sign-in forwards a signed-in creator to their workspace, so it is the
    // dashboard entry that is also safe to show a stranger.
    expect(hrefOf("Go to dashboard")).toBe(marketingRoutes.signIn)
    expect(hrefOf("Browse products")).toBe(marketingRoutes.landing)
    expect(hrefOf("Return to Fanwise")).toBe(marketingRoutes.landing)
  })

  it("renders in the shared marketing nav and footer, not a copy of them", () => {
    expect(markup).toContain('class="fw-nav"')
    expect(markup).toContain('class="fw-footer"')
    // Nothing that belongs to a signed-in workspace.
    expect(markup).not.toContain("Sign out")
  })

  it("keeps the drawing, broken route included, out of the accessibility tree", () => {
    const drawing = markup.match(/<div aria-hidden="true" class="fw-nf-grid">/)
    expect(drawing).not.toBeNull()
    expect(markup).toContain('data-testid="broken-route"')
    expect(markup).toContain(">404</span>")
  })

  it("names itself in the title", () => {
    expect(metadata.title).toBe("Page not found · Fanwise")
  })
})
