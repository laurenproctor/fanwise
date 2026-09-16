import { describe, expect, it } from "vitest"
import { markdownToClaimText, markdownToPlainText } from "@/lib/text/markdown"
import { markdownToHtml } from "@/lib/text/markdown-html"
import { toDescription } from "@/lib/channels/adapters/etsy/transform"

/**
 * Descriptions are stored as Markdown and leave Fanwise in two shapes: HTML
 * for a field that takes it, plain text for one that does not. The tests pin
 * both, and the sanitizer, which is the part a regression would make dangerous.
 */

const SOURCE = [
  "# Blimp Display",
  "",
  "A **layered** bubble font.",
  "Drawn for posters.",
  "",
  "- Six fonts",
  "- Cyrillic and Kana",
  "",
  "1. Install",
  "2. Type",
  "",
  "See the [specimen](https://example.com/blimp).",
].join("\n")

describe("headings", () => {
  const STRUCTURED = [
    "# Blimp Display",
    "",
    "Opening.",
    "",
    "## What's included",
    "",
    "Six fonts.",
    "",
    "### Layers",
    "",
    "#### Solid",
    "",
    "##### Outline",
    "",
    "###### Color",
  ].join("\n")

  it("renders every level from two to six and demotes a top-level heading", () => {
    const html = markdownToHtml(STRUCTURED)
    expect(html).toContain("<h2>Blimp Display</h2>")
    expect(html).toContain("<h2>What's included</h2>")
    expect(html).toContain("<h3>Layers</h3>")
    expect(html).toContain("<h4>Solid</h4>")
    expect(html).toContain("<h5>Outline</h5>")
    expect(html).toContain("<h6>Color</h6>")
    expect(html).not.toContain("<h1")
    expect(html).toContain("<p>Six fonts.</p>")
  })

  it("reads a heading as its words in plain text", () => {
    expect(markdownToPlainText("## What's included\n\nSix fonts.")).toBe(
      "What's included\n\nSix fonts.",
    )
  })
})

describe("plain text", () => {
  it("keeps paragraphs, line breaks and lists, and drops the markup", () => {
    expect(markdownToPlainText(SOURCE)).toBe(
      [
        "Blimp Display",
        "",
        "A layered bubble font.",
        "Drawn for posters.",
        "",
        "• Six fonts",
        "• Cyrillic and Kana",
        "",
        "1. Install",
        "2. Type",
        "",
        "See the specimen (https://example.com/blimp).",
      ].join("\n"),
    )
  })

  it("is what Etsy is sent", () => {
    expect(toDescription(SOURCE)).toBe(markdownToPlainText(SOURCE))
    expect(toDescription(null)).toBe("")
  })

  it("leaves text written before Markdown as it was", () => {
    const old = "A grotesque in nine weights.\nDrawn for long text.\n\nIncludes Cyrillic."
    expect(markdownToPlainText(old)).toBe(old)
  })

  it("never carries a script body or an unsafe link address", () => {
    const text = markdownToPlainText("Hi <script>steal()</script>\n\n[x](javascript:alert(1))")
    expect(text).toBe("Hi\n\nx")
  })

  it("strips list markers for claims", () => {
    expect(markdownToClaimText("1. One\n2. Two\n\n- Three")).toBe("One\nTwo\n\nThree")
  })
})

describe("HTML", () => {
  it("renders the formatting the editor offers", () => {
    expect(markdownToHtml(SOURCE)).toBe(
      '<h2>Blimp Display</h2><p>A <strong>layered</strong> bubble font.<br>Drawn for posters.</p><ul><li>Six fonts</li><li>Cyrillic and Kana</li></ul><ol><li>Install</li><li>Type</li></ol><p>See the <a href="https://example.com/blimp">specimen</a>.</p>',
    )
  })

  it("removes scripts, handlers, styles, images and unsafe links", () => {
    const html = markdownToHtml(
      '<p style="color:red" onclick="x()">Hi</p><iframe src="https://evil"></iframe><img src=x onerror=y>\n\n[a](javascript:alert(1)) [b](//evil.example)',
    )
    expect(html).not.toMatch(/script|onclick|onerror|style|iframe|img|javascript|evil/)
    expect(html).toContain("Hi")
  })

  it("marks outbound links on a page Fanwise serves", () => {
    expect(markdownToHtml("[s](https://example.com)", { outboundLinks: true })).toBe(
      '<p><a href="https://example.com" rel="nofollow noopener noreferrer">s</a></p>',
    )
  })

  it("renders nothing for nothing", () => {
    expect(markdownToHtml(null)).toBe("")
    expect(markdownToHtml("   ")).toBe("")
  })
})
