import { findCity } from "@/lib/location/cities"
import { isCountryCode } from "@/lib/location/countries"
import type { ProfileDraftFields } from "./profile-presentation"

/**
 * Whether a draft's city is a real city in its chosen country. Server only,
 * because the answer needs the city dataset.
 *
 * `known` carries the dataset's own spelling, which is what publication
 * stores, so "sao paulo" typed and chosen becomes "São Paulo" on the page.
 * A city the dataset does not place in that country is `unknown`, and blocks
 * the step: a mismatched pair is never saved to the live profile silently.
 */
export type CityCheck = { kind: "empty" } | { kind: "known"; name: string } | { kind: "unknown" }

export function checkCity(fields: Pick<ProfileDraftFields, "city" | "countryCode">): CityCheck {
  const city = fields.city.trim()
  if (city.length === 0) return { kind: "empty" }
  const country = fields.countryCode.trim()
  if (!isCountryCode(country)) return { kind: "unknown" }
  const name = findCity(country, city)
  return name ? { kind: "known", name } : { kind: "unknown" }
}
