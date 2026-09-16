"use client"

import { track } from "@vercel/analytics"
import { useRouter } from "next/navigation"
import { useEffect, useId, useRef, useState, useTransition } from "react"
import {
  DIRECTORY_SORTS,
  MAX_QUERY_LENGTH,
  PRODUCT_TYPE_FILTER_LABELS,
  SORT_LABELS,
  directoryHref,
  normalizeQuery,
  withChange,
  type DirectorySort,
  type DirectoryState,
} from "@/lib/public/directory"
import { marketingRoutes } from "@/lib/routes"
import type { DirectoryFacets } from "@/lib/public/directory-queries"
import type { ProductType } from "@/lib/public/types"

/**
 * The directory's search, filters and sort.
 *
 * Every control writes the URL and nothing else; the server page reads it back
 * and renders. So a control never holds results, the back button undoes a
 * filter, and a link someone shares opens on exactly what they saw.
 *
 * Without JavaScript the search and the product type are still a GET form on
 * /creators, which is why the fields have `name`s and there is an Apply
 * button. With it, a change navigates at once and typing navigates after a
 * pause.
 */

export const DIRECTORY_FORM_ID = "creator-directory-form"

/** Long enough to finish a word, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 350

const pill =
  "min-h-11 rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-transparent text-[15px] text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"

function useDirectoryNavigation() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const go = (state: DirectoryState, mode: "push" | "replace" = "push") => {
    startTransition(() => {
      router[mode](directoryHref(state), { scroll: false })
    })
  }
  return { go, pending }
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-[var(--color-ink-2)]"
    >
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function DirectoryControls({
  state,
  facets,
}: {
  state: DirectoryState
  facets: DirectoryFacets
}) {
  const { go, pending } = useDirectoryNavigation()
  const [text, setText] = useState(state.q)
  const [filtersOpen, setFiltersOpen] = useState(state.country !== null)
  const committed = useRef(state.q)
  const filtersButton = useRef<HTMLButtonElement>(null)
  const ids = { search: useId(), type: useId(), panel: useId(), country: useId(), city: useId() }

  // The URL changed from outside this box — back, forward, a chip, Clear all.
  // Typing ahead of a navigation that has not landed yet is not that, which is
  // what `committed` tells apart.
  useEffect(() => {
    if (state.q !== committed.current) {
      committed.current = state.q
      setText(state.q)
    }
  }, [state.q])

  // Debounced search. Starting a search is a history entry, so Back returns
  // to the directory as it was; refining one replaces it, so a typed word is
  // not one entry per pause.
  useEffect(() => {
    const q = normalizeQuery(text)
    if (q === committed.current) return
    const timer = window.setTimeout(() => {
      const mode = committed.current === "" ? "push" : "replace"
      committed.current = q
      go(withChange(state, { q }), mode)
      if (q) track("Creator searched")
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // `state` is deliberately read at fire time only; re-arming the timer on
    // every render would restart the pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const applyFilter = (change: Partial<DirectoryState>, filter: string) => {
    go(withChange({ ...state, q: normalizeQuery(text) }, change))
    track("Creator filter applied", { filter })
  }

  const cities = state.country ? (facets.cities[state.country] ?? []) : []
  const locationCount = (state.country ? 1 : 0) + (state.city ? 1 : 0)

  return (
    <form
      id={DIRECTORY_FORM_ID}
      role="search"
      action={marketingRoutes.creators}
      method="get"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault()
        const q = normalizeQuery(text)
        committed.current = q
        go(withChange(state, { q }))
        if (q) track("Creator searched")
      }}
      className="mt-8"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={ids.search} className="sr-only">
            Search creators and work
          </label>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="pointer-events-none absolute top-1/2 left-5 size-[18px] -translate-y-1/2 text-[var(--color-ink-2)]"
          >
            <circle
              cx="8.5"
              cy="8.5"
              r="5.75"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M13 13l4.25 4.25"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <input
            id={ids.search}
            name="q"
            type="search"
            value={text}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search creators and work"
            autoComplete="off"
            enterKeyHint="search"
            className="h-13 w-full rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-[var(--color-paper-2)] pr-5 pl-12 text-[16px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus-visible:border-[var(--color-ink-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:flex lg:w-auto">
          <div className="relative">
            <label htmlFor={ids.type} className="sr-only">
              Product type
            </label>
            <select
              id={ids.type}
              name="productType"
              value={state.productType ?? ""}
              onChange={(event) =>
                applyFilter(
                  { productType: (event.target.value || null) as ProductType | null },
                  "productType",
                )
              }
              className={`${pill} w-full appearance-none pr-10 pl-5 lg:w-52`}
            >
              <option value="">Product type</option>
              {(Object.keys(PRODUCT_TYPE_FILTER_LABELS) as ProductType[]).map((type) => (
                <option key={type} value={type}>
                  {PRODUCT_TYPE_FILTER_LABELS[type]}
                </option>
              ))}
            </select>
            <Chevron />
          </div>

          <button
            ref={filtersButton}
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={ids.panel}
            onClick={() => setFiltersOpen((open) => !open)}
            className={`${pill} relative flex items-center justify-between gap-2 pr-10 pl-5 text-left lg:w-44`}
          >
            <span>
              Filters
              {locationCount > 0 ? (
                <span className="ml-1.5 text-[var(--color-ink-3)]">
                  <span className="sr-only">, </span>
                  {locationCount}
                  <span className="sr-only"> active</span>
                </span>
              ) : null}
            </span>
            <Chevron />
          </button>
        </div>
      </div>

      {/*
        The secondary filters, in the page's flow rather than a floating
        popover: a ruled row beneath the controls that pushes the results down.
        Hidden with `hidden` so it is out of the tab order while closed. It
        starts open when a location filter is already applied, so the value
        that is narrowing the results is on screen.
      */}
      <div
        id={ids.panel}
        hidden={!filtersOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setFiltersOpen(false)
            filtersButton.current?.focus()
          }
        }}
        className="mt-3 border-t border-[var(--color-rule)] pt-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-[560px]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.country} className="text-[13px] text-[var(--color-ink-2)]">
              Country
            </label>
            <div className="relative">
              <select
                id={ids.country}
                name="country"
                value={state.country ?? ""}
                onChange={(event) =>
                  applyFilter({ country: event.target.value || null }, "country")
                }
                className={`${pill} w-full appearance-none pr-10 pl-5`}
              >
                <option value="">Any country</option>
                {facets.countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
              <Chevron />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.city} className="text-[13px] text-[var(--color-ink-2)]">
              City
            </label>
            <div className="relative">
              <select
                id={ids.city}
                name="city"
                value={state.city ?? ""}
                disabled={!state.country || cities.length === 0}
                onChange={(event) => applyFilter({ city: event.target.value || null }, "city")}
                className={`${pill} w-full appearance-none pr-10 pl-5 disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <option value="">{state.country ? "Any city" : "Choose a country first"}</option>
                {cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
              <Chevron />
            </div>
          </div>
        </div>
      </div>

      <noscript>
        <button type="submit" className={`${pill} mt-3 px-5`}>
          Apply
        </button>
      </noscript>
    </form>
  )
}

/**
 * `Sort: Featured`, set apart from the filters because it reorders rather
 * than narrows. Part of the same form through `form=`, so it applies without
 * JavaScript too.
 */
export function DirectorySortControl({ state }: { state: DirectoryState }) {
  const { go } = useDirectoryNavigation()
  const id = useId()
  return (
    <div className="relative flex items-center gap-1 text-[14px] text-[var(--color-ink-2)]">
      <label htmlFor={id}>Sort:</label>
      <select
        id={id}
        name="sort"
        form={DIRECTORY_FORM_ID}
        value={state.sort}
        onChange={(event) => {
          const sort = event.target.value as DirectorySort
          go(withChange(state, { sort }))
          track("Creator filter applied", { filter: "sort", value: sort })
        }}
        className="min-h-11 cursor-pointer appearance-none rounded-[6px] bg-transparent pr-6 pl-1 text-[14px] text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        {DIRECTORY_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 right-0 size-3.5 -translate-y-1/2"
      >
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  )
}
