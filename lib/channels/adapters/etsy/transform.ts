import { LIMITS } from "./config"

/**
 * Canonical values into the shapes Etsy's fields expect. Pure and total.
 */

/**
 * Etsy tags: letters, numbers, spaces, hyphens and a few symbols, at most
 * twenty characters. Anything else is removed rather than refused, because a
 * tag that lost an ampersand is still a tag and the requirement engine has
 * already had its say on count and length.
 */
export function toTag(tag: string): string {
  return tag
    .replace(/[^\p{L}\p{N} \-™©®]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.tagLength)
    .trim()
}

export function toTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = toTag(raw)
    if (tag.length === 0) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** Etsy takes the price as a number in the shop's currency. */
export function toPrice(price: number | null): number | null {
  if (price === null || !Number.isFinite(price)) return null
  return Math.round(price * 100) / 100
}

/**
 * Etsy strips formatting from descriptions, so the canonical plain text goes
 * as it is, with Windows line endings normalized and trailing space removed.
 */
export function toDescription(text: string | null): string {
  if (!text) return ""
  return text.replace(/\r\n/g, "\n").trim()
}

export function listingUrl(listingId: number): string {
  return `https://www.etsy.com/listing/${listingId}`
}

export function editUrl(listingId: number): string {
  return `https://www.etsy.com/your/shops/me/tools/listings/${listingId}`
}
