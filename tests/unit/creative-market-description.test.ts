import { describe, expect, it } from "vitest"
import {
  hasUnsafeSyntax,
  safeMarkdownToHtml,
  safePlainText,
  toSafeMarkdown,
  wordCount,
} from "@/lib/channels/adapters/creative-market/description"

/**
 * The description transform, docs/channels/creative-market.md §6: what is
 * kept, what is converted, and that the HTML is built from the subset alone.
 */

describe("toSafeMarkdown", () => {
  it("keeps bold, italic, bulleted lists and rules", () => {
    const safe = toSafeMarkdown("A **bold** and *quiet* start.\n\n- one\n- two\n\n---\n\nEnd.")
    expect(safe).toBe("A **bold** and *quiet* start.\n\n* one\n* two\n\n---\n\nEnd.")
    expect(hasUnsafeSyntax(safe)).toBe(false)
  })

  it("converts headings to bold lines, ordered lists to bullets, and links to their words", () => {
    const safe = toSafeMarkdown(
      "## What is included\n\n1. Fourteen OTF files\n2. A [license](https://example.com/eula)\n\n> Quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |",
    )
    expect(safe).toContain("**What is included**")
    expect(safe).toContain("* Fourteen OTF files\n* A license")
    expect(safe).not.toContain("https://")
    expect(safe).toContain("Quoted")
    expect(safe).toContain("a · b")
    expect(hasUnsafeSyntax(safe)).toBe(false)
  })

  it("drops images, code fences and raw HTML down to their words", () => {
    const safe = toSafeMarkdown(
      "![alt words](x.png)\n\n```\ncode line\n```\n\n<script>alert(1)</script><b>kept</b>",
    )
    expect(safe).toContain("alt words")
    expect(safe).toContain("code line")
    expect(safe).not.toContain("<")
    expect(safe).toContain("kept")
  })

  it("flattens a nested list into its parent's items", () => {
    const safe = toSafeMarkdown("- outer\n  - inner\n- next")
    expect(safe).toBe("* outer\n* inner\n* next")
  })

  it("is empty for nothing", () => {
    expect(toSafeMarkdown(null)).toBe("")
    expect(toSafeMarkdown("   ")).toBe("")
  })
})

describe("hasUnsafeSyntax", () => {
  it("names what the subset lacks", () => {
    for (const text of [
      "# heading",
      "1. one",
      "[a](https://x.y)",
      "> quote",
      "`code`\n\n```\nx\n```",
      "| a |\n|---|\n| b |",
    ]) {
      expect(hasUnsafeSyntax(text), text).toBe(true)
    }
    expect(hasUnsafeSyntax("**a** *b*\n\n* c\n\n---")).toBe(false)
  })
})

describe("safeMarkdownToHtml", () => {
  it("renders only paragraphs, bold, italic, lists, rules and breaks, escaped", () => {
    const html = safeMarkdownToHtml("A **b** & *c*  \nline two\n\n* one\n* two < three\n\n---")
    expect(html).toBe(
      "<p>A <strong>b</strong> &amp; <em>c</em><br>line two</p><ul><li>one</li><li>two &lt; three</li></ul><hr>",
    )
  })
})

describe("words", () => {
  it("counts the words a buyer reads, not the markup", () => {
    const plain = safePlainText("**Three** *bold* words\n\n* and\n* two")
    expect(wordCount(plain)).toBe(5)
    expect(wordCount("")).toBe(0)
  })
})
