import sanitizeHtml from "sanitize-html"
import { markdown, withoutOpaqueElements } from "./markdown"

/**
 * Markdown into HTML that is safe to hand to a storefront or render on a page.
 *
 * Rendered by `marked`, then sanitized, and the sanitizer is the part that
 * matters. A description is creator input, and Markdown passes raw HTML
 * through: without this, a `<script>` typed into the editor would reach the
 * public page and every store the product is published to. The allowlist is
 * the formatting the editor offers and nothing else — no images, no iframes,
 * no styles, no classes, no event handlers — and links may only be http,
 * https or mailto.
 *
 * Server-side only by habit rather than necessity: the sanitizer brings a
 * parser the browser does not need, and the editor has its own schema.
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "s",
  "a",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "code",
  "pre",
  "hr",
]

export interface MarkdownHtmlOptions {
  /**
   * Adds `rel="nofollow noopener noreferrer"` to every link. For a page Fanwise
   * serves, where the links are creator-submitted and outbound.
   */
  outboundLinks?: boolean
}

export function markdownToHtml(
  source: string | null | undefined,
  options: MarkdownHtmlOptions = {},
): string {
  if (!source || source.trim().length === 0) return ""
  const rendered = markdown.parse(withoutOpaqueElements(source), { async: false })

  return (
    sanitizeHtml(rendered, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: { a: ["href"], ol: ["start"] },
      allowedSchemes: ["http", "https", "mailto"],
      allowProtocolRelative: false,
      // A top-level heading belongs to the page the description sits in, never
      // to the description, so a "#" line becomes the next level down. Every
      // level below it is kept as written.
      transformTags: {
        h1: "h2",
        b: "strong",
        i: "em",
        ...(options.outboundLinks
          ? {
              a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener noreferrer" }),
            }
          : {}),
      },
      ...(options.outboundLinks
        ? { allowedAttributes: { a: ["href", "rel"], ol: ["start"] } }
        : {}),
    })
      // A link whose address the sanitizer refused keeps its words and loses the
      // anchor, rather than rendering as a link to nowhere.
      .replace(/<a(?: rel="[^"]*")?>([\s\S]*?)<\/a>/g, "$1")
      // Storefront editors show the HTML they are given; newlines between tags
      // are noise there and nothing on a page.
      .replace(/>\n+</g, "><")
      .replace(/<br \/>/g, "<br>")
      .trim()
  )
}
