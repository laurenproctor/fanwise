/**
 * The addresses public media is served from.
 *
 * Their own module rather than entries in `lib/routes.ts` because a client
 * component imports them, and `lib/routes.ts` is reached from the proxy — two
 * bundles that should not be joined by a URL builder.
 *
 * Each takes an id and nothing else. The route handler behind it re-derives
 * whether the object may be served, from the database, on every request; the
 * id is not a capability and guessing one buys nothing.
 */
export const publicMediaRoutes = {
  asset: (assetId: string) => `/api/public/asset/${assetId}`,
  avatar: (profileId: string) => `/api/public/avatar/${profileId}`,
  outboundClick: () => "/api/public/outbound",
} as const
