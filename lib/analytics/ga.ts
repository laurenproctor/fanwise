/**
 * Google Analytics 4, the one analytics destination.
 *
 * Three rules, all enforced here rather than in GA's settings:
 *
 *   - **No query strings leave the browser.** Search words, OAuth codes and
 *     sign-in tokens travel in query strings, so every address sent to GA is
 *     origin plus path. `send_page_view` is off and the page view is sent by
 *     hand with the cleaned address.
 *   - **No identity.** No user ID, email, workspace or handle is ever set.
 *     Directory events carry the section and never a query, handle or product
 *     (docs/security.md).
 *   - **No advertising.** Ad storage, ad user data, ad personalization and
 *     Google Signals are off.
 *
 * Without NEXT_PUBLIC_GA_MEASUREMENT_ID nothing loads and nothing is sent.
 */

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/

/** The measurement ID if it is a well-formed GA4 ID, else null. */
export function gaMeasurementId(raw: string | undefined | null): string | null {
  const value = raw?.trim() ?? ""
  return MEASUREMENT_ID.test(value) ? value : null
}

/** Origin plus path. Never the query string or the fragment. */
export function cleanAddress(url: string | undefined | null): string {
  if (!url) return ""
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return ""
    return parsed.origin + parsed.pathname
  } catch {
    return ""
  }
}

/**
 * GA4 event names are letters, digits and underscores, start with a letter and
 * stop at 40 characters. "Creator marketplace viewed" becomes
 * `creator_marketplace_viewed`.
 */
export function eventName(label: string): string {
  const name = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "")
  return /^[a-z]/.test(name) ? name : `event_${name}`.slice(0, 40)
}

let configured = false

/**
 * Defines `gtag` and queues the consent defaults and the configuration, once.
 * Safe to call before gtag.js has loaded: the calls wait in `dataLayer`.
 * Returns false when there is no measurement ID or no browser.
 */
export function ensureGtag(): boolean {
  if (typeof window === "undefined") return false
  const id = gaMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)
  if (!id) return false
  if (configured) return true
  configured = true

  window.dataLayer = window.dataLayer ?? []
  // gtag.js reads the `arguments` object itself off the queue. A rest
  // parameter would push an array, which it ignores.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments)
  }
  window.gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  })
  window.gtag("js", new Date())
  window.gtag("config", id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_referrer: cleanAddress(document.referrer),
  })
  return true
}

/** One page view for the address now showing, without its query string. */
export function trackPageView(): void {
  if (!ensureGtag()) return
  const address = cleanAddress(window.location.href)
  window.gtag?.("set", { page_location: address })
  window.gtag?.("event", "page_view", { page_location: address })
}

/** A named event. Parameters are short labels, never anything a person typed. */
export function track(label: string, params: Record<string, string> = {}): void {
  if (!ensureGtag()) return
  window.gtag?.("event", eventName(label), params)
}
