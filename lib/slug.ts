/**
 * Slugs. They appear in application URLs, so they are user-visible and must stay
 * stable, lowercase and URL-safe.
 *
 * Shared by workspaces (/<slug>, unique globally) and products
 * (/<slug>/<slug>, unique per workspace). The database enforces the same shape
 * on both tables, so a slug that escapes this module still cannot reach a row.
 */

/**
 * Slugs that would be shadowed by a real route.
 *
 * Both slugs sit in a path segment shared with static routes, and Next resolves
 * a static segment before a dynamic one. A workspace slugged `sign-in` is not a
 * broken link, it is a workspace nobody can ever open, created successfully and
 * silently unreachable. The generators below treat these exactly as they treat a
 * taken slug, by adding a suffix, and a CHECK constraint refuses one that
 * escapes this module.
 *
 * Adding a route means adding its first segment here in the same commit. The
 * list in `lib/routes.ts` is the other half of this rule.
 */
export const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "auth",
  "forgot-password",
  "onboarding",
  "reset-password",
  "sign-in",
  "sign-up",
])

export const RESERVED_PRODUCT_SLUGS: ReadonlySet<string> = new Set([
  "assets",
  "channels",
  "new",
  "settings",
])

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

/**
 * Moves a slug off a reserved word, leaving every other slug untouched. Applied
 * to the base before the first insert attempt rather than after a failure,
 * because a reserved slug is not a collision the database can report: the row
 * inserts happily and the page is simply unreachable.
 */
export function avoidReserved(slug: string, reserved: ReadonlySet<string>, suffix: string): string {
  return reserved.has(slug) ? withSuffix(slug, suffix) : slug
}

export const SLUG_LIMITS = { min: MIN_SLUG_LENGTH, max: MAX_SLUG_LENGTH } as const
