import {
  OutboundError,
  outboundRequest,
  type OutboundOptions,
  type OutboundRefusal,
} from "@/lib/net/outbound"
import { ImportError } from "../errors"
import { HTML_LIMITS } from "./html"

/**
 * Reading one public page, from Fanwise's own servers, signed out.
 *
 * Everything about *where* a request may go is `lib/net/outbound.ts`: https
 * only, port 443 only, a public DNS name, every resolved address checked, the
 * address pinned before the socket opens, each redirect re-validated from
 * scratch, a deadline for the whole chain and a cap on the body. None of that
 * is repeated here and none of it may be bypassed from here.
 *
 * What this file adds is the part specific to reading a stranger's page:
 *
 *   - **No identity travels with the request.** Two headers go out, an honest
 *     user agent and an `Accept`. No cookie, no authorization, no referer, no
 *     session, nothing derived from the creator's browser. A test asserts the
 *     header set exactly, because the day somebody adds "just the referer" is
 *     the day a signed URL leaks into a stranger's access log.
 *   - **Nothing is bypassed.** The user agent says what this is and links to a
 *     page explaining it. There is no attempt to look like a browser, no cookie
 *     jar, no header spoofing, no retry against a challenge. A site that does
 *     not want to be read says so and is believed — that answer becomes
 *     `login_required`, and the creator is offered a different door.
 *   - **A status is a meaning, not a number.** Every outcome leaves here as an
 *     `ImportErrorCode`, so nothing downstream branches on 403 and nothing on a
 *     screen ever shows one.
 */

export const FETCH_LIMITS = {
  connectTimeoutMs: 8_000,
  /** The whole exchange, redirects included. */
  responseTimeoutMs: 15_000,
  maxBodyBytes: HTML_LIMITS.maxBytes,
  /** Enough for a shortener, a canonical host and a trailing slash. */
  maxRedirects: 5,
} as const

/**
 * What Fanwise calls itself when it reads a page.
 *
 * Honest on purpose. It is not a browser string, it does not pretend to be
 * one, and it carries a URL a site owner can look up to decide whether to allow
 * it. Disguising this would be the first step of bypassing bot protection, and
 * it is the step that makes every later one look reasonable.
 */
export const IMPORT_USER_AGENT = "FanwiseImporter/1.0 (+https://fanwise.app/bot)"

const REQUEST_HEADERS: Readonly<Record<string, string>> = {
  "user-agent": IMPORT_USER_AGENT,
  accept: "text/html,application/xhtml+xml",
}

export interface FetchedPage {
  html: string
  /** Where the body came from, after redirects. Never the pasted URL if it moved. */
  resolvedUrl: string
  redirects: string[]
  status: number
  contentType: string | null
}

/** An outbound refusal, in the import's own vocabulary. */
export function importErrorForRefusal(kind: OutboundRefusal): ImportError["code"] {
  switch (kind) {
    case "address_blocked":
    case "hostname":
    case "scheme":
    case "port":
    case "credentials":
      return "blocked_address"
    case "redirect":
      return "too_many_redirects"
    case "timeout":
      return "timeout"
    case "body_too_large":
      return "too_large"
    case "unresolvable":
      return "unreachable"
    case "invalid_url":
      return "unsupported_source"
    case "network":
      return "unreachable"
  }
}

/**
 * What a status code means for an import.
 *
 * 401 and 403 both become `login_required` rather than anything sterner: from
 * outside, "you are not signed in" and "you are signed in as the wrong person"
 * are the same fact, and the recovery — publish a public link — is the same.
 * The organization case is a body-level signal and belongs to the adapter, not
 * here; this only knows what the wire said.
 */
export function importErrorForStatus(status: number): ImportError["code"] | null {
  if (status >= 200 && status < 300) return null
  if (status === 401 || status === 403) return "login_required"
  if (status === 404 || status === 410) return "not_found"
  if (status === 429) return "provider_error"
  if (status >= 500) return "provider_error"
  return "provider_error"
}

/** True when a content type is a page rather than a file. */
export function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? ""
  return type === "text/html" || type === "application/xhtml+xml"
}

export interface FetchPageOptions {
  /** Test seam. Production passes nothing and gets the real boundary. */
  outbound?: Pick<OutboundOptions, "resolve" | "transport">
}

export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
  let result: Awaited<ReturnType<typeof outboundRequest>>

  try {
    result = await outboundRequest(
      url,
      { method: "GET", headers: { ...REQUEST_HEADERS } },
      {
        ...options.outbound,
        connectTimeoutMs: FETCH_LIMITS.connectTimeoutMs,
        responseTimeoutMs: FETCH_LIMITS.responseTimeoutMs,
        maxBodyBytes: FETCH_LIMITS.maxBodyBytes,
        maxRedirects: FETCH_LIMITS.maxRedirects,
      },
    )
  } catch (error) {
    if (error instanceof OutboundError)
      throw new ImportError(importErrorForRefusal(error.kind), error)
    throw error
  }

  const { response, resolvedUrl, redirects } = result
  const contentType = response.headers.get("content-type")

  const statusError = importErrorForStatus(response.status)
  if (statusError) {
    // The body of a refusal is read anyway: an artifact host answers 200 to a
    // sign-in wall as often as it answers 401, and the adapter needs both.
    throw new ImportError(statusError, { status: response.status })
  }

  if (!isHtmlContentType(contentType)) {
    throw new ImportError("not_html", { contentType })
  }

  const html = await response.text()
  if (html.length > HTML_LIMITS.maxBytes) throw new ImportError("too_large")

  return { html, resolvedUrl, redirects, status: response.status, contentType }
}
