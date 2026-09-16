import { markdownToHtml } from "@/lib/text/markdown-html"
import { CURRENCIES, LIMITS } from "./config"

/**
 * Canonical values into the shapes Gumroad's fields expect. Pure and total.
 */

/**
 * Gumroad tags: 2 to 20 characters, no commas, no leading `#`, and Gumroad
 * lowercases them on save so they are lowercased here to match what a read
 * gives back. Anything that would be refused is removed rather than refused,
 * because a tag that lost a comma is still a tag and the requirement engine
 * has already had its say.
 */
export function toTag(tag: string): string {
  const cleaned = tag
    .replace(/,/g, " ")
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, LIMITS.tagMax)
    .trim()
  return cleaned.length >= LIMITS.tagMin ? cleaned : ""
}

export function toTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = toTag(raw)
    if (tag.length === 0 || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

/** The currency as Gumroad spells it, or null for one it does not sell in. */
export function toCurrency(currency: string): string | null {
  const code = currency.trim().toLowerCase()
  return code in CURRENCIES ? code : null
}

/**
 * Gumroad takes the price as an integer in the currency's smallest unit:
 * cents for most, the unit itself for yen and won.
 */
export function toPrice(price: number | null, currency: string): number | null {
  if (price === null || !Number.isFinite(price)) return null
  const code = toCurrency(currency)
  const minorUnits = code ? CURRENCIES[code]!.minorUnits : 100
  return Math.round(price * minorUnits)
}

/** The minimum price Gumroad accepts in a currency, in its own units. Zero is always free. */
export function minimumPrice(currency: string): number | null {
  const code = toCurrency(currency)
  return code ? CURRENCIES[code]!.minimum : null
}

/**
 * Gumroad renders the description as HTML and sanitizes it on its side, so
 * the Markdown goes as the same sanitized HTML Shopify and WooCommerce receive
 * (ADR 0011).
 */
export function toDescription(text: string | null): string {
  return markdownToHtml(text)
}

const PERMALINK = /^[A-Za-z0-9_-]+$/

/**
 * The buyer-facing address, and the stamp the compensating guard relies on:
 * a second create with the same permalink is refused by Gumroad, so a product
 * created twice cannot exist. Fanwise slugs already satisfy the character
 * rule; anything else is refused before a call is made.
 */
export function toPermalink(slug: string): string | null {
  const value = slug.trim().slice(0, LIMITS.permalinkMax)
  return PERMALINK.test(value) ? value : null
}
