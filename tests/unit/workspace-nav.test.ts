import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { routes, workspaceSection } from "@/lib/routes"

/**
 * The workspace header's sections: Products, Channels, Profile, Settings.
 *
 * Profile became a section of its own on 13 September 2026, moved out of
 * Settings. What is held here: the order, that Profile is drawn exactly like
 * its neighbours, that the current-page marker follows the profile's pages and
 * its builder, and that Settings no longer claims them. There is one nav for
 * every width (it wraps to a second row on a phone), so the same markup is the
 * mobile nav.
 */

let pathname = "/"
vi.mock("next/navigation", () => ({ usePathname: () => pathname }))

const { WorkspaceNav } = await import("@/app/[slug]/workspace-nav")

function render(path: string) {
  pathname = path
  return renderToStaticMarkup(createElement(WorkspaceNav, { workspaceSlug: "studio" }))
}

const links = (markup: string) =>
  [...markup.matchAll(/<a([^>]*)>([^<]*)<\/a>/g)].map((m) => ({
    attrs: m[1]!,
    label: m[2]!,
    href: /href="([^"]+)"/.exec(m[1]!)?.[1],
    current: m[1]!.includes('aria-current="page"'),
    className: /class="([^"]+)"/.exec(m[1]!)?.[1] ?? "",
  }))

describe("the workspace navigation", () => {
  it("lists Products, Channels, Profile and Settings, in that order", () => {
    expect(links(render("/studio")).map((l) => [l.label, l.href])).toEqual([
      ["Products", "/studio"],
      ["Channels", "/studio/channels"],
      ["Profile", "/studio/profile"],
      ["Settings", "/studio/settings"],
    ])
  })

  it("draws Profile exactly like its neighbours: type, spacing, hover, focus ring and underline", () => {
    const [products, , profile] = links(render("/studio/channels"))
    // Neither is current here, so their classes must be identical.
    expect(profile!.className).toBe(products!.className)
    for (const token of [
      "min-h-11",
      "px-3",
      "text-[14px]",
      "focus-visible:outline-2",
      "after:h-[1.5px]",
      "hover:text-[var(--color-ink)]",
    ]) {
      expect(profile!.className).toContain(token)
    }
  })

  it.each([
    [routes.profile("studio")],
    [routes.publicProfileBuilder("studio")],
    [routes.publicProfileBuilderProducts("studio")],
    [routes.publicProfileBuilderPublish("studio")],
  ])("marks Profile, and only Profile, as current on %s", (path) => {
    const current = links(render(path)).filter((l) => l.current)
    expect(current.map((l) => l.label)).toEqual(["Profile"])
    // The marker is the underline as well as the colour.
    expect(current[0]!.className).toContain("after:bg-[var(--color-ink)]")
  })

  it("marks Settings on the settings page and not on a profile page", () => {
    expect(
      links(render("/studio/settings"))
        .filter((l) => l.current)
        .map((l) => l.label),
    ).toEqual(["Settings"])
    expect(links(render("/studio/profile")).find((l) => l.label === "Settings")!.current).toBe(
      false,
    )
  })

  it("wraps rather than overflowing on a narrow screen", () => {
    expect(render("/studio")).toMatch(/<ul class="[^"]*flex-wrap/)
  })
})

describe("workspaceSection for the profile", () => {
  it("puts the profile's page and every builder step under Profile", () => {
    for (const path of [
      "/studio/profile",
      "/studio/profile/builder",
      "/studio/profile/builder/products",
      "/studio/profile/builder/publish",
    ]) {
      expect(workspaceSection(path, "studio"), path).toBe("profile")
    }
  })

  it("is not fooled by a product slug that starts with the word", () => {
    // `profile` is a reserved product slug; `profile-kit` is an ordinary one.
    expect(workspaceSection("/studio/profile-kit", "studio")).toBe("products")
  })
})

describe("the old Settings address", () => {
  it("redirects permanently to the profile's own section, builder steps included", async () => {
    const config = (await import("@/next.config")).default
    const redirects = await config.redirects!()
    expect(redirects).toEqual(
      expect.arrayContaining([
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
      ]),
    )
  })
})
