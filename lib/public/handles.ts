/**
 * Public handles and public product slugs.
 *
 * A handle is the whole of a creator's public address: `/@northline-studio`.
 * It is the most visible string Fanwise stores and the only one printed in
 * other people's portfolios, so the rules here are stricter than the ones
 * `lib/slug.ts` applies to a workspace, which is an internal address a creator
 * rarely types.
 *
 * The database enforces the same shape (`public_profiles_handle_format`,
 * `public_profiles_handle_not_reserved`), so a handle that escapes this module
 * still cannot reach a row. This half exists to say *why* in a sentence a
 * creator can read while they are typing.
 */

/**
 * Handles a route or a platform concept would shadow.
 *
 * Two different collisions live in this one list, and it is worth separating
 * them because only one is a routing fact.
 *
 * The routing half: `/@handle` lives in its own namespace, so a handle cannot
 * collide with `/pricing` the way a workspace slug can. But `/@handle/<slug>`
 * and `/@handle/collections/<slug>` share a namespace with each other, and the
 * URL shape has to stay legible enough that a person can tell a profile from a
 * page about profiles.
 *
 * The other half is squatting. `fanwise`, `support`, `help`, `security` and
 * `admin` are names a visitor would read as the company speaking. They are not
 * unreachable, they are misleading, which is worse: the page works perfectly
 * and says something Fanwise did not say.
 *
 * Kept in step with `public_profiles_handle_not_reserved` in migration
 * 20260912010000. A unit test asserts the two lists are identical and that the
 * routing half still covers the route tree.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  // `/<workspace>/channels`. Added in 20260912220000 so the list covers every
  // workspace sub-route as well as every top-level one; a unit test holds that.
  "channels",
  "collections",
  "contact",
  "creator",
  "creators",
  "dashboard",
  "discover",
  "docs",
  "fanwise",
  "favicon",
  "forgot-password",
  "help",
  "how-it-works",
  "legal",
  "login",
  "logout",
  "marketplaces",
  "new",
  "onboarding",
  "pricing",
  "privacy",
  "products",
  "profile",
  "public",
  "reset-password",
  "robots",
  "root",
  "search",
  "security",
  "settings",
  "sign-in",
  "sign-up",
  "sitemap",
  "start",
  "static",
  "status",
  "support",
  "terms",
  "www",
])

/**
 * Slugs a segment beneath a profile would shadow.
 *
 * One entry, and it is a promise rather than a route: `/@handle/collections/x`
 * is the reserved shape for a collection page. Reserving the word now costs
 * nothing; discovering later that four creators own a product called
 * "Collections" costs them their URLs.
 */
export const RESERVED_PUBLIC_PRODUCT_SLUGS: ReadonlySet<string> = new Set(["collections"])

export const HANDLE_LIMITS = { min: 3, max: 32 } as const
export const PUBLIC_SLUG_LIMITS = { min: 3, max: 64 } as const

/**
 * The only shape either identifier may take: lowercase ASCII letters and
 * digits, joined by single hyphens, starting and ending with one of the two.
 *
 * This is narrow on purpose and the reason is not tidiness. A handle is an
 * identity claim rendered in somebody else's typeface. Admit Unicode and you
 * admit Cyrillic `а`, Greek `ο`, Latin `ı`, a zero-width joiner sitting
 * invisibly between two letters — each of which produces a handle that a reader
 * cannot distinguish from an existing one and a database treats as new. There
 * is no normalisation that closes that off completely; a character set that
 * cannot express it does.
 */
const SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Unicode that is not simply "not allowed" but actively deceptive. */
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤﻿]/

export type IdentifierCheck = { ok: true; value: string } | { ok: false; message: string }

/**
 * The canonical form of what someone typed.
 *
 * Lowercasing here rather than refusing it is deliberate: a creator typing
 * "Northline" into a handle field has made no mistake worth a red message, and
 * `/@Northline` redirects to `/@northline` anyway. Everything else is reported
 * rather than silently repaired, because a handle that quietly becomes
 * something else is a handle the creator did not choose.
 */
export function canonicalHandle(input: string): string {
  // NFKC before lowercasing, not after: casing is defined per-character and
  // the compatibility fold can change which character it is applied to.
  return input.normalize("NFKC").toLowerCase().trim()
}

function checkIdentifier(
  raw: string,
  {
    noun,
    limits,
    reserved,
    reservedMessage,
  }: {
    noun: string
    limits: { min: number; max: number }
    reserved: ReadonlySet<string>
    reservedMessage: string
  },
): IdentifierCheck {
  const value = canonicalHandle(raw)

  if (value.length === 0) {
    return { ok: false, message: `Choose a ${noun}.` }
  }
  // Checked before the shape test purely so the message names the real
  // problem. SHAPE would refuse all of these anyway — it admits nothing
  // outside ASCII — but "use lowercase letters, numbers and hyphens" is a
  // baffling thing to read about a field that, on screen, appears to contain
  // exactly that. These two tests exist to say what the eye cannot see.
  if (INVISIBLE.test(raw)) {
    return {
      ok: false,
      message: `That ${noun} contains an invisible character. Retype it rather than pasting it.`,
    }
  }
  if (raw.normalize("NFKC") !== raw) {
    return {
      ok: false,
      message: `That ${noun} contains characters that look like plain letters but are not. Retype it using lowercase letters, numbers and hyphens.`,
    }
  }
  if (value.length < limits.min) {
    return { ok: false, message: `A ${noun} is at least ${limits.min} characters.` }
  }
  if (value.length > limits.max) {
    return { ok: false, message: `A ${noun} is at most ${limits.max} characters.` }
  }
  if (!SHAPE.test(value)) {
    // Name the three common shapes rather than the regex.
    if (/[^a-z0-9-]/.test(value)) {
      return {
        ok: false,
        message: `A ${noun} uses lowercase letters, numbers and hyphens only.`,
      }
    }
    return {
      ok: false,
      message: `A ${noun} cannot start or end with a hyphen, or contain two in a row.`,
    }
  }
  if (reserved.has(value)) {
    return { ok: false, message: reservedMessage }
  }

  return { ok: true, value }
}

export function checkHandle(raw: string): IdentifierCheck {
  return checkIdentifier(raw, {
    noun: "handle",
    limits: HANDLE_LIMITS,
    reserved: RESERVED_HANDLES,
    reservedMessage: "That handle is reserved. Choose another.",
  })
}

/**
 * What the builder's address field holds, on its way to being a handle.
 *
 * Deliberately smaller than a slugify. It folds the three things a person
 * typing an address does without meaning anything by them — a capital, a
 * space where a hyphen goes, an `@` because the address is shown with one —
 * and repairs nothing else. Anything the shape still refuses is reported by
 * `checkHandle`, for the reason `canonicalHandle` gives: a handle that quietly
 * became something else is not the one the creator chose.
 *
 * Only a literal space, tab and underscore become hyphens. `\s` would also
 * swallow U+FEFF, and an invisible character must reach `checkHandle` intact
 * so it can be named rather than silently turned into punctuation.
 */
export function normalizeHandleInput(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[ \t_]+/g, "-")
}

/**
 * The handle, classified for the address field.
 *
 * `reserved` is its own outcome rather than one more message, because the
 * builder shows it as its own state: "taken by somebody" and "kept by Fanwise"
 * are different things to be told, and neither needs a round trip to decide.
 */
export type HandleClassification =
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  | { kind: "reserved"; value: string; message: string }
  | { kind: "valid"; value: string }

export function classifyHandle(raw: string): HandleClassification {
  const normalized = normalizeHandleInput(raw)
  if (normalized.length === 0) return { kind: "empty" }
  const checked = checkHandle(normalized)
  if (checked.ok) return { kind: "valid", value: checked.value }
  const value = canonicalHandle(normalized)
  if (RESERVED_HANDLES.has(value)) {
    return { kind: "reserved", value, message: checked.message }
  }
  return { kind: "invalid", message: checked.message }
}

export function checkPublicSlug(raw: string): IdentifierCheck {
  return checkIdentifier(raw, {
    noun: "web address",
    limits: PUBLIC_SLUG_LIMITS,
    reserved: RESERVED_PUBLIC_PRODUCT_SLUGS,
    reservedMessage: "That address is reserved for collections. Choose another.",
  })
}

/**
 * A handle suggestion from a studio name. Deterministic, and only ever a
 * starting point the creator can overwrite: a handle derived from a mutable
 * display name and then left to track it would change a public URL every time
 * somebody fixed a typo in their studio's name.
 */
export function suggestHandle(name: string): string {
  const base = canonicalHandle(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDLE_LIMITS.max)
    .replace(/-+$/g, "")

  if (base.length === 0) return ""
  // A suggestion that cannot be saved is worse than none: pad a short one and
  // move a reserved one, the same way lib/slug.ts does for a workspace.
  const padded =
    base.length < HANDLE_LIMITS.min ? `${base}-studio`.slice(0, HANDLE_LIMITS.max) : base
  return RESERVED_HANDLES.has(padded) ? `${padded}-studio`.slice(0, HANDLE_LIMITS.max) : padded
}
