/**
 * Slugs. They appear in application URLs, so they are user-visible and must stay
 * stable, lowercase and URL-safe.
 *
 * Shared by workspaces (/w/<slug>, unique globally) and products
 * (/w/<slug>/products/<slug>, unique per workspace). The database enforces the
 * same shape on both tables, so a slug that escapes this module still cannot
 * reach a row.
 */

const MAX_SLUG_LENGTH = 48
const MIN_SLUG_LENGTH = 3
const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

/** Deterministic. Same name in, same slug out, with no randomness. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    // Strip combining marks so "Café" becomes "cafe" rather than "caf".
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "")

  return base
}

/**
 * A short random suffix, used only when a slug is already taken. Kept out of
 * slugify() so the common path stays deterministic and testable.
 */
export function randomSuffix(length = 4, random: () => number = Math.random): string {
  let out = ""
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(random() * SUFFIX_ALPHABET.length)
    out += SUFFIX_ALPHABET[index] ?? "0"
  }
  return out
}

/**
 * Appends a suffix, trimming the base first so the result still fits the column.
 * Used to resolve a collision, never speculatively.
 */
export function withSuffix(base: string, suffix: string): string {
  const room = MAX_SLUG_LENGTH - suffix.length - 1
  const trimmed = base.slice(0, Math.max(room, 0)).replace(/-+$/g, "")
  return trimmed.length > 0 ? `${trimmed}-${suffix}` : suffix
}

/**
 * Pads a slug that came out shorter than the column allows, which happens for
 * one and two character workspace names.
 */
export function ensureMinimumLength(slug: string, suffix: string): string {
  if (slug.length >= MIN_SLUG_LENGTH) return slug
  return withSuffix(slug, suffix)
}

export const SLUG_LIMITS = { min: MIN_SLUG_LENGTH, max: MAX_SLUG_LENGTH } as const
