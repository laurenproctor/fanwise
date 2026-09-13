import type { NextConfig } from "next"
import { baselineHeaders, environmentFrom } from "./lib/security/headers"
import { PUBLIC_INTERNAL_PREFIX } from "./lib/routes"

/**
 * The host the dev server may serve its own dev resources to.
 *
 * Marketplace OAuth has to come back to a public HTTPS URL, so development
 * against a real provider runs through a tunnel, and the browser is then on a
 * hostname that is not localhost. Next blocks cross-origin access to /_next
 * dev resources by default, which is right; the visible effect is that
 * hydration never completes and every client component is silently inert.
 *
 * Derived from NEXT_PUBLIC_APP_URL rather than hardcoded, because a quick
 * tunnel gets a new hostname every restart and a pinned one would be stale by
 * the next session. Dev only: `next build` never reads this.
 */
function tunnelHost(): string[] {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) return []
  try {
    const { hostname } = new URL(url)
    return hostname === "localhost" || hostname === "127.0.0.1" ? [] : [hostname]
  } catch {
    return []
  }
}

const config: NextConfig = {
  reactStrictMode: true,
  // The headers every response carries, static assets included. The
  // Content-Security-Policy is not here: it carries a per-request nonce on the
  // dynamic routes, so the proxy sets it. lib/security/headers.ts owns both.
  async headers() {
    return [{ source: "/(.*)", headers: baselineHeaders(environmentFrom(process.env)) }]
  },
  /**
   * The profile's management pages moved out of Settings on 13 September 2026,
   * when Profile became a section of the workspace header. A bookmark, an email
   * link or an open tab at the old address lands on the same page at the new
   * one. `settings` is a reserved product slug, so no product page can be
   * behind the old path.
   */
  async redirects() {
    return [
      {
        source: "/:slug/settings/public-profile",
        destination: "/:slug/profile",
        permanent: true,
      },
      {
        source: "/:slug/settings/public-profile/:path*",
        destination: "/:slug/profile/:path*",
        permanent: true,
      },
    ]
  },
  /**
   * The public creator pages: `/@handle` and `/@handle/<anything>`.
   *
   * This is a config rewrite rather than a `NextResponse.rewrite()` in the
   * proxy, and the difference is the status code. A proxy rewrite produces a
   * response whose status is the proxy's own — 200 — and the rewritten page's
   * status does not replace it. So `notFound()` on a profile that does not
   * exist rendered the not-found page with `200 OK`: the right words, the
   * wrong answer, and a crawler would index "This page does not exist" as a
   * live page. A config rewrite resolves through the router instead, so the
   * page's own 404 is the response's 404.
   *
   * `beforeFiles`, so it is checked before the filesystem and before the
   * `app/[slug]` dynamic segment, which would otherwise match `@handle` and
   * send a signed-out visitor to the sign-in page.
   *
   * The canonical redirects — a capitalised handle, a trailing slash, a direct
   * hit on the internal path — stay in the proxy, because they depend on
   * comparing a path against its own lowercase form, which a static pattern
   * cannot express. lib/public/routing.ts owns that decision and a unit test
   * holds these patterns and that function to the same table.
   */
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/@:handle", destination: `${PUBLIC_INTERNAL_PREFIX}/:handle` },
        { source: "/@:handle/:path*", destination: `${PUBLIC_INTERNAL_PREFIX}/:handle/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
  allowedDevOrigins: tunnelHost(),
  experimental: {
    serverActions: {
      // Workspace icons (4 MiB, MAX_ICON_BYTES) and profile avatars (5 MiB,
      // MAX_AVATAR_BYTES) are posted to server actions. The default is 1 MB,
      // which refused them long before those checks could. This covers the
      // larger of the two plus multipart overhead. On Vercel the platform's
      // own 4.5 MB request body limit still applies and no setting here can
      // raise it, so an avatar between roughly 4.4 and 5 MB is refused there.
      bodySizeLimit: 5_400_000,
    },
  },
  // sharp ships prebuilt native binaries. Bundling it breaks the binding
  // resolution, so it stays external to the server build.
  serverExternalPackages: ["sharp"],
  turbopack: {
    // The outbound-request boundary (lib/net) is server code that the client
    // graph can see, because the listing editor reads every adapter for its
    // requirement specs. Next supplies a browser fallback for `crypto`; these
    // three have none, so an inert stub stands in for them in browser chunks
    // only. See lib/net/browser-stub.ts for why the stub throws.
    resolveAlias: {
      "node:net": { browser: "./lib/net/browser-stub.ts" },
      "node:dns": { browser: "./lib/net/browser-stub.ts" },
      "node:https": { browser: "./lib/net/browser-stub.ts" },
    },
  },
}

export default config
