import type { Metadata } from "next"
import { Suspense } from "react"
import { MarketingPage } from "@/components/marketing/page-shell"
import {
  DirectoryAnalytics,
  DIRECTORY_STATUS_ID,
} from "@/components/public/directory/directory-client"
import {
  DirectoryControls,
  DirectorySortControl,
} from "@/components/public/directory/directory-controls"
import {
  ActiveFilterChips,
  CountPlaceholder,
  DirectoryCount,
  DirectoryResults,
  DirectorySkeleton,
} from "@/components/public/directory/directory-sections"
import { appOrigin } from "@/lib/channels/oauth"
import { directoryHref, isFiltered, parseDirectoryState } from "@/lib/public/directory"
import { loadDirectoryFacets } from "@/lib/public/directory-queries"
import { marketingRoutes, publicUrl } from "@/lib/routes"

/**
 * The public creator directory: discover Fanwise members through their work,
 * then meet them on their profile. The work earns attention; the profile
 * builds connection.
 *
 * Everything it shows is read as `anon` (lib/public/directory-queries.ts), so
 * the page is the same for every visitor, signed in or not, and cannot show a
 * draft to anyone — its owner included.
 *
 * Rendered per request, like the profile pages it links to. Publishing and
 * unpublishing are privacy operations, and a cached directory would keep a
 * creator listed after they took their profile down.
 *
 * The controls and the results line sit outside the Suspense boundary, so they
 * stay put while results load. The boundary is keyed on the address, so each
 * new search shows the skeleton rather than holding stale results on screen
 * under a changed query.
 */
export const dynamic = "force-dynamic"

const TITLE = "Discover independent creators · Fanwise"
const DESCRIPTION =
  "Discover designers, creators, and studios making typefaces, templates, brand systems, UI kits, and other creative products on Fanwise."

const FOOTER = [
  { label: "Product", href: marketingRoutes.landing },
  { label: "How it works", href: marketingRoutes.howItWorks },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "About", href: marketingRoutes.about },
  { label: "Terms", href: marketingRoutes.terms },
  { label: "Privacy", href: marketingRoutes.privacy },
]

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const state = parseDirectoryState(await searchParams)
  const canonical = publicUrl(appOrigin(), marketingRoutes.creators)
  // The directory itself is indexed. A search, a filter, another order or a
  // later page is the same content rearranged, so it is followed but not
  // indexed, and every variant names the plain directory as canonical.
  const plain = directoryHref(state) === marketingRoutes.creators
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical },
    robots: { index: plain, follow: true },
    openGraph: {
      type: "website",
      title: TITLE,
      description: DESCRIPTION,
      url: canonical,
      siteName: "Fanwise",
    },
  }
}

export default async function CreatorsPage({ searchParams }: Props) {
  const state = parseDirectoryState(await searchParams)
  const facets = await loadDirectoryFacets()
  const key = directoryHref(state)

  return (
    <MarketingPage nav={{ current: "creators" }} footer={FOOTER} wide reveal={false}>
      <DirectoryAnalytics />
      <main className="pb-24">
        <header className="pt-10 sm:pt-14">
          <h1 className="font-display text-[clamp(36px,5vw,58px)] leading-[1.04] font-normal tracking-[-0.035em] text-balance text-[var(--color-ink)]">
            Discover independent creators.
          </h1>
          <p className="max-w-[60ch] pt-3 text-[17px] leading-[1.5] text-[var(--color-ink-2)] sm:text-[19px]">
            Designers, creators, and studios making tools, templates, and assets for a more creative
            internet.
          </p>
        </header>

        <DirectoryControls state={state} facets={facets} />

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-[var(--color-rule)] pt-4">
          <Suspense key={key} fallback={<CountPlaceholder />}>
            <DirectoryCount state={state} />
          </Suspense>
          <ActiveFilterChips state={state} />
          <div className="ml-auto">
            <DirectorySortControl state={state} />
          </div>
        </div>

        {/* The one live region. See AnnounceCount for why it lives out here. */}
        <p id={DIRECTORY_STATUS_ID} role="status" aria-live="polite" className="sr-only" />

        <div className="mt-8">
          <Suspense
            key={key}
            fallback={
              <div role="status" aria-label="Loading creators">
                <DirectorySkeleton featured={!isFiltered(state) && state.page === 1} />
              </div>
            }
          >
            <DirectoryResults state={state} />
          </Suspense>
        </div>
      </main>
    </MarketingPage>
  )
}
