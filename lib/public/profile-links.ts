import { safeExternalUrl } from "./urls"

/**
 * A profile's links, from what a creator types to what a page renders.
 *
 * The profile used to carry exactly three: Website, Instagram and Behance.
 * Since 13 September 2026 it carries whichever links the creator chooses, up
 * to eight, each an address and an optional label, in the creator's order.
 * Nothing here is shaped around a list of networks. Recognising a platform
 * only chooses an icon and a default label; an address this module has never
 * heard of is exactly as valid, and is drawn with a globe.
 *
 * One parser for all of them, pure, because three places must agree: the live
 * preview deciding what to draw, Continue deciding whether the step is done,
 * and publication deciding what reaches `public_profile_links`. Every URL
 * produced is passed through `safeExternalUrl` as its last step, so a parser
 * bug can lose a link but cannot emit an unsafe one.
 *
 * Favicons are deliberately not fetched. Loading a destination's favicon on a
 * public page would hand every visitor's address to every site a creator links
 * to, before the visitor chose to go there; and proxying it would make Fanwise
 * a fetcher of arbitrary URLs. A platform glyph or a globe says enough.
 *
 * Email is not a link here. It belongs to the optional Contact button, parsed
 * by `parseContact` below.
 */

export const MAX_PROFILE_LINKS = 8
export const LINK_LABEL_MAX = 40
const MAX_INPUT = 2048

/** A link as the builder stores it: what was typed, not what was validated. */
export interface DraftLink {
  url: string
  label: string
}

export type LinkParse =
  | { kind: "empty" }
  | { kind: "valid"; url: string; label: string }
  | { kind: "invalid"; message: string }

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

/**
 * Sites with a glyph of their own. Marketplaces Fanwise publishes to are not
 * here: a channel's mark belongs to components/channels, and a link to a shop
 * on one is drawn with the globe like any other site.
 */
export const LINK_PLATFORMS = {
  instagram: { name: "Instagram", hosts: ["instagram.com"] },
  behance: { name: "Behance", hosts: ["behance.net"] },
  dribbble: { name: "Dribbble", hosts: ["dribbble.com"] },
  linkedin: { name: "LinkedIn", hosts: ["linkedin.com"] },
  x: { name: "X", hosts: ["x.com", "twitter.com"] },
  youtube: { name: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  tiktok: { name: "TikTok", hosts: ["tiktok.com"] },
  pinterest: { name: "Pinterest", hosts: ["pinterest.com"] },
  vimeo: { name: "Vimeo", hosts: ["vimeo.com"] },
  threads: { name: "Threads", hosts: ["threads.net", "threads.com"] },
  bluesky: { name: "Bluesky", hosts: ["bsky.app"] },
  github: { name: "GitHub", hosts: ["github.com"] },
} as const satisfies Record<string, { name: string; hosts: readonly string[] }>

export type LinkPlatform = keyof typeof LINK_PLATFORMS
/** "website" is every address that is not a recognised platform, a creator's own site included. */
export type LinkKind = LinkPlatform | "website"

export function platformOf(url: string): LinkKind {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return "website"
  }
  for (const [key, platform] of Object.entries(LINK_PLATFORMS)) {
    // The host itself or a subdomain of it, never a lookalike: "notinstagram.com"
    // does not end in ".instagram.com".
    if (platform.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return key as LinkPlatform
    }
  }
  return "website"
}

export function kindName(kind: LinkKind): string {
  return kind === "website" ? "Website" : LINK_PLATFORMS[kind].name
}

/** The label a link gets when the creator gave none: the platform, or the site's own host. */
export function derivedLabel(url: string): string {
  const kind = platformOf(url)
  if (kind !== "website") return LINK_PLATFORMS[kind].name
  return hostOf(url) ?? url
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "")
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function blank(raw: string): boolean {
  return raw.trim().length === 0
}

/** A hostname that could plausibly be a public site: dotted, no spaces, no bare IP. */
function plausibleHost(hostname: string): boolean {
  if (hostname.length > 253 || !hostname.includes(".")) return false
  if (/^[\d.]+$/.test(hostname)) return false
  return hostname.split(".").every((part) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(part))
}

const WEB_ADDRESS = "Use a web address, like studio.com."

/**
 * Any https address, typed the way people type them: `studio.com` gains its
 * `https://`. Refused, each with a message saying what to do instead:
 *
 *   - `http://`, because a public page does not send visitors over plain http;
 *   - any other scheme at all (`javascript:`, `data:`, `mailto:`, `ftp:`),
 *     refused outright rather than having `https://` glued in front of it;
 *   - an `@username`, which is not an address;
 *   - a host that is not a plausible public site, a port, or credentials.
 */
export function parseLinkUrl(raw: string): LinkParse {
  if (blank(raw)) return { kind: "empty" }
  const input = raw.trim()
  if (input.length > MAX_INPUT) return { kind: "invalid", message: "That address is too long." }

  if (/^http:\/\//i.test(input)) return { kind: "invalid", message: "Use an https:// address." }
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https:\/\//i.test(input)) {
    return { kind: "invalid", message: WEB_ADDRESS }
  }
  if (input.startsWith("@")) {
    return { kind: "invalid", message: "Use the full address, like instagram.com/yourstudio." }
  }

  const candidate = /^https:\/\//i.test(input) ? input : `https://${input}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { kind: "invalid", message: WEB_ADDRESS }
  }
  if (!plausibleHost(url.hostname) || url.port !== "" || url.username || url.password) {
    return { kind: "invalid", message: WEB_ADDRESS }
  }

  const safe = safeExternalUrl(url.toString())
  if (!safe) return { kind: "invalid", message: WEB_ADDRESS }
  return { kind: "valid", url: safe, label: derivedLabel(safe) }
}

/** A label as it will be shown: trimmed, with no control characters. Empty means derived. */
export function cleanLabel(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim()
}

export interface LinkIssue {
  index: number
  field: "url" | "label"
  message: string
}

/**
 * Every problem with a list of links, by row. A row with nothing in it is not
 * a problem (it is simply not a link) unless it has a label and no address.
 */
export function checkLinks(links: readonly DraftLink[]): LinkIssue[] {
  const issues: LinkIssue[] = []
  const seen = new Set<string>()

  links.forEach((link, index) => {
    const parsed = parseLinkUrl(link.url)
    if (index >= MAX_PROFILE_LINKS && (parsed.kind !== "empty" || !blank(link.label))) {
      issues.push({
        index,
        field: "url",
        message: `A profile shows up to ${MAX_PROFILE_LINKS} links. Remove this one or another.`,
      })
      return
    }
    if (parsed.kind === "invalid") {
      issues.push({ index, field: "url", message: parsed.message })
    } else if (parsed.kind === "empty" && !blank(link.label)) {
      issues.push({ index, field: "url", message: "Add the address for this link, or remove it." })
    } else if (parsed.kind === "valid") {
      if (seen.has(parsed.url)) {
        issues.push({ index, field: "url", message: "This link is already on your profile." })
      }
      seen.add(parsed.url)
    }
    if (cleanLabel(link.label).length > LINK_LABEL_MAX) {
      issues.push({
        index,
        field: "label",
        message: `Keep the label under ${LINK_LABEL_MAX} characters.`,
      })
    }
  })
  return issues
}

export interface ResolvedLink {
  kind: LinkKind
  url: string
  label: string
}

/**
 * The values publication writes, in order: the canonical URL, and the label
 * only when the creator gave one, so a derived label keeps following its
 * address. Empty, invalid and repeated rows are left out.
 */
export function publishableLinks(links: readonly DraftLink[]): DraftLink[] {
  const seen = new Set<string>()
  return links.slice(0, MAX_PROFILE_LINKS).flatMap((link) => {
    const parsed = parseLinkUrl(link.url)
    if (parsed.kind !== "valid" || seen.has(parsed.url)) return []
    seen.add(parsed.url)
    return [{ url: parsed.url, label: cleanLabel(link.label).slice(0, LINK_LABEL_MAX) }]
  })
}

/** The links a page draws, in order: an icon kind, a safe URL and a label to show. */
export function resolveLinks(links: readonly DraftLink[]): ResolvedLink[] {
  return publishableLinks(links).map(({ url, label }) => ({
    kind: platformOf(url),
    url,
    label: label || derivedLabel(url),
  }))
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/**
 * The Contact button: an email address or a web page, whichever a creator
 * would rather be reached through.
 *
 * An address becomes `mailto:<address>`, typed with or without the scheme,
 * and nothing may follow it: headers after a `?` can pre-fill a subject and a
 * body, which is a message a visitor did not write being sent over their name.
 * Anything else goes through `parseLinkUrl`, so a contact page obeys the same
 * https-only, plausible-host rules as every link. Both outputs match
 * `public_profiles_contact_url_scheme`, the constraint the live row enforces.
 *
 * Empty is a valid answer, and the way a creator removes the button.
 */
const CONTACT_MESSAGE = "Use an email address, like hello@yourstudio.com, or a website address."
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/

export function parseContact(raw: string): LinkParse {
  if (blank(raw)) return { kind: "empty" }
  const input = raw.trim()
  if (input.length > MAX_INPUT) return { kind: "invalid", message: "That address is too long." }

  const address = input.replace(/^mailto:/i, "")
  if (address.includes("@") && !address.includes("/")) {
    if (!EMAIL.test(address)) return { kind: "invalid", message: CONTACT_MESSAGE }
    const safe = safeExternalUrl(`mailto:${address}`, { allowMailto: true })
    if (!safe) return { kind: "invalid", message: CONTACT_MESSAGE }
    return { kind: "valid", url: safe, label: address }
  }
  if (/^mailto:/i.test(input)) return { kind: "invalid", message: CONTACT_MESSAGE }

  const page = parseLinkUrl(input)
  if (page.kind === "invalid") {
    // "Use an https:// address." is the one link message that still helps
    // here; the others talk about a link when this field also takes email.
    return page.message.includes("https") ? page : { kind: "invalid", message: CONTACT_MESSAGE }
  }
  // A contact page is labelled by its own host, never by a platform name.
  return page.kind === "valid" ? { ...page, label: hostOf(page.url) ?? page.url } : page
}
