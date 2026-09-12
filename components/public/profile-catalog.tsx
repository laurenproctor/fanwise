"use client"

import { useMemo, useState } from "react"
import { ProductCard } from "./product-card"
import type { PublicProductCard } from "@/lib/public/types"

/**
 * The catalog, with its type filters.
 *
 * A client component only because the filter is client state. The cards it
 * renders are the ones the server already resolved, so filtering costs no
 * request and, more importantly, cannot reveal anything the server did not
 * already send — there is no "fetch the rest" path here to get wrong.
 *
 * The filters only appear when they would do something. A profile with four
 * products, all of them fonts, gets a row of one button that filters nothing,
 * which is worse than no row at all.
 */

/** Below this many products, a filter is furniture rather than a tool. */
const FILTER_THRESHOLD = 6

export function ProfileCatalog({
  handle,
  products,
}: {
  handle: string
  products: PublicProductCard[]
}) {
  const types = useMemo(() => {
    const seen = new Map<string, string>()
    for (const product of products) {
      if (!seen.has(product.productType)) seen.set(product.productType, product.typeLabel)
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [products])

  const [active, setActive] = useState<string | null>(null)

  const showFilters = products.length >= FILTER_THRESHOLD && types.length > 1
  const shown = active ? products.filter((p) => p.productType === active) : products

  return (
    <div className="flex flex-col gap-8">
      {showFilters ? (
        <div
          role="group"
          aria-label="Filter by product type"
          className="-mx-1 flex flex-wrap gap-2 px-1"
        >
          <FilterButton active={active === null} onClick={() => setActive(null)}>
            All
            <Count value={products.length} />
          </FilterButton>
          {types.map(([type, label]) => (
            <FilterButton key={type} active={active === type} onClick={() => setActive(type)}>
              {label}
              <Count value={products.filter((p) => p.productType === type).length} />
            </FilterButton>
          ))}
        </div>
      ) : null}

      {/*
        aria-live so a filter change is announced. Without it a keyboard or
        screen-reader visitor presses a filter and nothing tells them the grid
        beneath has changed; the count is the smallest honest thing to say.
      */}
      <p aria-live="polite" className="sr-only">
        {shown.length} {shown.length === 1 ? "product" : "products"} shown
      </p>

      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((product, index) => (
          <ProductCard
            key={product.slug}
            handle={handle}
            product={product}
            // The first row is above the fold on every breakpoint and is what
            // the largest-contentful-paint measurement actually watches.
            priority={index < 3}
          />
        ))}
      </ul>
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: React.PropsWithChildren<{ active: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The pressed state is carried by aria-pressed as well as by colour, so
      // it survives both a screen reader and a monochrome display.
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-[var(--radius-pill)] border px-4 py-2 text-[14px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
        active
          ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]"
          : "border-[var(--color-rule)] bg-transparent text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      }`}
    >
      {children}
    </button>
  )
}

function Count({ value }: { value: number }) {
  return <span className="tabular text-[12px] opacity-60">{value}</span>
}
