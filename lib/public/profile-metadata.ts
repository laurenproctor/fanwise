import type { Metadata } from "next"
import { publicMediaRoutes } from "./media-routes"
import type { PublicProfileView } from "./types"
import { publicRoutes, publicUrl } from "@/lib/routes"

/**
 * A published profile's head: title, description, canonical URL, and the
 * share card.
 *
 * Built from four published fields and nothing else — the studio name, the
 * short introduction, whether there is an image, and the handle. Not the SEO
 * overrides the retired settings form used to write, not the contact address,
 * not the location: the builder does not edit those, so a value there is one
 * the creator can no longer see, and a head that quoted it would say something
 * the final preview never showed.
 *
 * The input is a `PublicProfileView`, which only the anon read path produces,
 * so a draft cannot reach this function.
 */
export function profileMetadata(profile: PublicProfileView, origin: string): Metadata {
  const canonical = publicUrl(origin, publicRoutes.profile(profile.handle))
  const title = `${profile.displayName} · Fanwise`
  const description = profile.shortBio ?? `Digital products by ${profile.displayName}, on Fanwise.`
  const images = profile.hasAvatar
    ? [{ url: publicUrl(origin, avatarPath(profile)), alt: profile.displayName }]
    : undefined

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
      ...(images ? { images } : {}),
    },
    twitter: { card: "summary", title, description, ...(images ? { images } : {}) },
  }
}

/**
 * The avatar route, versioned by the profile's last update. The route itself
 * is cached for a minute; the version is what makes a newly published image
 * show at once instead of after that minute.
 */
export function avatarPath(profile: Pick<PublicProfileView, "id" | "updatedAt">): string {
  return `${publicMediaRoutes.avatar(profile.id)}?v=${encodeURIComponent(profile.updatedAt)}`
}

export const NOT_FOUND_METADATA: Metadata = {
  title: "Not found · Fanwise",
  robots: { index: false, follow: false },
}
