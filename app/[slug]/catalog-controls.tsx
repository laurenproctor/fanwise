"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CATALOG_FILTERS, CATALOG_FILTER_KEYS, type CatalogFilter } from "@/lib/catalog/summary"

/**
 * Finding one product in a catalog, with two controls and no more.
 *
 * A real `<form method="get">` pointed at the catalog's own address, so the
 * state lives in the URL: a filtered catalog can be linked, reloaded and gone
 * back to, and the server renders it rather than the browser hiding rows it
 * already drew. Without JavaScript the form still submits and still works,
 * which is why the fallback is the markup rather than an afterthought.
 *
 * With JavaScript the submit is intercepted and handed to the router instead,
 * so changing a filter is a client-side navigation rather than a document load
 * and the page does not flash. The select submits on change, because a select
 * a creator has to confirm is a select they will leave set wrong.
 *
 * There is deliberately no sort. `listProducts` orders newest first and a sort
 * control that offered the same order under another name would be the fake
 * control this screen is meant not to have.
 */
export function CatalogControls({
  basePath,
  query,
  filter,
  showClear,
}: {
  basePath: string
  query: string
  filter: CatalogFilter
  /** Whether anything is actually narrowing the list right now. */
  showClear: boolean
}) {
  const router = useRouter()

  function navigate(next: { q?: string; status?: CatalogFilter }) {
    const params = new URLSearchParams()
    const q = (next.q ?? query).trim()
    const status = next.status ?? filter

    // Only what is actually set. A URL carrying `?q=&status=all` describes the
    // unfiltered catalog in the most confusing way available.
    if (q) params.set("q", q)
    if (status !== "all") params.set("status", status)

    const search = params.toString()
    router.push(search ? `${basePath}?${search}` : basePath)
  }

  return (
    <form
      action={basePath}
      method="get"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        navigate({
          q: String(data.get("q") ?? ""),
          status: String(data.get("status") ?? "all") as CatalogFilter,
        })
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-1 sm:max-w-[320px]">
        <span className="label-mono">Search</span>
        <span className="relative flex items-center">
          <SearchIcon />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Product name or type"
            className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] py-2.5 pl-9 pr-3 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)]"
          />
        </span>
      </label>

      <label className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-initial">
        <span className="label-mono">Show</span>
        <select
          name="status"
          defaultValue={filter}
          onChange={(event) => navigate({ status: event.target.value as CatalogFilter })}
          className="min-h-[44px] w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] sm:w-auto"
        >
          {CATALOG_FILTER_KEYS.map((key) => (
            <option key={key} value={key}>
              {CATALOG_FILTERS[key].label}
            </option>
          ))}
        </select>
      </label>

      {/*
        A real button rather than implicit submission alone. Enter in the search
        box submits either way, but a control a creator can see and press is the
        difference between a search box and a search box they think is broken.
      */}
      <Button
        type="submit"
        variant="secondary"
        className="min-h-[44px] shrink-0 px-4 py-2 text-[14px]"
      >
        Search
      </Button>

      {showClear ? (
        <Link
          href={basePath}
          className="min-h-[44px] self-center rounded-[6px] px-1 text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] sm:self-end sm:py-2.5"
        >
          Clear
        </Link>
      ) : null}
    </form>
  )
}

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="pointer-events-none absolute left-3 text-[var(--color-ink-3)]"
    >
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
