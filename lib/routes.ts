/**
 * Every application URL, in one place.
 *
 * These were template literals scattered across twenty-five call sites, which
 * made the shape of the URL an emergent property of the codebase rather than a
 * decision. Moving `/w/<slug>/products/<slug>` to `/<slug>/<slug>` meant editing
 * all twenty-five and hoping. It should mean editing this file.
 *
 * A workspace slug now occupies the first path segment, so it shares a namespace
 * with every top-level route in the app, and a product slug shares one with the
 * workspace's own sub-pages. `RESERVED_WORKSPACE_SLUGS` and
 * `RESERVED_PRODUCT_SLUGS` in `lib/slug.ts` are what keep that namespace
 * honest: a slug that collides is unreachable, because Next resolves a static
 * segment before a dynamic one. Add a route here and you must add its first
 * segment there, in the same commit.
 */

/**
 * The marketing site. Public, unauthenticated, and the only routes here that a
 * signed-out visitor can reach. `/` is shared: it serves the landing page to a
 * visitor and resolves to a workspace for someone signed in.
 *
 * Every "Get started" on the site points at `signUp`, which is the real account
 * form. `start` is the address the design used for a signup page of its own; it
 * survives only as a redirect onto `signUp`, so a link written against the
 * mockups still lands somewhere that works.
 */
export const marketingRoutes = {
  landing: "/",
  marketplaces: "/marketplaces",
  howItWorks: "/how-it-works",
  pricing: "/pricing",
  about: "/about",
  start: "/start",
  terms: "/terms",
  privacy: "/privacy",
  signIn: "/sign-in",
  signUp: "/sign-up",
} as const

export const routes = {
  /** The catalog. A workspace's home is the list of what it sells. */
  workspace: (workspace: string) => `/${workspace}`,
  newProduct: (workspace: string) => `/${workspace}/new`,
  /**
   * Importing a product from a link.
   *
   * Under `/new` rather than at `/<workspace>/import`. Two reasons: `new` is
   * already in `RESERVED_PRODUCT_SLUGS`, so nesting here reserves no further
   * word in the product-slug namespace; and `/import` is wanted by a different
   * feature with the same English name, importing a listing already sold on a
   * connected channel (`docs/listing-import.md`). One word, two features, and
   * they must not share a route.
   */
  importProduct: (workspace: string) => `/${workspace}/new/link`,
  /**
   * One import, addressable.
   *
   * The id is in the URL because the reading happens in a background job: a
   * creator who closes the tab and comes back must land on the import that is
   * still running rather than on an empty field. `lib/imports/queries.ts` is
   * what makes that safe — the row is read through RLS, so an id belonging to
   * another workspace is indistinguishable from one that does not exist.
   */
  productImport: (workspace: string, importId: string) => `/${workspace}/new/link/${importId}`,
  product: (workspace: string, product: string) => `/${workspace}/${product}`,
  productChannel: (workspace: string, product: string, connectionId: string) =>
    `/${workspace}/${product}/channels/${connectionId}`,
  channels: (workspace: string) => `/${workspace}/channels`,
  settings: (workspace: string) => `/${workspace}/settings`,
  publicProfileSettings: (workspace: string) => `/${workspace}/settings/public-profile`,
  assetDownload: (workspace: string, assetId: string) => `/${workspace}/assets/${assetId}/download`,
  assetPreview: (workspace: string, assetId: string) => `/${workspace}/assets/${assetId}/preview`,
} as const

/**
 * The public web, which is a different namespace from everything above.
 *
 * A workspace slug occupies the first path segment; a public handle occupies
 * the first path segment *prefixed with `@`*, which no slug can be, because
 * `@` is not in the slug character set. The two therefore cannot collide at
 * the URL level no matter what anybody names anything.
 *
 * They can still collide in the *router*, which is a separate problem and a
 * subtler one: `app/[slug]` is a dynamic segment, and a dynamic segment
 * matches `@northline-studio` as happily as it matches `best-night`. The proxy
 * is what keeps them apart, by rewriting `/@handle` onto `publicInternal()`
 * before the router is consulted at all. See proxy.ts.
 *
 * `publicInternal()` is the destination of that rewrite and never an address
 * Fanwise advertises. A request that arrives at it directly is answered with a
 * permanent redirect to the canonical form, so the two paths cannot both be
 * indexed.
 */
export const publicRoutes = {
  profile: (handle: string) => `/@${handle}`,
  product: (handle: string, slug: string) => `/@${handle}/${slug}`,
  /** Reserved shape. No page answers it yet; the slug namespace already knows. */
  collection: (handle: string, slug: string) => `/@${handle}/collections/${slug}`,
} as const

/**
 * Where the proxy sends a public URL. Internal; never rendered into a page.
 *
 * Takes the handle rather than the public path, because the `@` is exactly
 * what is being stripped: `/@northline/aster` becomes `/profile/northline/aster`.
 * The prefix is a real segment in the route tree — an underscore-prefixed
 * folder is excluded from routing altogether and a route group contributes no
 * segment, so neither can be a rewrite destination — which is why `profile` is
 * in RESERVED_WORKSPACE_SLUGS.
 */
export const PUBLIC_INTERNAL_PREFIX = "/profile"

export function publicInternal(handle: string, ...rest: string[]): string {
  return [PUBLIC_INTERNAL_PREFIX, handle, ...rest].join("/")
}

/** An absolute URL, for metadata, sharing and the sitemap. */
export function publicUrl(origin: string, path: string): string {
  return new URL(path, origin).toString()
}

/** The three places the workspace header navigates between. */
export type WorkspaceSection = "products" | "channels" | "settings"

/**
 * Which of them a path belongs to, for the header's current-page marker.
 *
 * Products is the remainder rather than a prefix, because the catalog is the
 * workspace root and every product, `/new` included, hangs off it. A product's
 * own channel page is `/<workspace>/<product>/channels/...` and so stays under
 * Products: it is part of that product, not the workspace's channel list.
 */
export function workspaceSection(pathname: string, workspace: string): WorkspaceSection {
  const within = (base: string) => pathname === base || pathname.startsWith(`${base}/`)
  if (within(routes.channels(workspace))) return "channels"
  if (within(routes.settings(workspace))) return "settings"
  return "products"
}
