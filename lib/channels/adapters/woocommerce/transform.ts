import { plainTextToHtml } from "@/lib/channels/html"

/**
 * Canonical values into the shapes WooCommerce's fields expect.
 *
 * Everything here is pure and total: no provider call, no clock, no throw.
 */

export const toDescriptionHtml = plainTextToHtml

/**
 * Money, as WooCommerce wants it: a decimal string. The store formats it in
 * its own currency and there is no per-product override, which is what the
 * currency requirement warns about.
 */
export function toMoney(price: number | null): string | null {
  if (price === null || !Number.isFinite(price)) return null
  return price.toFixed(2)
}

/** The admin edit URL for a product, which works before and after it is live. */
export function adminProductUrl(storeUrl: string, productId: number): string {
  return `${storeUrl}/wp-admin/post.php?post=${productId}&action=edit`
}

/**
 * A store address the creator typed, into the base Fanwise will call.
 *
 * The value becomes a hostname Fanwise redirects a person to and then sends
 * requests to with their store's keys, so it is checked rather than trusted.
 * A creator will paste the shop's home page, an admin URL, or a bare domain;
 * all three normalize to `host` or `host/path`, lowercase host, no scheme, no
 * trailing slash. HTTPS is not optional: the authorization flow requires it
 * and the keys travel in every request.
 */
const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function parseStoreUrl(
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return refuse()
  if (/^http:\/\//i.test(trimmed)) {
    return {
      ok: false,
      message:
        "Your store has to be on https. WooCommerce only issues API keys over a secure address.",
    }
  }

  let url: URL
  try {
    url = new URL(/^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return refuse()
  }

  const host = url.hostname.toLowerCase()
  if (!HOST.test(host) || url.port !== "" || url.username || url.password) return refuse()

  // A pasted admin or product URL carries the WordPress path; only what comes
  // before it identifies the store.
  const path = url.pathname
    .replace(/\/(wp-admin|wp-json|wc-auth|product|shop|cart|checkout|my-account)(\/.*)?$/i, "")
    .replace(/\/+$/, "")
  const value = `${host}${path}`
  return { ok: true, value }
}

function refuse(): { ok: false; message: string } {
  return {
    ok: false,
    message:
      "Enter your store's address, for example shop.example.com. " +
      "You can paste the shop's home page and Fanwise will use the domain.",
  }
}

/** The base URL from a stored account id. */
export function storeBase(externalAccountId: string): string {
  return `https://${externalAccountId}`
}
