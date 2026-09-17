import { markdown, markdownToPlainText, withoutOpaqueElements } from "@/lib/text/markdown"
import type { Token, Tokens } from "marked"

/**
 * The description transform, docs/channels/creative-market.md §6.
 *
 * Creative Market accepts a narrow markdown subset and renders anything else
 * as literal characters, so the canonical description is *converted* into
 * the subset rather than passed through: headings become bold lines, ordered
 * lists become unordered, links lose their address, and images, code, quotes
 * and tables become their words. What survives is exactly what the product
 * page can show.
 *
 * Two renderings of the result. The subset itself, for a field that takes
 * markdown; and HTML built from it here, tag by tag, for the rich-text
 * editor the form was observed to have, where pasted markdown lands as
 * asterisks. The HTML is generated from tokens this file produced, so it can
 * hold no tag this file did not write, and it needs no sanitizer, which
 * matters because an adapter is bundled to the browser.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function inlineMarkdown(tokens: readonly Token[] | undefined): string {
  if (!tokens) return ""
  return tokens.map(inlineTokenMarkdown).join("")
}

function inlineTokenMarkdown(token: Token): string {
  switch (token.type) {
    case "strong":
      return `**${inlineMarkdown((token as Tokens.Strong).tokens)}**`
    case "em":
      return `*${inlineMarkdown((token as Tokens.Em).tokens)}*`
    case "br":
      return "  \n"
    case "link":
      return inlineMarkdown((token as Tokens.Link).tokens)
    case "image":
      return (token as Tokens.Image).text
    case "codespan":
      return (token as Tokens.Codespan).text
    case "del":
      return inlineMarkdown((token as Tokens.Del).tokens)
    case "html":
      return (token as Tokens.HTML).text.replace(/<[^>]*>/g, "")
    case "escape":
      return (token as Tokens.Escape).text
    case "text": {
      const text = token as Tokens.Text
      return text.tokens ? inlineMarkdown(text.tokens) : text.text
    }
    default:
      return "tokens" in token && Array.isArray(token.tokens)
        ? inlineMarkdown(token.tokens as Token[])
        : "text" in token && typeof token.text === "string"
          ? token.text
          : ""
  }
}

function listItemMarkdown(item: Tokens.ListItem): string[] {
  // A nested list is flattened into its parent's items: the subset has no
  // indentation rule anyone published.
  const lines: string[] = []
  const inner: string[] = []
  for (const token of item.tokens) {
    if (token.type === "list") {
      for (const sub of (token as Tokens.List).items) lines.push(...listItemMarkdown(sub))
    } else if (token.type === "text" || token.type === "paragraph") {
      inner.push(inlineMarkdown((token as Tokens.Paragraph).tokens))
    } else {
      inner.push(...blocksMarkdown([token]))
    }
  }
  const head = inner.join(" ").trim()
  return head.length > 0 ? [`* ${head}`, ...lines] : lines
}

function blocksMarkdown(tokens: readonly Token[]): string[] {
  const out: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break
      case "hr":
        out.push("---")
        break
      case "paragraph":
        out.push(inlineMarkdown((token as Tokens.Paragraph).tokens))
        break
      case "heading": {
        const text = inlineMarkdown((token as Tokens.Heading).tokens).trim()
        if (text.length > 0) out.push(`**${text.replace(/^\*\*|\*\*$/g, "")}**`)
        break
      }
      case "list":
        out.push((token as Tokens.List).items.flatMap((item) => listItemMarkdown(item)).join("\n"))
        break
      case "code":
        out.push((token as Tokens.Code).text)
        break
      case "blockquote":
        out.push(...blocksMarkdown((token as Tokens.Blockquote).tokens))
        break
      case "table": {
        const table = token as Tokens.Table
        const row = (cells: Tokens.TableCell[]) =>
          cells.map((cell) => inlineMarkdown(cell.tokens)).join(" · ")
        out.push([row(table.header), ...table.rows.map(row)].join("  \n"))
        break
      }
      case "html":
        out.push((token as Tokens.HTML).text.replace(/<[^>]*>/g, "").trim())
        break
      default:
        out.push(inlineTokenMarkdown(token))
    }
  }
  return out
    .map((block) => block.replace(/[ \t]+$/gm, (m) => (m.length >= 2 ? "  " : "")).trim())
    .filter((block) => block.length > 0)
}

/** The canonical description, converted into the subset Creative Market renders. */
export function toSafeMarkdown(source: string | null | undefined): string {
  if (!source) return ""
  const tokens = markdown.lexer(withoutOpaqueElements(source))
  return blocksMarkdown(tokens).join("\n\n")
}

/** The words a buyer reads, for counting. */
export function safePlainText(safe: string): string {
  return markdownToPlainText(safe)
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

/**
 * True when the text still holds syntax outside the subset. Always false for
 * what `toSafeMarkdown` produced; kept as a rule so the requirement is a
 * check on the output and not a promise about the transform.
 */
export function hasUnsafeSyntax(safe: string): boolean {
  const tokens = markdown.lexer(safe)
  return tokens.some(unsafeToken)
}

function unsafeToken(token: Token): boolean {
  switch (token.type) {
    case "heading":
    case "code":
    case "blockquote":
    case "table":
    case "html":
    case "link":
    case "image":
      return true
    case "list":
      return (
        (token as Tokens.List).ordered ||
        (token as Tokens.List).items.some((item) => item.tokens.some(unsafeToken))
      )
    default:
      return "tokens" in token && Array.isArray(token.tokens)
        ? (token.tokens as Token[]).some(unsafeToken)
        : false
  }
}

function inlineHtml(tokens: readonly Token[] | undefined): string {
  if (!tokens) return ""
  return tokens
    .map((token) => {
      switch (token.type) {
        case "strong":
          return `<strong>${inlineHtml((token as Tokens.Strong).tokens)}</strong>`
        case "em":
          return `<em>${inlineHtml((token as Tokens.Em).tokens)}</em>`
        case "br":
          return "<br>"
        case "text": {
          const text = token as Tokens.Text
          return text.tokens ? inlineHtml(text.tokens) : escapeHtml(text.text)
        }
        case "escape":
          return escapeHtml((token as Tokens.Escape).text)
        default:
          return escapeHtml(inlineTokenMarkdown(token))
      }
    })
    .join("")
}

/** The subset as HTML: paragraphs, bold, italic, bulleted lists, rules, breaks. */
export function safeMarkdownToHtml(safe: string): string {
  const tokens = markdown.lexer(safe)
  const out: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break
      case "hr":
        out.push("<hr>")
        break
      case "paragraph":
        out.push(`<p>${inlineHtml((token as Tokens.Paragraph).tokens)}</p>`)
        break
      case "list":
        out.push(
          `<ul>${(token as Tokens.List).items
            .map(
              (item) =>
                `<li>${item.tokens
                  .map((t) =>
                    t.type === "text" || t.type === "paragraph"
                      ? inlineHtml((t as Tokens.Paragraph).tokens)
                      : escapeHtml(blocksMarkdown([t]).join(" ")),
                  )
                  .join(" ")}</li>`,
            )
            .join("")}</ul>`,
        )
        break
      default:
        out.push(`<p>${escapeHtml(blocksMarkdown([token]).join(" "))}</p>`)
    }
  }
  return out.join("")
}
