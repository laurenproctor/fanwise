import { safeExternalUrl } from "./urls"

/**
 * The three profile links, from what a creator types to what a page renders.
 *
 * The builder's fields accept the forms people actually write: `studio.com`
 * rather than `https://studio.com`, `@studio` rather than an Instagram URL,
 * `behance.net/studio` rather than the full address. Each parser turns one of
 * those into a single canonical https URL, or says plainly why it cannot.
 *
 * One function per link and all of them pure, because the same answer is
 * needed in three places that must not disagree: the live preview deciding
 * whether to draw an icon, the Continue action deciding whether the step is
 * complete, and publication deciding what reaches `public_profiles`. Every URL
 * produced here is passed through `safeExternalUrl` as its last step, so a
 * parser bug can lose a link but cannot emit an unsafe one.
 *
 * There is deliberately no email link here. A public profile carries no email
 * address and no mailto control; that is a product decision, and the absence
 * is tested rather than merely unimplemented.
 */

export type ProfileLinkKind = "website" | "instagram" | "behance"

export type LinkParse =
  | { kind: "empty" }
  | { kind: "valid"; url: string; label: string }
  | { kind: "invalid"; message: string }

const MAX_INPUT = 2048

function blank(raw: string): boolean {
  return raw.trim().length === 0
}

/** A hostname that could plausibly be a public site: dotted, no spaces, no port games. */
function plausibleHost(hostname: string): boolean {
  if (hostname.length > 253 || !hostname.includes(".")) return false
  if (/^[\d.]+$/.test(hostname)) return false // a bare IPv4 address is not a studio website
  return hostname.split(".").every((part) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(part))
}

export function parseWebsite(raw: string): LinkParse {
  if (blank(raw)) return { kind: "empty" }
  const input = raw.trim()
  if (input.length > MAX_INPUT) return { kind: "invalid", message: "That address is too long." }

  if (/^http:\/\//i.test(input)) {
    return { kind: "invalid", message: "Use an https:// address." }
  }
  // A scheme that is not https at all — javascript:, data:, ftp: — is refused
  // outright rather than having https:// glued in front of it.
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https:\/\//i.test(input)) {
    return { kind: "invalid", message: "Use a website address, like studio.com." }
  }

  const candidate = /^https:\/\//i.test(input) ? input : `https://${input}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { kind: "invalid", message: "Use a website address, like studio.com." }
  }
  if (!plausibleHost(url.hostname) || url.port !== "") {
    return { kind: "invalid", message: "Use a website address, like studio.com." }
  }

  const safe = safeExternalUrl(url.toString())
  if (!safe) return { kind: "invalid", message: "Use a website address, like studio.com." }
  return { kind: "valid", url: safe, label: url.hostname.replace(/^www\./, "") }
}

/**
 * Instagram usernames are 1–30 letters, digits, periods and underscores. The
 * field takes `@name`, `name`, or any instagram.com URL for it.
 */
const INSTAGRAM_USERNAME = /^[A-Za-z0-9._]{1,30}$/

export function parseInstagram(raw: string): LinkParse {
  if (blank(raw)) return { kind: "empty" }
  const input = raw.trim()
  const username = usernameFrom(input, /^(?:https:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)\/?$/i)

  if (username === null || !INSTAGRAM_USERNAME.test(username)) {
    return { kind: "invalid", message: "Use your Instagram username, like @studio." }
  }
  const safe = safeExternalUrl(`https://www.instagram.com/${username}/`)
  if (!safe) return { kind: "invalid", message: "Use your Instagram username, like @studio." }
  return { kind: "valid", url: safe, label: `@${username}` }
}

/** Behance usernames: letters, digits, underscores and hyphens. */
const BEHANCE_USERNAME = /^[A-Za-z0-9_-]{1,64}$/

export function parseBehance(raw: string): LinkParse {
  if (blank(raw)) return { kind: "empty" }
  const input = raw.trim()
  const username = usernameFrom(input, /^(?:https:\/\/)?(?:www\.)?behance\.net\/([^/?#]+)\/?$/i)

  if (username === null || !BEHANCE_USERNAME.test(username)) {
    return { kind: "invalid", message: "Use your Behance username or behance.net address." }
  }
  const safe = safeExternalUrl(`https://www.behance.net/${username}`)
  if (!safe)
    return { kind: "invalid", message: "Use your Behance username or behance.net address." }
  return { kind: "valid", url: safe, label: `behance.net/${username}` }
}

/**
 * The username out of either a bare handle or a URL on the named site.
 *
 * Anything that looks like a URL but is not on that site returns null, so
 * `twitter.com/studio` typed into the Instagram field is refused rather than
 * read as the username `twitter.com`. `http://` is refused along with it.
 */
function usernameFrom(input: string, urlShape: RegExp): string | null {
  if (/^http:\/\//i.test(input)) return null
  const fromUrl = urlShape.exec(input)
  if (fromUrl) return fromUrl[1] ?? null
  if (input.includes("/") || input.includes(":")) return null
  return input.replace(/^@/, "")
}

export const LINK_PARSERS: Record<ProfileLinkKind, (raw: string) => LinkParse> = {
  website: parseWebsite,
  instagram: parseInstagram,
  behance: parseBehance,
}

export interface ResolvedLink {
  kind: ProfileLinkKind
  url: string
  label: string
}

/** The links that would render, in a fixed order. Invalid and empty are both absent. */
export function resolvedLinks(values: Record<ProfileLinkKind, string>): ResolvedLink[] {
  const order: ProfileLinkKind[] = ["website", "instagram", "behance"]
  return order.flatMap((kind) => {
    const parsed = LINK_PARSERS[kind](values[kind])
    return parsed.kind === "valid" ? [{ kind, url: parsed.url, label: parsed.label }] : []
  })
}
