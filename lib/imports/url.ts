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
