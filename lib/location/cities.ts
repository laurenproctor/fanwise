import data from "./data/cities.json"
import { foldForSearch, isCountryCode } from "./countries"

/**
 * Cities, for a profile's location. Server only.
 *
 * The dataset is every populated place of 15,000 people or more, from
 * GeoNames (about 34,000, 700 KB), grouped by country and ordered by
 * population. That is too large to ship to a browser for a field most
 * creators fill once, so the city field asks the builder's cities route, and
 * the same module decides on the server whether a saved city is real.
 *
 * A smaller town is not in it. A creator from one can choose their country
 * alone, or the nearest city; docs/data-model.md records the choice.
 *
 * Every lookup is scoped to one country. "Paris" in the United States is
 * Paris, Texas, and a city is never matched against a country it is not in.
 */

export interface CitySuggestion {
  name: string
  /** The state or province, to tell two Springfields apart. Null when the dataset has none. */
  region: string | null
}

type Row = [name: string, regionIndex: number, ascii?: string]
type CountryCities = { r: string[]; c: Row[] }

interface IndexedCity extends CitySuggestion {
  folded: string[]
}

const DATA = data as unknown as Record<string, CountryCities>
const INDEX = new Map<string, IndexedCity[]>()

function citiesOf(countryCode: string): IndexedCity[] {
  const cached = INDEX.get(countryCode)
  if (cached) return cached
  const source = DATA[countryCode]
  const cities = (source?.c ?? []).map(([name, regionIndex, ascii]) => ({
    name,
    region: regionIndex >= 0 ? (source!.r[regionIndex] ?? null) : null,
    folded: [...new Set([foldForSearch(name), ascii ? foldForSearch(ascii) : ""])].filter(Boolean),
  }))
  INDEX.set(countryCode, cities)
  return cities
}

export const CITY_QUERY_MAX = 80

/**
 * Cities in one country matching partial text. Names starting with it first,
 * largest first; then names with a later word starting with it ("york" finds
 * New York City). One entry per name: the same name in two regions is shown
 * once per region.
 */
export function searchCities(countryCode: string, query: string, limit = 8): CitySuggestion[] {
  if (!isCountryCode(countryCode)) return []
  const q = foldForSearch(query.slice(0, CITY_QUERY_MAX))
  if (q.length === 0) return []

  const starts: CitySuggestion[] = []
  const words: CitySuggestion[] = []
  for (const city of citiesOf(countryCode)) {
    if (city.folded.some((name) => name.startsWith(q))) {
      starts.push({ name: city.name, region: city.region })
      if (starts.length >= limit) break
    } else if (
      words.length < limit &&
      city.folded.some((name) => name.split(" ").some((word) => word.startsWith(q)))
    ) {
      words.push({ name: city.name, region: city.region })
    }
  }
  return [...starts, ...words].slice(0, limit)
}

/**
 * The dataset's own spelling of a city in a country, or null when the country
 * has no such city. Case and accents are ignored, so "sao paulo" is São Paulo;
 * what is stored is the dataset's spelling, never what was typed.
 */
export function findCity(countryCode: string, name: string): string | null {
  if (!isCountryCode(countryCode)) return null
  const q = foldForSearch(name)
  if (q.length === 0) return null
  return citiesOf(countryCode).find((city) => city.folded.includes(q))?.name ?? null
}
