import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { CITY_QUERY_MAX, searchCities } from "@/lib/location/cities"
import { isCountryCode } from "@/lib/location/countries"
import { loadBuilderContext } from "@/lib/public/draft-store"

/**
 * City suggestions for the builder's location field, within one country.
 *
 * A route handler rather than a server action for the reason the address
 * check beside it gives: server actions from one page run one at a time, so
 * a search on every pause in typing would hold the draft's autosave behind
 * it, and a superseded search could not be aborted.
 *
 * The dataset is public geography, so nothing here is private. It is still
 * members only, answered for a workspace the caller can see, so it is not an
 * open geocoding endpoint for anybody who finds the URL. Nothing is fetched
 * from anywhere: the answer is an in-memory prefix search over
 * lib/location/data/cities.json.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const search = new URL(request.url).searchParams
  const country = (search.get("country") ?? "").toUpperCase()
  const query = (search.get("q") ?? "").slice(0, CITY_QUERY_MAX)

  if (!isCountryCode(country)) return json({ error: "invalid_country" }, 400)

  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, slug)
  if (!ctx) return json({ error: "not_found" }, 404)

  return json({ cities: searchCities(country, query, 8) })
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}
