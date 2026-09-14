/**
 * The shape of a durable deliverable address, and nothing that mints one.
 *
 * Split from lib/publishing/deliverable-links.ts, which holds the database and
 * crypto side, because adapters read this and adapters are in the browser
 * graph: the listing editor imports every adapter for its requirements. Pure
 * string work only, so it bundles anywhere.
 *
 * The address is `<origin>/api/public/deliverable/<filename>?token=<token>`,
 * and each part of that is shaped by how a store treats it:
 *
 *   - The **filename** is the last path segment because a store that fetches
 *     the file and passes it on names the buyer's download after the URL's
 *     basename, query string removed. It is cosmetic to Fanwise: the route
 *     ignores it and serves whatever the token names.
 *   - The **token** is in the query string, so every address shares one
 *     parent directory. A store that keeps an allow-list of download
 *     directories then needs one entry for Fanwise, not one per product.
 */

export const DELIVERABLE_LINK_PATH = "/api/public/deliverable/"

/** 32 random bytes, base64url, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}

/**
 * A filename that survives being a URL path segment unchanged.
 *
 * Anything outside a conservative set becomes a hyphen, rather than being
 * percent-encoded, because a store that takes the basename for the buyer's
 * download may or may not decode it, and "Blimpie%20Font.zip" in someone's
 * Downloads folder is a worse result than "Blimpie-Font.zip". The extension is
 * kept, since it is what the buyer's computer opens the file with.
 */
export function urlSafeFilename(filename: string): string {
  const cleaned = filename
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|-+$/g, "")
  return cleaned.slice(0, 120) || "download"
}

/** The same name with no extension, for a store that refuses the extension. */
export function withoutExtension(filename: string): string {
  const dot = filename.lastIndexOf(".")
  return dot > 0 ? filename.slice(0, dot) : filename
}

export function buildDeliverableLinkUrl(origin: string, filename: string, token: string): string {
  const url = new URL(`${DELIVERABLE_LINK_PATH}${urlSafeFilename(filename)}`, origin)
  url.searchParams.set("token", token)
  return url.toString()
}

/**
 * The token a Fanwise deliverable address carries, or null for any other URL.
 *
 * How an adapter recognizes its own downloads among the ones a creator added
 * by hand in the store's admin, so it can keep theirs and replace only its own.
 */
export function deliverableLinkToken(value: string | null | undefined): string | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!url.pathname.startsWith(DELIVERABLE_LINK_PATH)) return null
  const token = url.searchParams.get("token")
  return token && isWellFormedToken(token) ? token : null
}
