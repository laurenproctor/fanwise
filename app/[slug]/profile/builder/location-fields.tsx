"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"
import { Combobox, type ComboboxOption, type ComboboxStatus } from "@/components/ui/combobox"
import { countryName, searchCountries } from "@/lib/location/countries"
import { routes } from "@/lib/routes"

/**
 * The profile's location: a country, then a city in it.
 *
 * Two comboboxes rather than one free-text field, so what reaches the page is
 * a real place. The country list ships with the page and filters as you type;
 * the city list is asked for, a moment after typing pauses, from the builder's
 * cities route, and only ever within the chosen country. The city field is
 * disabled until there is a country, and changing the country clears the city,
 * because a city chosen for one country is not a city of another.
 *
 * A profile saved before this field existed may carry free text ("Brooklyn,
 * New York"). It is shown here, untouched, until the creator picks a country,
 * and it keeps appearing on the live page until they publish one. Nothing
 * guesses a country from that text.
 */

const citiesResponse = z.object({
  cities: z.array(z.object({ name: z.string(), region: z.string().nullable() })),
})

const SEARCH_DELAY_MS = 200

export function LocationFields({
  workspaceSlug,
  countryId,
  cityId,
  countryCode,
  city,
  legacyLocation,
  errors,
  onChange,
  onRemoveLegacy,
}: {
  workspaceSlug: string
  countryId: string
  cityId: string
  countryCode: string
  city: string
  legacyLocation: string
  errors: { countryCode?: string | null; city?: string | null; location?: string | null }
  onChange: (next: { countryCode: string; city: string }) => void
  onRemoveLegacy: () => void
}) {
  const [countryQuery, setCountryQuery] = useState("")
  const countryOptions = useMemo(
    () => searchCountries(countryQuery).map((c) => ({ value: c.code, label: c.name })),
    [countryQuery],
  )
  const selectedCountry = countryName(countryCode)
    ? { value: countryCode, label: countryName(countryCode)! }
    : null

  const [cityOptions, setCityOptions] = useState<ComboboxOption[]>([])
  const [cityStatus, setCityStatus] = useState<ComboboxStatus>("idle")
  const lastQuery = useRef("")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      inFlight.current?.abort()
    },
    [],
  )

  function searchCity(query: string) {
    lastQuery.current = query
    if (timer.current) clearTimeout(timer.current)
    inFlight.current?.abort()
    if (!selectedCountry || query.trim().length === 0) {
      setCityOptions([])
      setCityStatus("idle")
      return
    }
    setCityStatus("loading")
    const country = selectedCountry.value
    timer.current = setTimeout(async () => {
      const controller = new AbortController()
      inFlight.current = controller
      try {
        const response = await fetch(routes.publicProfileCities(workspaceSlug, country, query), {
          signal: controller.signal,
          cache: "no-store",
        })
        if (!response.ok) throw new Error(`cities ${response.status}`)
        const parsed = citiesResponse.parse(await response.json())
        // A newer keystroke has already asked again; this answer is stale.
        if (controller.signal.aborted || lastQuery.current !== query) return
        setCityOptions(
          parsed.cities.map((c) => ({
            value: `${c.name}|${c.region ?? ""}`,
            label: c.name,
            detail: c.region,
          })),
        )
        setCityStatus("idle")
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("[profile] city search failed", error)
        setCityStatus("error")
      }
    }, SEARCH_DELAY_MS)
  }

  const selectedCity = city.trim() ? { value: city, label: city } : null
  const showLegacy = legacyLocation.trim().length > 0 && !selectedCountry

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-2 text-[14px] text-[var(--color-ink)]">Location (optional)</legend>

      {showLegacy ? (
        <div className="flex flex-col items-start gap-2 rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-4 py-3 text-[14px]">
          <p className="text-[var(--color-ink-2)]">
            Your profile shows{" "}
            <span className="text-[var(--color-ink)]">&ldquo;{legacyLocation.trim()}&rdquo;</span>.
            Choose a country and city below to replace it.
          </p>
          {errors.location ? (
            <p className="text-[13px] text-[var(--color-ink)]">{errors.location}</p>
          ) : null}
          <button
            type="button"
            onClick={onRemoveLegacy}
            className="min-h-11 rounded-[6px] text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            Remove this location
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Combobox
          id={countryId}
          label="Country"
          noun="country"
          placeholder="Start typing a country"
          selected={selectedCountry}
          options={countryOptions}
          emptyMessage="No country matches that."
          error={errors.countryCode ?? null}
          onQueryChange={setCountryQuery}
          onSelect={(option) => {
            setCountryQuery("")
            const next = option?.value ?? ""
            if (next === countryCode) return
            setCityOptions([])
            onChange({ countryCode: next, city: "" })
          }}
        />
        <Combobox
          id={cityId}
          label="City"
          noun="city"
          placeholder={selectedCountry ? "Start typing a city" : "Choose a country first"}
          disabled={!selectedCountry}
          selected={selectedCity}
          options={cityOptions}
          status={cityStatus}
          minQueryLength={1}
          emptyMessage={
            selectedCountry
              ? `No city in ${selectedCountry.label} matches that.`
              : "Choose a country first."
          }
          errorMessage="Cities couldn't load."
          hint="Cities of about 15,000 people or more. Can't find yours? Choose the nearest, or leave it empty."
          error={errors.city ?? null}
          onQueryChange={searchCity}
          onRetry={() => searchCity(lastQuery.current)}
          onSelect={(option) => onChange({ countryCode, city: option?.label ?? "" })}
        />
      </div>
    </fieldset>
  )
}
