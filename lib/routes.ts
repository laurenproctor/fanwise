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

export const routes = {
  /** The catalog. A workspace's home is the list of what it sells. */
  workspace: (workspace: string) => `/${workspace}`,
  newProduct: (workspace: string) => `/${workspace}/new`,
  product: (workspace: string, product: string) => `/${workspace}/${product}`,
  productChannel: (workspace: string, product: string, connectionId: string) =>
    `/${workspace}/${product}/channels/${connectionId}`,
  channels: (workspace: string) => `/${workspace}/channels`,
  settings: (workspace: string) => `/${workspace}/settings`,
  assetDownload: (workspace: string, assetId: string) => `/${workspace}/assets/${assetId}/download`,
  assetPreview: (workspace: string, assetId: string) => `/${workspace}/assets/${assetId}/preview`,
} as const
