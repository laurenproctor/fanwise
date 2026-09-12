import type { MetadataRoute } from "next"
import { appOrigin } from "@/lib/channels/oauth"
import { listPublishedForSitemap } from "@/lib/public/queries"
import { marketingRoutes, publicRoutes, publicUrl } from "@/lib/routes"

/**
 * The sitemap: the marketing site, plus every published public page.
 *
 * Drafts are absent, and not because of a filter written here. The query runs
 * as `anon` like every other public read, so an unpublished profile and every
 * page beneath it are invisible to it — "exclude drafts from the sitemap" is a
 * consequence of how the data is fetched rather than a rule somebody has to
 * remember when they add a column.
 *
 * The `@` form is the only one listed. `/profile/...` never appears, because
 * it is not an address: the proxy answers it with a permanent redirect, and
 * listing a redirect in a sitemap is how a site ends up with two entries for
 * one page.
 *
 * No `changeFrequency`. It is a hint every major crawler has said it ignores,
 * and a fabricated one is noise. `lastModified` is real: it is the row's own
 * `updated_at`, so a page that has not changed does not claim to have.
 */
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = appOrigin()

  const marketing: MetadataRoute.Sitemap = [
    { url: publicUrl(origin, marketingRoutes.landing), priority: 1 },
    { url: publicUrl(origin, marketingRoutes.howItWorks), priority: 0.8 },
    { url: publicUrl(origin, marketingRoutes.pricing), priority: 0.8 },
    { url: publicUrl(origin, marketingRoutes.marketplaces), priority: 0.7 },
    { url: publicUrl(origin, marketingRoutes.about), priority: 0.5 },
    { url: publicUrl(origin, marketingRoutes.terms), priority: 0.3 },
    { url: publicUrl(origin, marketingRoutes.privacy), priority: 0.3 },
  ]

  let published: Awaited<ReturnType<typeof listPublishedForSitemap>> = []
  try {
    published = await listPublishedForSitemap()
  } catch (error) {
    // A sitemap that is missing the creator pages is worse than one that is
    // only the marketing site, and both are better than a 500: a crawler that
    // gets an error here may not come back for a while.
    console.error("[public] sitemap could not list published pages", error)
  }

  const creators: MetadataRoute.Sitemap = published.flatMap((profile) => [
    {
      url: publicUrl(origin, publicRoutes.profile(profile.handle)),
      lastModified: new Date(profile.updatedAt),
      priority: 0.7,
    },
    ...profile.products.map((product) => ({
      url: publicUrl(origin, publicRoutes.product(profile.handle, product.slug)),
      lastModified: new Date(product.updatedAt),
      priority: 0.6,
    })),
  ])

  return [...marketing, ...creators]
}
