import type { NextConfig } from "next"

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
  allowedDevOrigins: tunnelHost(),
  // sharp ships prebuilt native binaries. Bundling it breaks the binding
  // resolution, so it stays external to the server build.
  serverExternalPackages: ["sharp"],
}

export default config
