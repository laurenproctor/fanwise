import type { Metadata } from "next"
import { notFound, permanentRedirect } from "next/navigation"
import { PublicShell } from "@/components/public/public-shell"
import { PublicProfile } from "@/components/public/public-profile"
import { ShareButton } from "@/components/public/share-button"
import { publicMediaRoutes } from "@/lib/public/media-routes"
import { NOT_FOUND_METADATA, avatarPath, profileMetadata } from "@/lib/public/profile-metadata"
import { presentationFromPublicView } from "@/lib/public/profile-presentation"
import { loadProfileCatalog, resolveProfile } from "@/lib/public/queries"
import { publicRoutes, publicUrl } from "@/lib/routes"
import { appOrigin } from "@/lib/channels/oauth"

/**
 * A creator's public profile, served at `/@<handle>`.
 *
 * The browser is at `/@<handle>`; this file answers at `/profile/[handle]`,
 * because the proxy rewrote it there (lib/public/routing.ts), and a direct
 * request for `/profile/...` is redirected back to the `@` form first.
 *
 * It renders the published profile through `PublicProfile`, the same component
 * the builder's live and final previews use, so what the creator reviewed is
 * what a visitor gets. The data comes only from `resolveProfile` and
 * `loadProfileCatalog`, both of which read as `anon` through a cookie-less
 * client: RLS returns published rows and nothing else, so a draft — the
 * builder's draft table, an unpublished profile, a product page the builder
 * hid — cannot reach this page even for the creator who owns it.
 *
 * The props handed to the renderer are a `ProfilePresentation`, which names
 * public fields only, so nothing private is serialized into the page.
 */

/**
 * Rendered per request, with no full-route cache. The rewrite means the route
 * cache could be keyed on either path, and "unpublishing takes the page off
 * the web now" is a privacy promise, not a freshness preference. The reads
 * behind the page are a handful of indexed queries.
 */
export const dynamic = "force-dynamic"

interface Params {
  params: Promise<{ handle: string }>
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params
  const resolution = await resolveProfile(handle)
  // A draft, a redirect or nothing: noindex for all three, and nothing about
  // the studio, because metadata is generated before the page decides.
  if (resolution.kind !== "found") return NOT_FOUND_METADATA
  return profileMetadata(resolution.value, appOrigin())
}

export default async function PublicProfilePage({ params }: Params) {
  const { handle } = await params
  const resolution = await resolveProfile(handle)

  // A handle the creator has since changed: permanent, so a printed link folds
  // onto the current address.
  if (resolution.kind === "redirect") permanentRedirect(publicRoutes.profile(resolution.to))
  if (resolution.kind === "missing") notFound()

  const profile = resolution.value
  // Awaited here rather than streamed. A route-level loading boundary commits
  // the response before notFound() can set a 404, and a nested one would draw
  // the products after the identity, which the preview never does.
  const cards = await loadProfileCatalog(profile.id)

  const presentation = presentationFromPublicView(profile, cards, {
    avatarUrl: avatarPath(profile),
    imageUrl: publicMediaRoutes.asset,
    productHref: (slug) => publicRoutes.product(profile.handle, slug),
  })
  const canonical = publicUrl(appOrigin(), publicRoutes.profile(profile.handle))

  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-[1160px] px-5 pt-6 sm:px-8">
        <div className="flex justify-end">
          <ShareButton url={canonical} title={profile.displayName} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1160px]">
        <PublicProfile
          profile={presentation}
          layout="responsive"
          nameAs="h1"
          emptyProductsMessage="No products to show yet."
        />
      </div>
    </PublicShell>
  )
}
