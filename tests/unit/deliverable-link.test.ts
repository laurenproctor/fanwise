import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DELIVERABLE_LINK_PATH,
  buildDeliverableLinkUrl,
  deliverableLinkToken,
  isWellFormedToken,
  urlSafeFilename,
  withoutExtension,
} from "@/lib/channels/deliverable-link"
import { isPublic } from "@/proxy"

/**
 * The durable deliverable address: its shape, and the public route behind it.
 *
 * The database half (who can read the table, stability, the race, cascades,
 * every refusal) is tests/db/deliverable-links.test.ts. What is here needs no
 * database: that the address survives a store's handling of it, that an
 * adapter can tell its own addresses from a creator's, and that the route
 * answers every refusal identically and never lets a redirect be cached.
 */

const TOKEN = "A".repeat(20) + "b_c-" + "9".repeat(19)

describe("the address", () => {
  it("names the file for the buyer and carries the token in the query", () => {
    const url = new URL(
      buildDeliverableLinkUrl("https://app.fanwise.test", "Aster Grotesk.zip", TOKEN),
    )
    expect(url.pathname).toBe("/api/public/deliverable/Aster-Grotesk.zip")
    expect(url.searchParams.get("token")).toBe(TOKEN)
  })

  it("puts every address in one directory, so a store allow-lists Fanwise once", () => {
    const a = new URL(buildDeliverableLinkUrl("https://app.fanwise.test", "a.zip", TOKEN))
    const b = new URL(buildDeliverableLinkUrl("https://app.fanwise.test", "b.pdf", "z".repeat(43)))
    const parent = (u: URL) => u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1)
    expect(parent(a)).toBe(DELIVERABLE_LINK_PATH)
    expect(parent(b)).toBe(DELIVERABLE_LINK_PATH)
  })

  it.each([
    ["Aster Grotesk.zip", "Aster-Grotesk.zip"],
    ["Café  Sans (v2).otf", "Caf-Sans-v2-.otf"],
    ["../../etc/passwd", "etc-passwd"],
    ["  ", "download"],
    ["???", "download"],
  ])("makes %j a path segment that needs no encoding: %j", (input, expected) => {
    const safe = urlSafeFilename(input)
    expect(safe).toBe(expected)
    expect(encodeURIComponent(safe)).toBe(safe)
    expect(safe).not.toContain("/")
  })

  it("drops only the last extension", () => {
    expect(withoutExtension("aster.tar.gz")).toBe("aster.tar")
    expect(withoutExtension("aster")).toBe("aster")
    expect(withoutExtension(".hidden")).toBe(".hidden")
  })

  it("recognizes its own addresses, and nothing else", () => {
    expect(deliverableLinkToken(buildDeliverableLinkUrl("https://x.test", "a.zip", TOKEN))).toBe(
      TOKEN,
    )
    expect(deliverableLinkToken("https://shop.test/wp-content/uploads/a.zip")).toBeNull()
    expect(deliverableLinkToken("https://x.test/api/public/deliverable/a.zip")).toBeNull()
    expect(
      deliverableLinkToken("https://x.test/api/public/deliverable/a.zip?token=short"),
    ).toBeNull()
    expect(deliverableLinkToken("not a url")).toBeNull()
    expect(deliverableLinkToken(null)).toBeNull()
  })

  it("accepts only 43-character base64url tokens", () => {
    expect(isWellFormedToken(TOKEN)).toBe(true)
    expect(isWellFormedToken(TOKEN + "x")).toBe(false)
    expect(isWellFormedToken("A".repeat(42) + "=")).toBe(false)
  })
})

describe("the route", () => {
  it("is reachable without a session, like the rest of /api/public", () => {
    expect(isPublic("/api/public/deliverable/Aster-Grotesk.zip")).toBe(true)
  })

  it("names no channel, and loads the service role only on the server path", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "app", "api", "public", "deliverable", "[filename]", "route.ts"),
      "utf8",
    )
    expect(source).not.toMatch(/woocommerce|shopify|etsy/i)
    expect(source).toContain('await import("@/lib/supabase/admin")')
  })
})

let resolved: { storagePath: string; filename: string } | null = null
let mintFails = false
const resolveCalls: string[] = []

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
vi.mock("@/lib/publishing/deliverable-links", () => ({
  resolveDeliverableLink: async (_admin: unknown, token: string) => {
    resolveCalls.push(token)
    return resolved
  },
}))
vi.mock("@/lib/products/storage", () => ({
  createDownloadUrl: async (path: string, filename: string) => {
    if (mintFails) throw new Error("storage down")
    return `https://storage.test/sign/${path}?download=${encodeURIComponent(filename)}`
  },
}))

const { GET } = await import("@/app/api/public/deliverable/[filename]/route")

function ask(query: string) {
  return GET(
    new Request(`https://app.fanwise.test/api/public/deliverable/Aster-Grotesk.zip${query}`),
  )
}

describe("serving a token", () => {
  beforeEach(() => {
    resolved = null
    mintFails = false
    resolveCalls.length = 0
  })

  it("redirects to a short signed link named for the buyer, and is never cached", async () => {
    resolved = { storagePath: "ws/p/a.zip", filename: "Aster Grotesk.zip" }
    const response = await ask(`?token=${TOKEN}`)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://storage.test/sign/ws/p/a.zip?download=Aster%20Grotesk.zip",
    )
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(resolveCalls).toEqual([TOKEN])
  })

  it("answers every refusal with the same uncached 404, and serves by token, never by filename", async () => {
    const missing = await ask("")
    const unknown = await ask(`?token=${TOKEN}`)

    for (const response of [missing, unknown]) {
      expect(response.status).toBe(404)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(await response.text()).toBe("Not found")
    }
    // The filename segment was never consulted; only the token was.
    expect(resolveCalls).toEqual(["", TOKEN])
  })

  it("says the file is temporarily unavailable when storage cannot sign", async () => {
    resolved = { storagePath: "ws/p/a.zip", filename: "Aster Grotesk.zip" }
    mintFails = true
    const response = await ask(`?token=${TOKEN}`)
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
})
