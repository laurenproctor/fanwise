import { referrerHost } from "./urls"

/**
 * The rules for what counts as a view of a public page. Pure, so the route and
 * the tests read the same ones.
 */

/**
 * Crawlers, link unfurlers and headless browsers, recognised by the user agent
 * they announce. The user agent is read to make this decision and never
 * stored. Most crawlers never run the beacon at all, since it needs
 * JavaScript; this catches the ones that do, and the unfurlers that fetch a
 * page the moment a link is pasted into a chat.
 */
const BOT_PATTERN =
  /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|phantomjs|puppeteer|playwright|selenium|curl|wget|python-requests|httpclient/i

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length === 0) return true
  return BOT_PATTERN.test(userAgent)
}

/**
 * Where a visitor came from, as a bare host, or null for direct, unknown or
 * one Fanwise page to another. A move from the profile to one of its products
 * is not a source of traffic, it is the same visit, and listing Fanwise itself
 * as a top referrer would push the real ones down the list.
 */
export function viewReferrerHost(
  referrer: string | null | undefined,
  ownHost: string | null,
): string | null {
  const host = referrerHost(referrer)
  if (!host) return null
  const bare = (value: string) =>
    value
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/:\d+$/, "")
  if (ownHost && bare(host) === bare(ownHost)) return null
  return bare(host)
}

/**
 * The key the visitor's own browser uses to count a page once per tab. Stored
 * in sessionStorage, which is never sent anywhere: the dedupe happens in the
 * browser so the server needs no visitor identity to do it.
 */
export function viewedKey(profileId: string, pageId: string | null): string {
  return `fanwise:viewed:${profileId}:${pageId ?? "profile"}`
}
