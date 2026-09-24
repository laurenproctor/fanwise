import { CURRENCIES, LIMITS } from "./config"

/**
 * Canonical values into the shapes Polar's fields expect. Pure and total.
 */

/** The currency as Polar spells it, or null for one it does not price in. */
export function toCurrency(currency: string): string | null {
  const code = currency.trim().toLowerCase()
  return code in CURRENCIES ? code : null
}

/**
 * Polar takes the price as an integer in the currency's smallest unit:
 * cents for most, the unit itself for yen and won.
 */
export function toPrice(price: number | null, currency: string): number | null {
  if (price === null || !Number.isFinite(price)) return null
  const code = toCurrency(currency)
  const minorUnits = code ? CURRENCIES[code]!.minorUnits : 100
  return Math.round(price * minorUnits)
}

/** The minimum price Polar accepts in a currency, in its own units. Zero is always free. */
export function minimumPrice(currency: string): number | null {
  const code = toCurrency(currency)
  return code ? CURRENCIES[code]!.minimum : null
}

/**
 * Polar's product name is 3 to 64 characters. The requirement blocks a title
 * outside that; this is the last line, so a name the requirement never saw
 * (a product with no listing title) still fits.
 */
export function toName(title: string): string {
  const value = title.trim().slice(0, LIMITS.titleMax).trim()
  return value.length >= LIMITS.titleMin ? value : value.padEnd(LIMITS.titleMin, ".")
}

/**
 * Polar renders the description as Markdown, which is what the canonical
 * description already is, so it goes as written. An empty one goes as null:
 * Polar's field is nullable and an empty string is a description of nothing.
 */
export function toDescription(text: string | null): string | null {
  const value = (text ?? "").trim()
  return value.length > 0 ? value : null
}

/**
 * The benefit's own label, shown on the checkout page under the product:
 * "Aster Grotesk files", within Polar's 42 characters.
 */
export function toBenefitDescription(name: string): string {
  const suffix = " files"
  const room = LIMITS.benefitDescriptionMax - suffix.length
  const stem = name.trim().slice(0, room).trim()
  const value = `${stem}${suffix}`
  return value.length >= LIMITS.benefitDescriptionMin ? value : "Files"
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
}

/**
 * The MIME type Polar's `product_media` service insists on, from the name a
 * rendition was given. A rendition is named for the format it was encoded
 * in, so the extension is the truth here; anything else is refused by the
 * policy before it reaches this.
 */
export function imageMimeType(filename: string): string | null {
  const extension = filename.toLowerCase().split(".").pop() ?? ""
  return MIME_BY_EXTENSION[extension] ?? null
}
