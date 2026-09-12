import type { MetadataRoute } from "next"
import { appOrigin } from "@/lib/channels/oauth"
import { PUBLIC_INTERNAL_PREFIX } from "@/lib/routes"

/**
 * What a crawler may index.
 *
 * `/@handle` and the marketing site are open; everything else is not. The
 * disallow list is short on purpose — a robots file is a public document, and
 * a long one is a map of where the interesting things are — so it names
 * prefixes rather than routes.
 *
 * `/profile/` is listed even though the proxy already answers it with a
 * permanent redirect to the `@` form. Belt and braces: a crawler that has the
 * internal path from somewhere else follows the redirect and could otherwise
 * record the pair, and this removes any question about which URL is canonical.
 *
 * Private application routes are `/<workspace-slug>/...`, which share the
 * first path segment with public handles and so cannot be named by a pattern.
 * They do not need to be: every one of them requires a session, and a crawler
 * that follows one is redirected to the sign-in page. Nothing links to them
 * from a public page in the first place.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = appOrigin()

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          `${PUBLIC_INTERNAL_PREFIX}/`,
          "/onboarding",
          "/sign-in",
          "/sign-up",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  }
}
