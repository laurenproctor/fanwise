/**
 * Canonical product values into the shapes Shopify's fields expect.
 *
 * Everything here is pure and total. No provider call, no clock, no throw: a
 * transformation that can fail turns a publish failure into a Fanwise bug
 * report rather than a channel message the creator can act on.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

/**
 * Plain canonical text into `descriptionHtml`.
 *
 * Blank lines become paragraphs and single newlines become breaks. Nothing
 * else: no Markdown, no rich text, no sanitizer pass over structure the creator
 * never wrote. The canonical record holds plain text, and inventing headings or
 * emphasis from it would be the adapter stating something the creator did not,
 * which is the same failure the factuality rule guards against in lib/ai.
 */
export function toDescriptionHtml(text: string | null): string {
  if (!text) return ""
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("")
}

/**
 * Money, as Shopify wants it: a decimal string, two places, never a float in
 * JSON. A price serialized as a number is a price that can arrive as 48.989999.
 */
export function toMoney(price: number | null): string | null {
  if (price === null || !Number.isFinite(price)) return null
  return price.toFixed(2)
}

/**
 * The coarse Fanwise product type as a Shopify `productType` string.
 *
 * Title-cased from the enum member rather than mapped through a table. Shopify
 * productType is a free-text field with no taxonomy to satisfy, so a lookup
 * table here would be a second thing to update every time the enum grows, for
 * no gain. A channel with a real taxonomy, as Creative Market has, gets the
 * table it actually needs.
 */
export function toProductType(productType: string): string {
  return productType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

/**
 * The two SEO fields, truncated where Shopify's own admin truncates them: 70
 * characters for the page title, 320 for the meta description.
 *
 * Truncated rather than rejected, because neither limit is one the Admin API
 * enforces — an overlong value is accepted and then cut off in a search result,
 * where the creator will never see it happen. The editor warns at the same two
 * numbers before it gets this far, so the cut is a floor under a rule the
 * creator has already been shown, not a silent edit of their writing.
 */
function truncate(text: string | null, limit: number): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

export const SEO_TITLE_LIMIT = 70
export const SEO_DESCRIPTION_LIMIT = 320

export function toSeoTitle(text: string | null): string | null {
  return truncate(text, SEO_TITLE_LIMIT)
}

export function toSeoDescription(text: string | null): string | null {
  return truncate(text, SEO_DESCRIPTION_LIMIT)
}

/** The admin URL for a product, which is stable and works before it is live. */
export function adminProductUrl(shopDomain: string, legacyResourceId: string): string {
  return `https://${shopDomain}/admin/products/${legacyResourceId}`
}
