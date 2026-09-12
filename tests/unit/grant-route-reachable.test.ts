import { describe, expect, it } from "vitest"
import { PUBLIC_PATHS, PUBLIC_PATTERNS, isPublic } from "@/proxy"
import { listAdapters } from "@/lib/channels/registry"
import { supportsOAuth } from "@/lib/channels/registry"

/**
 * The one route in the application that has to answer a stranger.
 *
 * A channel whose provider posts the credential server to server sends it from
 * the store's own server, which holds no Fanwise session and never will.
 * `docs/security.md` says so, and so does the route's docblock: nobody is
 * signed in on that POST and nothing in it is trusted. The route earns its
 * safety by consuming a one-time state and proving the credential against the
 * account that state names, not by a cookie.
 *
 * The proxy did not know that. It answered WooCommerce's POST with a 307 to
 * /sign-in, so the consumer keys never arrived and no store could finish
 * connecting. Nothing failed loudly, because B8's only attempt died earlier on
 * the store's SSL check, and every unit test around the grant calls the adapter
 * directly rather than through the proxy.
 */

describe("the posted grant can be reached without a session", () => {
  it("lets a provider POST the grant for every channel that declares one", () => {
    const withGrant = listAdapters().filter(
      (adapter) => supportsOAuth(adapter) && adapter.oauth?.grant,
    )

    // If no adapter posts its grant this test is vacuous, and a guard that
    // protects nothing is the quiet way this regresses.
    expect(withGrant.length).toBeGreaterThan(0)

    for (const adapter of withGrant) {
      const path = `/api/channels/${adapter.key}/oauth/grant`
      expect(isPublic(path), `${adapter.key}'s grant is behind the sign-in redirect`).toBe(true)
    }
  })

  it("opens the grant and nothing else under it", () => {
    // The exemption is a pattern, so the blast radius is worth pinning. Only
    // the grant itself, and only one segment of channel key.
    expect(isPublic("/api/channels/woocommerce/oauth/grant")).toBe(true)

    expect(isPublic("/api/channels/woocommerce/oauth/grant/extra")).toBe(false)
    expect(isPublic("/api/channels/woocommerce/oauth")).toBe(false)
    expect(isPublic("/api/channels/woocommerce")).toBe(false)
    expect(isPublic("/api/channels")).toBe(false)
    expect(isPublic("/api/channels/a/b/oauth/grant")).toBe(false)
  })

  it("keeps the callback signed in", () => {
    // The creator returns to the callback in their own browser, carrying their
    // session, and it only reports. There is no reason to open it and every
    // reason not to.
    expect(isPublic("/api/channels/woocommerce/oauth/callback")).toBe(false)
    expect(isPublic("/api/channels/shopify/oauth/callback")).toBe(false)
  })

  it("does not open the rest of the application", () => {
    // A regex loose at either end would quietly make the app public, which is
    // the failure that matters more than the one being fixed.
    expect(isPublic("/onboarding")).toBe(false)
    expect(isPublic("/best-night")).toBe(false)
    expect(isPublic("/api/products")).toBe(false)
    expect(isPublic("/anything/api/channels/woocommerce/oauth/grant")).toBe(false)

    for (const pattern of PUBLIC_PATTERNS) {
      expect(pattern.source.startsWith("^"), `${pattern} is not anchored at the start`).toBe(true)
      expect(pattern.source.endsWith("$"), `${pattern} is not anchored at the end`).toBe(true)
    }
  })

  it("adds no page to the named public list", () => {
    // The pattern list is for routes a provider calls. A page that wants to be
    // public still goes in PUBLIC_PATHS, where it can be read at a glance.
    expect(PUBLIC_PATHS.some((path) => path.includes("oauth"))).toBe(false)
  })
})
