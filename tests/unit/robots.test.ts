import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/channels/oauth", () => ({ appOrigin: () => "https://fanwise.test" }))

import robots from "@/app/robots"
import { PUBLIC_INTERNAL_PREFIX } from "@/lib/routes"

/**
 * What a crawler is told, read from the metadata route itself.
 *
 * tests/unit/public-routing.test.ts pins the internal prefix; this pins that the
 * robots file actually disallows it, and points at the sitemap. That both files
 * are served to a stranger is tests/unit/proxy.test.ts, and what the sitemap
 * lists is read from a running server in journey-14-public-pages.spec.ts.
 */
describe("robots", () => {
  const result = robots()
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules]
  const everyone = rules.find((rule) => rule.userAgent === "*")

  it("keeps crawlers off the internal rewrite target, so /@handle is the only address indexed", () => {
    expect(PUBLIC_INTERNAL_PREFIX).toBe("/profile")
    expect(everyone?.disallow).toContain("/profile/")
  })

  it("leaves the public web open and names the sitemap on this origin", () => {
    expect(everyone?.allow).toBe("/")
    expect(result.sitemap).toBe("https://fanwise.test/sitemap.xml")
  })
})
