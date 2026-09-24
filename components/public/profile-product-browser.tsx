"use client"

import { useEffect, useId, useState } from "react"
import type { PresentationProduct } from "@/lib/public/profile-presentation"
import {
  DEFAULT_BROWSE,
  SEARCH_THRESHOLD,
  SORTS,
  SORT_LABELS,
  browseProducts,
  browseSearch,
  typeCounts,
  type BrowseState,
  type ProductSort,
} from "@/lib/public/product-browse"
import { formatPrice } from "./product-card"

/**
 * The products on a public profile, with the controls to look through them:
 * a search, a row of kinds ("Fonts", "Templates") and a sort.
 *
 * Everything happens in the browser, over the cards the page already drew,
 * so narrowing the grid is instant and makes no request. The state is written
 * back to the address with `replaceState`, so a visitor who filters to fonts
 * can copy a link that opens on fonts, without a history entry per keystroke.
 *
 * The controls appear only when they help. A kind filter needs two kinds; a
 * search and a sort need enough products to be worth searching
 * (`SEARCH_THRESHOLD`). A studio with three products gets three cards and no
 * furniture.
 *
 * In the builder's previews (`interactive={false}`) the controls are drawn,
 * because the preview is what visitors will see, but `inert`: no tab stops
 * between the form and Continue, and nothing that rewrites the builder's URL.
 */
export function ProfileProductBrowser({
  products,
  initial = DEFAULT_BROWSE,
  gridClassName,
  interactive,
}: {
  products: readonly PresentationProduct[]
  initial?: BrowseState
  gridClassName: string
  interactive: boolean
}) {
  const [state, setState] = useState<BrowseState>(initial)
  const ids = { search: useId(), sort: useId() }

  const kinds = typeCounts(products)
  const showKinds = kinds.length > 1
  const showSearch = products.length >= SEARCH_THRESHOLD
  const shown = browseProducts(products, state)
  const narrowed = shown.length !== products.length

  // The address follows the controls. Replace, not push: Back should leave the
  // profile, not step through every letter typed into the search.
  useEffect(() => {
    if (!interactive) return
    const url = `${window.location.pathname}${browseSearch(state)}${window.location.hash}`
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", url)
    }
  }, [state, interactive])

  const update = (change: Partial<BrowseState>) => setState((prev) => ({ ...prev, ...change }))
  const reset = () => setState(DEFAULT_BROWSE)

  return (
    <div className="flex flex-col gap-6">
      {showKinds || showSearch ? (
        <div
          role="search"
          aria-label="Products"
          inert={!interactive}
          className="flex flex-col gap-4"
        >
          {showSearch ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <label htmlFor={ids.search} className="sr-only">
                  Search products
                </label>
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  className="pointer-events-none absolute top-1/2 left-4 size-[16px] -translate-y-1/2 text-[var(--color-ink-2)]"
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
                  type="search"
                  value={state.query}
                  maxLength={100}
                  onChange={(event) => update({ query: event.target.value })}
                  placeholder="Search products"
                  autoComplete="off"
                  enterKeyHint="search"
                  className="h-11 w-full rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-[var(--color-paper-2)] pr-4 pl-11 text-[15px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus-visible:border-[var(--color-ink-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                />
              </div>
              <div className="relative shrink-0">
                <label htmlFor={ids.sort} className="sr-only">
                  Sort products
                </label>
                <select
                  id={ids.sort}
                  value={state.sort}
                  onChange={(event) => update({ sort: event.target.value as ProductSort })}
                  className="h-11 w-full appearance-none rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-transparent pr-10 pl-4 text-[14px] text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] sm:w-56"
                >
                  {SORTS.map((sort) => (
                    <option key={sort} value={sort}>
                      {SORT_LABELS[sort]}
                    </option>
                  ))}
                </select>
                <svg
                  aria-hidden
                  viewBox="0 0 16 16"
                  className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-[var(--color-ink-2)]"
                >
                  <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </div>
            </div>
          ) : null}

          {showKinds ? (
            <ul className="flex flex-wrap gap-2" aria-label="Filter by kind">
              <li>
                <KindChip
                  label="All"
                  count={products.length}
                  pressed={state.type === "all"}
                  onClick={() => update({ type: "all" })}
                />
              </li>
              {kinds.map((kind) => (
                <li key={kind.type}>
                  <KindChip
                    label={kind.label}
                    count={kind.count}
                    pressed={state.type === kind.type}
                    onClick={() => update({ type: kind.type })}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/*
        Announced when the grid changes under a control. Silent when nothing
        narrows it: the heading already says how many products there are.
      */}
      <p
        role="status"
        className={`text-[13px] text-[var(--color-ink-2)] ${narrowed ? "" : "sr-only"}`}
      >
        {narrowed
          ? shown.length === 0
            ? "No products match."
            : `Showing ${shown.length} of ${products.length} products.`
          : ""}
      </p>

      {shown.length > 0 ? (
        <ul className={`grid gap-x-5 gap-y-8 ${gridClassName}`}>
          {shown.map((product) => (
            <ProductTile key={product.key} product={product} interactive={interactive} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-[14px] border border-dashed border-[var(--color-rule)] px-5 py-8">
          <p className="text-[15px] text-[var(--color-ink)]">Nothing here matches that.</p>
          <p className="text-[14px] text-[var(--color-ink-2)]">
            The search looks at each product&rsquo;s name, kind and description.
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-5 text-[14px] text-[var(--color-ink)] hover:border-[var(--color-ink-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            Show all products
          </button>
        </div>
      )}
    </div>
  )
}

function KindChip({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string
  count: number
  pressed: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
        pressed
          ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]"
          : "border-[var(--color-rule)] text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      }`}
    >
      {label}
      <span className="tabular opacity-70">{count}</span>
    </button>
  )
}

function ProductTile({
  product,
  interactive,
}: {
  product: PresentationProduct
  interactive: boolean
}) {
  const linked = interactive && Boolean(product.href)
  const meta = [
    product.typeLabel,
    product.startingPrice ? `From ${formatPrice(product.startingPrice)}` : null,
  ].filter(Boolean)
  const body = (
    <>
      <div className="aspect-video w-full overflow-hidden rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-2)]">
        {product.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- see PublicImage. */
          <img
            src={product.imageUrl}
            // Inside a link the title follows as text, so the image stays
            // silent rather than making a screen reader say the name twice.
            alt={linked ? "" : product.imageAlt}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          // Intentional rather than an empty grey box: "no image yet" should be
          // distinguishable from "image still loading".
          <span
            role={linked ? undefined : "img"}
            aria-label={linked ? undefined : `${product.title} has no image`}
            aria-hidden={linked ? true : undefined}
            data-missing-image
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-[var(--color-ink-3)]"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              width="28"
              height="28"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            >
              <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
              <path d="m3.5 16 5-5 4 4 3-3 5 5" strokeLinejoin="round" />
              <circle cx="15.5" cy="9" r="1.5" />
            </svg>
            <span className="label-mono">{product.typeLabel}</span>
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-display text-[15px] break-words text-[var(--color-ink)] group-hover:underline group-hover:underline-offset-4">
          {product.title}
        </span>
        <span className="tabular text-[13px] text-[var(--color-ink-3)]">{meta.join(" · ")}</span>
        {product.summary ? (
          <span className="line-clamp-2 text-[14px] text-[var(--color-ink-2)]">
            {product.summary}
          </span>
        ) : null}
        {product.channelCount && product.channelCount > 0 ? (
          <span className="text-[13px] text-[var(--color-ink-3)]">
            Available on {product.channelCount}{" "}
            {product.channelCount === 1 ? "channel" : "channels"}
          </span>
        ) : null}
      </div>
    </>
  )

  // Same box either way, so the final preview and the public page lay out
  // identically; only the public page makes the tile a link.
  return (
    <li className="min-w-0">
      {linked ? (
        <a
          href={product.href!}
          className="group flex flex-col gap-3 rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
        >
          {body}
        </a>
      ) : (
        <div className="flex flex-col gap-3">{body}</div>
      )}
    </li>
  )
}
