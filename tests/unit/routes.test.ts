import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { routes } from "@/lib/routes"
import {
  RESERVED_PRODUCT_SLUGS,
  RESERVED_WORKSPACE_SLUGS,
  SLUG_LIMITS,
  avoidReserved,
  slugify,
} from "@/lib/slug"

const APP = join(__dirname, "..", "..", "app")

/** The slug shape the database enforces. A segment that cannot be a slug cannot collide. */
const SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/

function couldBeASlug(segment: string): boolean {
  return SLUG_SHAPE.test(segment) && segment.length >= SLUG_LIMITS.min
}

/**
 * The URL segments a directory contributes.
 *
 * A `(group)` directory contributes nothing itself and its children take its
 * place, which is why `/sign-in` is a real URL despite living under `(auth)`.
 * A `[dynamic]` directory is the slug itself, not a collision with it.
 */
function urlSegments(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (!statSync(join(dir, entry)).isDirectory()) continue
    if (entry.startsWith("[")) continue
    if (entry.startsWith("_")) continue
    if (entry.startsWith("(") && entry.endsWith(")")) {
      out.push(...urlSegments(join(dir, entry)))
      continue
    }
    out.push(entry)
  }
  return out
}

/**
 * The test that makes the reserved lists maintainable rather than a comment
 * someone has to remember. Adding `app/pricing/page.tsx` without reserving
 * "pricing" makes every workspace slugged `pricing` unreachable, and nothing
 * else in the suite would notice.
 */
describe("reserved slugs cover the routes that exist", () => {
  it("finds the route tree at all, so this cannot pass vacuously", () => {
    expect(urlSegments(APP).length).toBeGreaterThan(3)
    expect(urlSegments(join(APP, "[slug]")).length).toBeGreaterThan(2)
  })

  it("reserves every top-level segment a workspace slug could collide with", () => {
    const unreserved = urlSegments(APP)
      .filter(couldBeASlug)
      .filter((segment) => !RESERVED_WORKSPACE_SLUGS.has(segment))

    expect(unreserved).toEqual([])
  })

  it("reserves every workspace-level segment a product slug could collide with", () => {
    const unreserved = urlSegments(join(APP, "[slug]"))
      .filter(couldBeASlug)
      .filter((segment) => !RESERVED_PRODUCT_SLUGS.has(segment))

    expect(unreserved).toEqual([])
  })

  it("reserves nothing that is not a route, so the lists do not rot", () => {
    // A stale entry is harmless but misleading, and it hides the real rule.
    const topLevel = new Set(urlSegments(APP))
    for (const reserved of RESERVED_WORKSPACE_SLUGS) {
      expect(topLevel.has(reserved), `${reserved} is reserved but is not a route`).toBe(true)
    }

    const workspaceLevel = new Set(urlSegments(join(APP, "[slug]")))
    for (const reserved of RESERVED_PRODUCT_SLUGS) {
      expect(workspaceLevel.has(reserved), `${reserved} is reserved but is not a route`).toBe(true)
    }
  })
})

describe("avoidReserved", () => {
  it("leaves an ordinary slug exactly as it was", () => {
    expect(avoidReserved("facette-typeface", RESERVED_PRODUCT_SLUGS, "ab12")).toBe(
      "facette-typeface",
    )
  })

  it("moves a slug off a reserved word", () => {
    expect(avoidReserved("channels", RESERVED_PRODUCT_SLUGS, "ab12")).toBe("channels-ab12")
    expect(avoidReserved("sign-in", RESERVED_WORKSPACE_SLUGS, "ab12")).toBe("sign-in-ab12")
  })

  it("catches the names a person would plausibly type", () => {
    // Naming a product "New" or a workspace "Sign In" is not adversarial, it is
    // Tuesday. Each of these has to survive slugify and still be moved.
    for (const [name, reserved] of [
      ["New", RESERVED_PRODUCT_SLUGS],
      ["Channels", RESERVED_PRODUCT_SLUGS],
      ["Assets", RESERVED_PRODUCT_SLUGS],
      ["Sign In", RESERVED_WORKSPACE_SLUGS],
      ["Onboarding", RESERVED_WORKSPACE_SLUGS],
      ["API", RESERVED_WORKSPACE_SLUGS],
    ] as const) {
      const slug = slugify(name)
      expect(reserved.has(slug), `${name} slugs to ${slug}`).toBe(true)
      expect(avoidReserved(slug, reserved, "ab12")).not.toBe(slug)
    }
  })
})

describe("routes", () => {
  it("builds the addresses the app advertises", () => {
    expect(routes.workspace("best-night")).toBe("/best-night")
    expect(routes.product("best-night", "facette-typeface")).toBe("/best-night/facette-typeface")
    expect(routes.newProduct("best-night")).toBe("/best-night/new")
    expect(routes.channels("best-night")).toBe("/best-night/channels")
    expect(routes.settings("best-night")).toBe("/best-night/settings")
    expect(routes.productChannel("best-night", "facette-typeface", "c1")).toBe(
      "/best-night/facette-typeface/channels/c1",
    )
    expect(routes.assetDownload("best-night", "a1")).toBe("/best-night/assets/a1/download")
    expect(routes.assetPreview("best-night", "a1")).toBe("/best-night/assets/a1/preview")
  })

  it("carries no /w/ prefix anywhere", () => {
    // A realistic slug, deliberately: "w" as the workspace would make
    // routes.product() produce "/w/p" honestly and fail this for the wrong
    // reason.
    const built = [
      routes.workspace("studio"),
      routes.product("studio", "poster"),
      routes.newProduct("studio"),
      routes.channels("studio"),
      routes.settings("studio"),
      routes.productChannel("studio", "poster", "c1"),
      routes.assetDownload("studio", "a1"),
      routes.assetPreview("studio", "a1"),
    ]
    for (const path of built) {
      expect(path.startsWith("/w/"), path).toBe(false)
    }
  })
})
