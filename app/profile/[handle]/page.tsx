import type { Metadata } from "next"
import { notFound, permanentRedirect } from "next/navigation"
import { Suspense } from "react"
import { PublicShell } from "@/components/public/public-shell"
import { CatalogSection, CatalogSkeleton } from "@/components/public/catalog-section"
import { PublicAvatar } from "@/components/public/public-image"
import { ShareButton } from "@/components/public/share-button"
import { ButtonLink } from "@/components/ui/button"
import { initialsOf } from "@/lib/public/avatars"
import { resolveProfile } from "@/lib/public/queries"
import { displayHost } from "@/lib/public/urls"
import { publicRoutes, publicUrl } from "@/lib/routes"
import { appOrigin } from "@/lib/channels/oauth"

/**
 * A creator's public profile, served at `/@<handle>`.
 *
 * The browser is at `/@<handle>`; this file answers at `/profile/[handle]`,
 * because the proxy rewrote it there. See lib/public/routing.ts for why the
 * App Router leaves no other option, and note that nobody can reach this path
 * directly — the proxy answers `/profile/...` with a permanent redirect to the
 * `@` form before routing happens, so there is only ever one indexable URL.
 *
 * Everything is read as `anon` through a cookie-less client, so this page
 * renders identically for the creator who owns it and a stranger who has never
 * signed in. That is what makes it safe to cache, and it is a property of how
 * the data is fetched rather than a rule anybody has to follow.
 */

/**
 * Rendered per request, deliberately, with no full-route cache.
 *
 * The obvious setting here is a few minutes of ISR, and it was that until an
 * end-to-end test unpublished a profile and the page kept answering 200. The
 * reason is the rewrite: a request arrives at `/@handle` and is rewritten to
 * `/profile/handle`, and which of those two the route cache is keyed on is not
 * something this code should be betting a privacy guarantee on.
 * `revalidatePath()` can only name one of them.
 *
 * "Unpublishing takes a page off the public web, now" is the promise the
 * publish switch makes, and it is a privacy promise rather than a freshness
 * one. A cache that might serve an unpublished profile for another four
 * minutes is not a tuning question, so the cache is off until the invalidation
 * is proven rather than assumed. The reads behind a page are four indexed
 * queries; when that stops being cheap enough, the fix is a cache keyed on
 * something this file controls, plus a test that unpublishes and asserts 404.
 */
export const dynamic = "force-dynamic"

interface Params {
  params: Promise<{ handle: string }>
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params
  const resolution = await resolveProfile(handle)

  // A draft, a redirect target, or nothing at all. `noindex` covers all three:
  // metadata is generated before the page decides to 404 or redirect, and a
  // crawler that saw an indexable head here would have learned something the
  // body is about to refuse it.
  if (resolution.kind !== "found") {
    return { title: "Not found · Fanwise", robots: { index: false, follow: false } }
  }

  const profile = resolution.value
  const canonical = publicUrl(appOrigin(), publicRoutes.profile(profile.handle))
  const title = profile.seoTitle ?? `${profile.displayName} · Fanwise`
  const description =
    profile.seoDescription ??
    profile.shortBio ??
    `Digital products by ${profile.displayName}, on Fanwise.`

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "profile",
      title,
      description,
      url: canonical,
      siteName: "Fanwise",
    },
    twitter: { card: "summary", title, description },
  }
}

export default async function PublicProfilePage({ params }: Params) {
  const { handle } = await params
  const resolution = await resolveProfile(handle)

  // A handle the creator has since changed. Permanent, so a link printed
  // anywhere folds onto the current address rather than accumulating a hop.
  if (resolution.kind === "redirect") {
    permanentRedirect(publicRoutes.profile(resolution.to))
  }
  if (resolution.kind === "missing") notFound()

  const profile = resolution.value
  const canonical = publicUrl(appOrigin(), publicRoutes.profile(profile.handle))

  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-[1160px] px-5 pt-10 pb-4 sm:px-8 sm:pt-14">
        <header className="flex flex-col gap-7 border-b border-[var(--color-rule)] pb-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
              <PublicAvatar
                profileId={profile.id}
                displayName={profile.displayName}
                initials={initialsOf(profile.displayName)}
                hasAvatar={profile.hasAvatar}
                size={96}
              />

              <div className="flex min-w-0 flex-col gap-3">
                <h1 className="font-display text-[36px] leading-[1.05] font-extralight tracking-[-0.04em] text-balance sm:text-[44px]">
                  {profile.displayName}
                </h1>

                {profile.shortBio ? (
                  <p className="max-w-prose text-[16px] text-[var(--color-ink-2)]">
                    {profile.shortBio}
                  </p>
                ) : null}

                <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] text-[var(--color-ink-2)]">
                  {profile.location ? (
                    <li className="flex items-center gap-1.5">
                      <PinIcon />
                      {profile.location}
                    </li>
                  ) : null}
                  {profile.websiteUrl ? (
                    <li>
                      <ExternalLink href={profile.websiteUrl}>
                        {displayHost(profile.websiteUrl) ?? "Website"}
                      </ExternalLink>
                    </li>
                  ) : null}
                  {profile.instagramUrl ? (
                    <li>
                      <ExternalLink href={profile.instagramUrl}>Instagram</ExternalLink>
                    </li>
                  ) : null}
                </ul>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-start gap-3">
              {profile.contactUrl ? (
                <ButtonLink
                  href={profile.contactUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  Contact
                  <span className="sr-only"> {profile.displayName}, opens in a new tab</span>
                </ButtonLink>
              ) : null}
              <ShareButton url={canonical} title={profile.displayName} />
            </div>
          </div>
        </header>
      </div>

      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-14 px-5 pt-12 sm:px-8">
        {/*
          Nested here rather than in a loading.tsx beside this file. A
          route-level boundary starts the response before the page has decided
          anything, which turned a draft profile's 404 into a 200. See the
          docblock in components/public/catalog-section.tsx.
        */}
        <Suspense fallback={<CatalogSkeleton />}>
          <CatalogSection
            profileId={profile.id}
            handle={profile.handle}
            displayName={profile.displayName}
          />
        </Suspense>
      </div>
    </PublicShell>
  )
}

function ExternalLink({ href, children }: React.PropsWithChildren<{ href: string }>) {
  return (
    <a
      href={href}
      target="_blank"
      // nofollow because these are creator-supplied outbound links; see the
      // note in components/public/destination-list.tsx.
      rel="me noopener noreferrer nofollow"
      className="inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      <LinkIcon />
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.4 1.4" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.4-1.4" />
    </svg>
  )
}
