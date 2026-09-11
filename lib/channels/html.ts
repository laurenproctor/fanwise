/**
 * Plain canonical text into the HTML a description field expects.
 *
 * Blank lines become paragraphs and single newlines become breaks. Nothing
 * else: no Markdown, no rich text, no sanitizer pass over structure the creator
 * never wrote. The canonical record holds plain text, and inventing headings or
 * emphasis from it would be the adapter stating something the creator did not,
 * which is the same failure the factuality rule guards against in lib/ai.
 *
 * Shared because two channels want exactly this and an adapter that
 * reimplemented it would eventually disagree about what a newline means.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

export function plainTextToHtml(text: string | null): string {
  if (!text) return ""
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("")
}
