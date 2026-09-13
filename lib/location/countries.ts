import data from "./data/countries.json"

/**
 * Countries, for a profile's location.
 *
 * Stored as an ISO 3166-1 alpha-2 code and never as a name: the code is what
 * the database constrains and compares, and the name is a label derived from
 * it here. The list is small enough (252 rows, 5 KB) to ship to the browser,
 * so the country field filters locally and a keystroke costs no request.
 *
 * Built from GeoNames by scripts/build-location-data.mjs. No provider, key or
 * account is involved at run time.
 */

export interface Country {
  code: string
  name: string
}

export const COUNTRIES: readonly Country[] = (data as Array<[string, string]>).map(
  ([code, name]) => ({ code, name }),
)

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]))

/**
 * Other names people type for a country. Searched, never displayed: the label
 * is always the dataset's own name, so "UK" finds the United Kingdom and the
 * profile still says "United Kingdom".
 */
const ALIASES: Record<string, readonly string[]> = {
  US: ["usa", "united states of america", "america"],
  GB: ["uk", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
  AE: ["uae"],
  KR: ["korea", "republic of korea"],
  CZ: ["czech republic"],
  TR: ["turkiye"],
  CI: ["cote d'ivoire", "cote divoire"],
  NL: ["holland", "the netherlands"],
  MK: ["macedonia"],
  CD: ["drc", "congo"],
  CG: ["congo"],
  RU: ["russian federation"],
  VN: ["viet nam"],
}

/** Lowercase, accents removed, punctuation folded to spaces. The same fold the city search uses. */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function isCountryCode(value: string): boolean {
  return BY_CODE.has(value)
}

export function countryName(code: string | null | undefined): string | null {
  return (code && BY_CODE.get(code)?.name) || null
}

/**
 * Countries matching partial text. An exact name, alias or code first ("uk"
 * is the United Kingdom before it is Ukraine), then a name or alias starting
 * with it, then one with a later word starting with it ("kingdom"). Empty text
 * lists everything, in name order.
 */
export function searchCountries(query: string, limit = COUNTRIES.length): Country[] {
  const q = foldForSearch(query)
  if (q.length === 0) return COUNTRIES.slice(0, limit)

  const exact: Country[] = []
  const starts: Country[] = []
  const words: Country[] = []
  for (const country of COUNTRIES) {
    const names = [country.name, ...(ALIASES[country.code] ?? [])].map(foldForSearch)
    if (names.includes(q) || country.code.toLowerCase() === q) exact.push(country)
    else if (names.some((name) => name.startsWith(q))) starts.push(country)
    else if (names.some((name) => name.split(" ").some((word) => word.startsWith(q)))) {
      words.push(country)
    }
  }
  return [...exact, ...starts, ...words].slice(0, limit)
}

/**
 * The location line a profile shows: "Brooklyn, United States", or the country
 * alone, or the legacy free text for a profile that has no structured location
 * yet. Never a stray comma: a missing part is left out rather than left blank.
 */
export function formatLocation(input: {
  city: string | null | undefined
  countryCode: string | null | undefined
  legacy?: string | null
}): string | null {
  const country = countryName(input.countryCode)
  if (country) {
    const city = input.city?.trim()
    return city ? `${city}, ${country}` : country
  }
  const legacy = input.legacy?.trim()
  return legacy ? legacy : null
}
