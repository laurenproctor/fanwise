import { beforeEach, describe, expect, it, vi } from "vitest"
import { findCity, searchCities } from "@/lib/location/cities"
import {
  COUNTRIES,
  countryName,
  formatLocation,
  isCountryCode,
  searchCountries,
} from "@/lib/location/countries"
import { checkCity } from "@/lib/public/location-check"

/**
 * A profile's location: a country from a standard list, and a city within it.
 *
 * The datasets are local (lib/location/data, built from GeoNames by
 * scripts/build-location-data.mjs), so every answer here is deterministic and
 * nothing is fetched.
 */

describe("countries", () => {
  it("are ISO 3166-1 alpha-2 codes with a display name, and nothing else", () => {
    expect(COUNTRIES.length).toBeGreaterThan(240)
    for (const country of COUNTRIES) {
      expect(country.code, country.name).toMatch(/^[A-Z]{2}$/)
      expect(country.name.trim()).toBe(country.name)
    }
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length)
    expect(countryName("US")).toBe("United States")
    expect(countryName("NL")).toBe("Netherlands")
    expect(countryName("ZZ")).toBeNull()
    expect(isCountryCode("us")).toBe(false)
  })

  it("match partial text from the start of a name or of any word in it", () => {
    expect(searchCountries("unit").map((c) => c.code)).toEqual(
      expect.arrayContaining(["US", "GB", "AE"]),
    )
    expect(searchCountries("kingdom").map((c) => c.code)).toContain("GB")
    expect(searchCountries("")).toHaveLength(COUNTRIES.length)
  })

  it("put an exact alias or code first, so a short query finds the obvious country", () => {
    expect(searchCountries("uk")[0]?.code).toBe("GB")
    expect(searchCountries("USA")[0]?.code).toBe("US")
    expect(searchCountries("de")[0]?.code).toBe("DE")
  })

  it("ignore accents and case", () => {
    expect(searchCountries("CÔTE")[0]?.code).toBe("CI")
    expect(searchCountries("turkiye")[0]?.code).toBe("TR")
  })

  it("return nothing, not everything, for text that matches no country", () => {
    expect(searchCountries("atlantis")).toEqual([])
  })
})

describe("cities", () => {
  it("are searched within one country only", () => {
    const us = searchCities("US", "bro")
    expect(us[0]).toEqual({ name: "Brooklyn", region: "New York" })
    expect(us.length).toBeLessThanOrEqual(8)
    expect(searchCities("FR", "brooklyn")).toEqual([])
  })

  it("find a later word too, after names that start with the text", () => {
    const names = searchCities("US", "york").map((c) => c.name)
    expect(names[0]).toBe("York")
    expect(names).toContain("New York City")
  })

  it("tell same-named places apart by region", () => {
    const springfields = searchCities("US", "springfield").filter((c) => c.name === "Springfield")
    expect(new Set(springfields.map((c) => c.region)).size).toBe(springfields.length)
    expect(springfields.length).toBeGreaterThan(3)
  })

  it("answer nothing for an empty query or an unknown country", () => {
    expect(searchCities("US", "  ")).toEqual([])
    expect(searchCities("ZZ", "paris")).toEqual([])
  })

  it("resolve to the dataset's own spelling, ignoring case and accents", () => {
    expect(findCity("BR", "sao paulo")).toBe("São Paulo")
    expect(findCity("US", "BROOKLYN")).toBe("Brooklyn")
  })

  it("never match a city against a country it is not in", () => {
    expect(findCity("FR", "Brooklyn")).toBeNull()
    // Paris, Texas: the same name is a real place in another country.
    expect(findCity("US", "Paris")).toBe("Paris")
    expect(findCity("FR", "Paris")).toBe("Paris")
    expect(findCity("US", "Brooklyn, New York")).toBeNull()
  })
})

describe("checking a draft's city on the server", () => {
  it("passes an empty city, whatever the country", () => {
    expect(checkCity({ city: "", countryCode: "" })).toEqual({ kind: "empty" })
    expect(checkCity({ city: "  ", countryCode: "US" })).toEqual({ kind: "empty" })
  })

  it("accepts a real pair and returns the spelling to store", () => {
    expect(checkCity({ city: "sao paulo", countryCode: "BR" })).toEqual({
      kind: "known",
      name: "São Paulo",
    })
  })

  it("refuses a mismatched pair, or a city with no valid country", () => {
    expect(checkCity({ city: "Brooklyn", countryCode: "FR" })).toEqual({ kind: "unknown" })
    expect(checkCity({ city: "Brooklyn", countryCode: "" })).toEqual({ kind: "unknown" })
    expect(checkCity({ city: "Atlantis", countryCode: "US" })).toEqual({ kind: "unknown" })
  })
})

describe("the location line", () => {
  it.each([
    [{ city: "Brooklyn", countryCode: "US" }, "Brooklyn, United States"],
    [{ city: "", countryCode: "US" }, "United States"],
    [{ city: null, countryCode: "JP" }, "Japan"],
    [{ city: "Brooklyn", countryCode: null, legacy: "Brooklyn, New York" }, "Brooklyn, New York"],
    [{ city: null, countryCode: null, legacy: "   " }, null],
    [{ city: null, countryCode: null }, null],
    [{ city: "Lagos", countryCode: "NG", legacy: "Old text" }, "Lagos, Nigeria"],
  ])("reads %j as %j, never with blank punctuation", (input, expected) => {
    expect(formatLocation(input)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// The builder's cities route
// ---------------------------------------------------------------------------

let ctx: object | null = { profile: { id: "p" } }
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }))
vi.mock("@/lib/public/draft-store", () => ({ loadBuilderContext: async () => ctx }))

const { GET } = await import("@/app/[slug]/profile/builder/cities/route")

async function ask(query: string) {
  const response = await GET(
    new Request(`https://fanwise.example/studio/profile/builder/cities?${query}`),
    {
      params: Promise.resolve({ slug: "studio" }),
    },
  )
  return {
    status: response.status,
    body: await response.json(),
    cache: response.headers.get("cache-control"),
  }
}

describe("the cities route", () => {
  beforeEach(() => {
    ctx = { profile: { id: "p" } }
  })

  it("answers a workspace member with at most eight suggestions in that country", async () => {
    const { status, body, cache } = await ask("country=US&q=bro")
    expect(status).toBe(200)
    expect(cache).toBe("no-store")
    expect(body.cities[0]).toEqual({ name: "Brooklyn", region: "New York" })
    expect(body.cities.length).toBeLessThanOrEqual(8)
  })

  it("answers nothing about a workspace the caller cannot see", async () => {
    ctx = null
    const { status, body } = await ask("country=US&q=bro")
    expect(status).toBe(404)
    expect(body).not.toHaveProperty("cities")
  })

  it("refuses a country that is not a code", async () => {
    expect((await ask("country=United%20States&q=bro")).status).toBe(400)
    expect((await ask("q=bro")).status).toBe(400)
  })
})
