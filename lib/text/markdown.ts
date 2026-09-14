import { Marked, type Token, type Tokens } from "marked"

/**
 * Descriptions are Markdown.
 *
 * The canonical record holds the creator's words and the structure they gave
 * them — paragraphs, lists, emphasis, links — in a format no channel owns. Each
 * consumer then asks for what it can take: an HTML field gets sanitized HTML
 * (see `./markdown-html`), a plain-text field gets the projection below, and so
 * do the checks that count or read words, because a character limit or a
 * factual claim is about what a buyer reads, not the markup around it.
 *
 * Plain text written before this was Markdown already, near enough: blank lines
 * were paragraphs then and are now. Single newlines stay line breaks (`breaks`),
 * which is what they meant when they were typed.
 *
 * This module holds no sanitizer and is safe to import in the browser, where
 * the editor's counter uses it.
 */

export const markdown = new Marked({ gfm: true, breaks: true })

const SAFE_HREF = /^(?:https?:|mailto:)/i

/**
 * Raw HTML elements whose contents are never words: a script's body is not
 * part of a description, in any projection of it.
 */
export function withoutOpaqueElements(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .replace(/<(script|style|iframe|object|template)\b[\s\S]*?<\/\1\s*>/gi, "")
}

function inline(tokens: readonly Token[] | undefined): string {
  if (!tokens) return ""
  return tokens.map(inlineToken).join("")
}

function inlineToken(token: Token): string {
  switch (token.type) {
    case "br":
      return "\n"
    case "link": {
      const link = token as Tokens.Link
      const text = inline(link.tokens)
      // The address is part of what the reader is told, so a plain-text field
      // carries it and a check reads it.
      return SAFE_HREF.test(link.href) && link.href !== text ? `${text} (${link.href})` : text
    }
    case "image":
      return (token as Tokens.Image).text
    case "codespan":
    case "escape":
      return decodeEntities((token as Tokens.Codespan).text)
    case "html":
      return (token as Tokens.HTML).text.replace(/<[^>]*>/g, "")
    case "text": {
      const text = token as Tokens.Text
      return text.tokens ? inline(text.tokens) : decodeEntities(text.text)
    }
    default:
      return "tokens" in token && Array.isArray(token.tokens)
        ? inline(token.tokens as Token[])
        : "text" in token && typeof token.text === "string"
          ? decodeEntities(token.text)
          : ""
  }
}

function blocks(tokens: readonly Token[]): string[] {
  const out: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case "space":
      case "hr":
        break
      case "paragraph":
      case "heading":
        out.push(inline((token as Tokens.Paragraph).tokens))
        break
      case "code":
        out.push((token as Tokens.Code).text)
        break
      case "blockquote":
        out.push(...blocks((token as Tokens.Blockquote).tokens))
        break
      case "list": {
        const list = token as Tokens.List
        const start = typeof list.start === "number" ? list.start : 1
        out.push(
          list.items
            .map((item, index) => {
              const marker = list.ordered ? `${start + index}.` : "•"
              return `${marker} ${blocks(item.tokens).join("\n")}`
            })
            .join("\n"),
        )
        break
      }
      case "table": {
        const table = token as Tokens.Table
        const row = (cells: Tokens.TableCell[]) =>
          cells.map((cell) => inline(cell.tokens)).join(" · ")
        out.push([row(table.header), ...table.rows.map(row)].join("\n"))
        break
      }
      case "html":
        out.push((token as Tokens.HTML).text.replace(/<[^>]*>/g, "").trim())
        break
      default:
        out.push(inlineToken(token))
    }
  }
  return out.map((block) => block.trim()).filter((block) => block.length > 0)
}

/**
 * What a reader sees, as plain text: paragraphs separated by a blank line,
 * list items one per line with their marker, links followed by their address.
 * Emphasis and headings become their words.
 */
export function markdownToPlainText(source: string | null | undefined): string {
  if (!source) return ""
  const tokens = markdown.lexer(withoutOpaqueElements(source))
  return blocks(tokens).join("\n\n")
}

/**
 * The same projection with no list markers, for checks that read claims.
 *
 * An ordered list's "1." is structure, not a count, and a validator that reads
 * numerals would otherwise refuse every numbered list it did not write.
 */
export function markdownToClaimText(source: string | null | undefined): string {
  return markdownToPlainText(source)
    .split("\n")
    .map((line) => line.replace(/^(?:•|\d+\.) /, ""))
    .join("\n")
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
}
