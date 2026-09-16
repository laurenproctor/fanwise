import Link from "next/link"
import { ButtonLink } from "@/components/ui/button"
import { countryName } from "@/lib/location/countries"
import {
  activeFilters,
  creatorCountLabel,
  directoryHref,
  isFiltered,
  withChange,
  type DirectoryState,
} from "@/lib/public/directory"
import {
  DirectoryUnavailableError,
  loadDirectoryPage,
  loadFeaturedCreators,
  type DirectoryCreator,
} from "@/lib/public/directory-queries"
import { marketingRoutes } from "@/lib/routes"
import { CreatorUnit } from "./creator-unit"
import { AnnounceCount } from "./directory-client"

/**
 * The server-rendered parts of `/creators` below the controls.
 *
 * `DirectoryCount` and `DirectoryResults` both await `loadDirectoryPage` for
 * the same href. It is wrapped in React's per-request `cache`, so that is one
 * database read shared by the count in the results line and the grid.
 */

const sectionHeading =
  "font-display text-[26px] leading-[1.15] tracking-[-0.025em] text-[var(--color-ink)]"

export async function DirectoryCount({ state }: { state: DirectoryState }) {
  let text: string | null = null
  try {
    const result = await loadDirectoryPage(directoryHref(state))
    if (result.kind === "page") text = creatorCountLabel(result.total)
  } catch (error) {
    if (!(error instanceof DirectoryUnavailableError)) throw error
  }
  if (text === null)
    return <span className="text-[14.5px] text-[var(--color-ink-3)]">Creators</span>
  return (
    <>
      <span className="tabular text-[14.5px] text-[var(--color-ink-2)]">{text}</span>
      <AnnounceCount text={text} />
    </>
  )
}

export function CountPlaceholder() {
  return (
    <span aria-hidden className="inline-block h-4 w-24 rounded-[4px] bg-[var(--color-paper-2)]" />
  )
}

/**
 * The removable chips and Clear all. Plain links: removing a filter is a
 * navigation to the same page without it, which works with or without
 * JavaScript and lands in history like any other.
 */
export function ActiveFilterChips({ state }: { state: DirectoryState }) {
  const chips = activeFilters(state, { country: countryName })
  if (chips.length === 0) return null
  return (
    <>
      <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={chip.href}
              scroll={false}
              aria-label={`Remove filter: ${chip.label}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] sm:min-h-9 bg-[var(--color-paper-2)] py-1.5 pr-3 pl-3.5 text-[14px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-rule-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              <span className="max-w-[16ch] truncate">{chip.label}</span>
              <span aria-hidden className="text-[16px] leading-none text-[var(--color-ink-2)]">
                ×
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={directoryHref()}
        scroll={false}
        className="inline-flex min-h-11 items-center rounded-[4px] text-[14px] text-[var(--color-ink-2)] underline sm:min-h-9 underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        Clear all
      </Link>
    </>
  )
}

export async function DirectoryResults({ state }: { state: DirectoryState }) {
  const filtered = isFiltered(state)
  const href = directoryHref(state)

  let featured: DirectoryCreator[]
  let result: Awaited<ReturnType<typeof loadDirectoryPage>>
  try {
    ;[featured, result] = await Promise.all([
      filtered ? Promise.resolve([]) : loadFeaturedCreators(),
      loadDirectoryPage(href),
    ])
  } catch (error) {
    if (!(error instanceof DirectoryUnavailableError)) throw error
    return <DirectoryError retryHref={href} />
  }

  if (result.kind === "past-end") {
    return (
      <Notice
        title="There’s nothing on this page."
        body="The results have fewer pages than this link expects."
        action={{ label: "Go to the first page", href: directoryHref(withChange(state, {})) }}
      />
    )
  }

  if (result.total === 0) {
    return filtered ? (
      <Notice
        title="No creators match those filters."
        body="Try changing your search or removing a filter."
        action={{ label: "Clear all filters", href: directoryHref() }}
      />
    ) : (
      <Notice
        title="No public creators yet."
        body="Creators appear here once they publish a profile with at least one product."
        action={{ label: "Create your profile", href: marketingRoutes.signUp }}
      />
    )
  }

  const showFeatured = !filtered && state.page === 1 && featured.length > 0

  return (
    <div className="flex flex-col gap-16">
      {showFeatured ? (
        <section aria-labelledby="featured-creators">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-6">
            <h2 id="featured-creators" className={sectionHeading}>
              Featured creators
            </h2>
            <p className="text-[14.5px] text-[var(--color-ink-3)]">Selected by Fanwise</p>
          </div>
          <ul className="grid gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
            {featured.map((creator) => (
              <li key={creator.id} className="min-w-0">
                <CreatorUnit creator={creator} variant="featured" eager />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.creators.length > 0 ? (
        <section
          aria-labelledby="all-creators"
          className={showFeatured ? "border-t border-[var(--color-rule)] pt-12" : undefined}
        >
          <h2 id="all-creators" className={`${sectionHeading} pb-6`}>
            {filtered ? "Matching creators" : "All creators"}
          </h2>
          <ul className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {result.creators.map((creator, index) => (
              <li key={creator.id} className="min-w-0">
                <CreatorUnit
                  creator={creator}
                  variant="directory"
                  eager={!showFeatured && state.page === 1 && index < 4}
                />
              </li>
            ))}
          </ul>
          <Pagination state={state} page={result.page} pageCount={result.pageCount} />
        </section>
      ) : null}
    </div>
  )
}

/**
 * Numbered pages as links, not infinite scroll. Every page has an address, so
 * returning from a profile lands on the page the visitor left, and a keyboard
 * or screen-reader visitor is never chasing a list that grows as they read it.
 */
function Pagination({
  state,
  page,
  pageCount,
}: {
  state: DirectoryState
  page: number
  pageCount: number
}) {
  if (pageCount <= 1) return null
  return (
    <nav
      aria-label="Pages"
      className="mt-14 flex items-center justify-between gap-4 border-t border-[var(--color-rule)] pt-6"
    >
      {page > 1 ? (
        <ButtonLink variant="secondary" href={directoryHref({ ...state, page: page - 1 })}>
          <span aria-hidden>←</span> Previous
        </ButtonLink>
      ) : (
        <span />
      )}
      <p className="tabular text-[14px] text-[var(--color-ink-2)]">
        Page {page} of {pageCount}
      </p>
      {page < pageCount ? (
        <ButtonLink variant="secondary" href={directoryHref({ ...state, page: page + 1 })}>
          Next <span aria-hidden>→</span>
        </ButtonLink>
      ) : (
        <span />
      )}
    </nav>
  )
}

function Notice({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action: { label: string; href: string }
}) {
  return (
    <div className="border-y border-[var(--color-rule)] py-16 text-center">
      <h2 className={sectionHeading}>{title}</h2>
      <p className="mx-auto max-w-[46ch] pt-3 text-[15.5px] text-[var(--color-ink-2)]">{body}</p>
      <ButtonLink variant="secondary" href={action.href} className="mt-7">
        {action.label}
      </ButtonLink>
    </div>
  )
}

/**
 * A failed read. Calm, and nothing about why: the log has the provider's
 * error. Retry is a plain link to the same address, a full request rather
 * than a client transition, so it does not replay a cached failure.
 */
function DirectoryError({ retryHref }: { retryHref: string }) {
  return (
    <div role="alert" className="border-y border-[var(--color-rule)] py-16 text-center">
      <h2 className={sectionHeading}>The directory didn’t load.</h2>
      <p className="mx-auto max-w-[46ch] pt-3 text-[15.5px] text-[var(--color-ink-2)]">
        Something went wrong on our side. Your search is still in the address, so trying again picks
        up where you were.
      </p>
      <a
        href={retryHref}
        className="mt-7 inline-flex items-center justify-center rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-[22px] py-[12px] text-[15px] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
      >
        Try again
      </a>
    </div>
  )
}

/**
 * The shape of the results while they load: collage boxes at their real
 * ratios, so nothing moves when the work arrives. Static tints, no shimmer.
 */
export function DirectorySkeleton({ featured }: { featured: boolean }) {
  const block = "bg-[var(--color-paper-2)]"
  const identity = (
    <div className="mt-4 flex items-start gap-3.5">
      <span className={`size-12 shrink-0 rounded-full ${block}`} />
      <span className="flex flex-1 flex-col gap-2 pt-1">
        <span className={`h-4 w-2/5 rounded-[4px] ${block}`} />
        <span className={`h-3 w-4/5 rounded-[4px] ${block}`} />
        <span className={`h-3 w-3/5 rounded-[4px] ${block}`} />
      </span>
    </div>
  )
  return (
    <div aria-hidden className="flex flex-col gap-16">
      {featured ? (
        <div>
          <span className={`mb-6 block h-7 w-56 rounded-[6px] ${block}`} />
          <div className="grid gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i}>
                <span className={`block aspect-[3/2] w-full rounded-[10px] ${block}`} />
                {identity}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className={featured ? "border-t border-[var(--color-rule)] pt-12" : undefined}>
        <span className={`mb-6 block h-7 w-40 rounded-[6px] ${block}`} />
        <div className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i}>
              <span className={`block aspect-[2/1] w-full rounded-[10px] ${block}`} />
              {identity}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
