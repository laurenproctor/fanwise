/**
 * The shape check a pasted link gets before anything is fetched.
 *
 * **This is a courtesy, not a security boundary, and the distinction matters
 * enough to state at the top of the file.** The boundary is
 * `lib/net/outbound.ts`: HTTPS only, no credentials in the URL, port 443 only,
 * a public DNS name, every resolved address checked, the address pinned before
 * the connection, no redirect followed, deadlines, and a body cap. All of that
 * is server-side and resolves DNS, and none of it can run in a browser.
 *
 * What this does is tell a creator they typed something wrong before a round
 * trip, using the subset of those rules that needs no network. It duplicates
 * the shape rules on purpose and must never be relaxed below them; when
 * ingestion is wired, the server runs the real check again and its answer wins.
 */

export type UrlRefusal = "empty" | "unparseable" | "scheme" | "credentials" | "port" | "hostname"

export interface UrlAccepted {
  readonly ok: true
  /** Normalized: lower-cased host, no trailing dot, no fragment. */
  readonly url: string
}

export interface UrlRefused {
  readonly ok: false
  readonly refusal: UrlRefusal
  readonly message: string
}

export type UrlCheck = UrlAccepted | UrlRefused

/** Names that mean this machine or this network. Refused the way the server refuses them. */
const LOCAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".in-addr.arpa",
  ".ip6.arpa",
]

/** A public DNS name: labels, at least one dot, an alphabetic top-level label. */
const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/

function refuse(refusal: UrlRefusal, message: string): UrlRefused {
  return { ok: false, refusal, message }
}

/**
 * A pasted string, checked and normalized.
 *
 * A bare `example.com/thing` is given an `https://` prefix before parsing,
 * because that is what a creator means by it and refusing it teaches them
 * nothing. A pasted `http://` is refused rather than upgraded: silently
 * changing which origin is read is the kind of helpfulness that ends up
 * fetching something the creator did not name.
 */
export function validateSourceUrl(raw: string): UrlCheck {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return refuse("empty", "Paste a link to the product you want to import.")
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return refuse("unparseable", "That does not look like a link. Check it and paste it again.")
  }

  if (url.protocol !== "https:") {
    return refuse("scheme", "Fanwise reads https links only. Paste the secure version of it.")
  }
  if (url.username !== "" || url.password !== "") {
    return refuse("credentials", "Remove the username and password from the link.")
  }
  // The URL parser drops an explicit :443; anything left is another port.
  if (url.port !== "") {
    return refuse("port", "Fanwise reads links on the standard https port only.")
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "")
  if (
    hostname.length === 0 ||
    hostname === "localhost" ||
    LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    !DNS_NAME.test(hostname)
  ) {
    return refuse("hostname", "That link points somewhere Fanwise cannot reach from the internet.")
  }

  url.hash = ""
  url.hostname = hostname
  return { ok: true, url: url.toString() }
}

/**
 * Query parameters that describe how somebody arrived, not what they arrived at.
 *
 * Stripped before a URL becomes a dedupe key, so the same page pasted from a
 * newsletter and from a browser bar is one import rather than two products.
 * Prefix matches cover the `utm_*` family without listing it.
 */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "referrer",
  "source",
  "s_kwcid",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "yclid",
])

const TRACKING_PREFIXES = ["utm_", "pk_", "piwik_", "matomo_", "ga_"]

function isTracking(name: string): boolean {
  const key = name.toLowerCase()
  return TRACKING_PARAMS.has(key) || TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * The form of a URL that answers "is this the same page as that one".
 *
 * This is a dedupe key and nothing else. It is never fetched — the URL that
 * gets fetched is the validated one, exactly as the creator gave it — and it
 * is never shown. Two rules follow from that and are worth stating because
 * both are easy to get backwards later:
 *
 *   - **The path keeps its case.** A host is case-insensitive and a path is
 *     not: `/Aster` and `/aster` are two pages on most servers, and folding
 *     them together would merge two products a creator sells separately.
 *   - **Query order does not matter, and query presence does.** The remaining
 *     parameters are sorted so that `?a=1&b=2` and `?b=2&a=1` agree, and none
 *     are dropped beyond the tracking list above: `?id=7` is which product.
 *
 * Takes the already-validated URL string, so this cannot be the thing that
 * decides whether an address is safe to open.
 */
export function normalizeSourceUrl(validated: string): string {
  const url = new URL(validated)

  url.hash = ""
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "")
  url.username = ""
  url.password = ""

  const kept = [...url.searchParams.entries()]
    .filter(([name]) => !isTracking(name))
    .sort(([a, aValue], [b, bValue]) => a.localeCompare(b) || aValue.localeCompare(bValue))

  url.search = ""
  for (const [name, value] of kept) url.searchParams.append(name, value)

  // A trailing slash on a directory-shaped path is the same page as without
  // one, except at the root, where removing it produces a URL with no path.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "")
  }

  return url.toString()
}
