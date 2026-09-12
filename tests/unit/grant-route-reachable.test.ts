import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"
import { PUBLIC_PATHS, PUBLIC_PATTERNS, isPublic } from "@/proxy"
import { listAdapters, supportsOAuth } from "@/lib/channels/registry"

const ROOT = join(__dirname, "..", "..")

/**
 * The routes that have to answer a stranger.
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

/**
 * The other route another company's server calls.
 *
 * Found by sweeping every route in app/api after the grant turned out to be
 * unreachable, rather than by waiting for it to fail: the payment provider's
 * webhook was behind the same sign-in redirect, so every subscription event
 * would have been answered with a 307 and dropped. Nothing inside Fanwise can
 * see that happen. The sender sees the redirect; Fanwise sees nothing at all.
 *
 * It earns its place the same way the grant does. It verifies the provider's
 * signature over the raw bytes before reading a field, and records each event
 * by the provider's own id so a redelivery collides at the database.
 */
describe("the payment provider's webhook can be reached without a session", () => {
  it("is public", () => {
    expect(isPublic("/api/billing/webhook")).toBe(true)
  })

  it("opens the webhook and nothing else under billing", () => {
    expect(isPublic("/api/billing/webhook/extra")).toBe(false)
    expect(isPublic("/api/billing")).toBe(false)
    expect(isPublic("/api/billing/portal")).toBe(false)
    expect(isPublic("/api/billing/checkout")).toBe(false)
  })
})

/**
 * The sweep itself, kept.
 *
 * Twice now a route another company calls has been unreachable because the
 * proxy guards by default and nothing announced the exception. This asserts
 * the list both ways, so adding a route that says it is unauthenticated
 * without opening it fails here, and opening one that never said so fails too.
 */
describe("every route that says nobody is signed in is reachable, and only those", () => {
  const API = join(ROOT, "app", "api")

  function routeFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...routeFiles(full))
      else if (entry === "route.ts") out.push(full)
    }
    return out
  }

  /** app/api/billing/webhook/route.ts -> /api/billing/webhook */
  function pathFor(file: string): string {
    return (
      "/" +
      relative(ROOT, dirname(file))
        .split(sep)
        .join("/")
        .replace(/^app\//, "")
    )
  }

  /** A concrete path the proxy would see, with the dynamic segment filled in. */
  function concrete(routePath: string): string {
    return routePath.replace(/\[[^\]]+\]/g, "woocommerce")
  }

  const routes = routeFiles(API).map((file) => ({
    file,
    path: pathFor(file),
    declaresNoSession: /[Nn]obody is signed in/.test(readFileSync(file, "utf8")),
  }))

  it("finds the routes at all", () => {
    // A sweep that swept nothing would pass every assertion below.
    expect(routes.length).toBeGreaterThan(2)
    expect(routes.some((route) => route.declaresNoSession)).toBe(true)
  })

  it("reaches every route whose docblock says nobody is signed in", () => {
    const unreachable = routes
      .filter((route) => route.declaresNoSession)
      .filter((route) => !isPublic(concrete(route.path)))
      .map((route) => route.path)

    expect(unreachable).toEqual([])
  })

  it("opens no route that does not say so, beyond the named list", () => {
    // /api/health is public by name and says nothing about sessions, which is
    // fine: it is the one route with nothing behind it to protect.
    const opened = routes
      .filter((route) => !route.declaresNoSession)
      .filter((route) => isPublic(concrete(route.path)))
      .map((route) => route.path)

    expect(opened).toEqual(["/api/health"])
  })
})
