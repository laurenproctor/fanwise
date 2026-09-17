import type { AccountHintSpec, SubmissionSpec } from "@/lib/channels/types"

/**
 * The two addresses Fanwise parses for this channel: the shop a creator
 * connects, and the product they report listed. Parsed here and nowhere
 * else, because a hostname pattern in a shared util is a provider name
 * outside the adapter layer.
 */

const HOSTS = ["creativemarket.com", "www.creativemarket.com"]
const USERNAME = /^[A-Za-z0-9_-]{1,64}$/
/** A product path: /{shop}/{id}-{slug} or /{shop}/{id}. */
const PRODUCT = /^(\d{1,20})(?:-([A-Za-z0-9_-]{1,200}))?$/

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    return HOSTS.includes(url.hostname.toLowerCase()) ? url : null
  } catch {
    return null
  }
}

/** A shop username or its address. What is stored is the username. */
export const creativeMarketAccountHint: AccountHintSpec = {
  label: "Creative Market shop",
  placeholder: "creativemarket.com/yourshop",
  parse(raw) {
    const trimmed = raw.trim().replace(/^@/, "")
    let username = trimmed
    if (/[./]/.test(trimmed)) {
      const url = parseUrl(trimmed)
      const parts = url?.pathname.split("/").filter(Boolean) ?? []
      const first = parts[0]
      if (!url || !first || (parts[1] && PRODUCT.test(parts[1]))) {
        return { ok: false, message: "Enter your shop's name or its address on Creative Market." }
      }
      username = first
    }
    if (!USERNAME.test(username)) {
      return { ok: false, message: "Enter your shop's name or its address on Creative Market." }
    }
    return { ok: true, value: username, name: `creativemarket.com/${username}` }
  },
}

/**
 * A product URL: creativemarket.com/{shop}/{id}-{slug}. The numeric id is the
 * external listing id. The stored URL is canonical, so the same product
 * pasted two ways is one row.
 */
export const creativeMarketSubmission: SubmissionSpec = {
  urlLabel: "Listing URL",
  urlPlaceholder: "https://creativemarket.com/yourshop/1234567-your-product",
  parseUrl(raw) {
    const url = parseUrl(raw)
    const parts = url?.pathname.split("/").filter(Boolean) ?? []
    const shop = parts[0]
    const product = parts[1] ? PRODUCT.exec(parts[1]) : null
    if (!url || !shop || !USERNAME.test(shop) || !product) {
      return {
        ok: false,
        message:
          "Paste the product's address on Creative Market. It looks like creativemarket.com/yourshop/1234567-your-product",
      }
    }
    const id = product[1]!
    const slug = product[2] ? `-${product[2]}` : ""
    return {
      ok: true,
      externalListingId: id,
      externalUrl: `https://creativemarket.com/${shop}/${id}${slug}`,
    }
  },
}
