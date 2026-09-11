import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import config from "@/next.config"
import {
  STATIC_MARKETING_ROUTES,
  applicationPolicy,
  baselineHeaders,
  createNonce,
  cspReportUri,
  environmentFrom,
  isStaticMarketingRoute,
  marketingPolicy,
  marketingReportOnlyPolicy,
  type Environment,
} from "@/lib/security/headers"
import { THEME_KEY } from "@/components/ui/theme-toggle"

/**
 * The browser headers, read from the same functions the proxy and the config
 * call. The properties that matter are stated as tests rather than as
 * comments: what production's script rule may and may not contain, which
 * origins a policy admits, and which routes are the prerendered ones.
 */

const ROOT = join(__dirname, "..", "..")
const SUPABASE = "https://whepzmlbhhuxjswezall.supabase.co"
const input = (environment: Environment) => ({ environment, supabaseUrl: SUPABASE })

function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name) out.set(name, sources)
  }
  return out
}

/** Every network origin a policy names, across all its directives. */
function admittedOrigins(policy: string): Set<string> {
  const origins = new Set<string>()
  for (const sources of directives(policy).values()) {
    for (const source of sources) {
      if (/^(https?|wss?):\/\//.test(source)) origins.add(source)
    }
  }
  return origins
}

const originalEnv = { ...process.env }
afterEach(() => {
  process.env = { ...originalEnv }
})

describe("the environment is read from Vercel first", () => {
  it.each([
    [{ VERCEL_ENV: "production", NODE_ENV: "production" }, "production"],
    [{ VERCEL_ENV: "preview", NODE_ENV: "production" }, "preview"],
    [{ VERCEL_ENV: "development", NODE_ENV: "development" }, "development"],
    [{ NODE_ENV: "development" }, "development"],
    [{ NODE_ENV: "production" }, "local"],
    [{ NODE_ENV: "test" }, "local"],
    [{}, "local"],
  ])("%o is %s", (env, expected) => {
    expect(environmentFrom(env)).toBe(expected)
  })
})

describe("the production script rule", () => {
  const policy = applicationPolicy({ ...input("production"), nonce: "abc123" })
  const script = directives(policy).get("script-src")!

  it("is this origin and this request's nonce, nothing else", () => {
    expect(script).toEqual(["'self'", "'nonce-abc123'"])
  })

  it("never contains unsafe-inline or unsafe-eval", () => {
    expect(policy).not.toContain("'unsafe-eval'")
    expect(script).not.toContain("'unsafe-inline'")
    // Styles are the one place inline is allowed, and it must stay there.
    expect(directives(policy).get("style-src")).toContain("'unsafe-inline'")
  })

  it("forbids framing, plugins and foreign form targets", () => {
    const d = directives(policy)
    expect(d.get("frame-ancestors")).toEqual(["'none'"])
    expect(d.get("object-src")).toEqual(["'none'"])
    expect(d.get("form-action")).toEqual(["'self'"])
    expect(d.get("base-uri")).toEqual(["'self'"])
    expect(d.get("default-src")).toEqual(["'self'"])
    expect(d.has("upgrade-insecure-requests")).toBe(true)
  })

  it("admits the Supabase origin for uploads, auth and image previews, and no other origin", () => {
    const d = directives(policy)
    expect(d.get("connect-src")).toContain(SUPABASE)
    expect(d.get("img-src")).toContain(SUPABASE)
    expect(admittedOrigins(policy)).toEqual(new Set([SUPABASE]))
  })

  it("carries a fresh nonce per call", () => {
    const a = createNonce()
    const b = createNonce()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/)
  })
})

describe("the other environments", () => {
  it("development admits unsafe-eval for React's debugging and the dev socket, and nothing external", () => {
    const policy = applicationPolicy({ ...input("development"), nonce: "n" })
    expect(directives(policy).get("script-src")).toEqual(["'self'", "'nonce-n'", "'unsafe-eval'"])
    expect(directives(policy).get("connect-src")).toEqual(
      expect.arrayContaining(["'self'", SUPABASE, "ws:", "wss:"]),
    )
    expect(directives(policy).has("upgrade-insecure-requests")).toBe(false)
    expect(admittedOrigins(policy)).toEqual(new Set([SUPABASE]))
  })

  it("preview admits Vercel's toolbar and still no unsafe-inline or unsafe-eval for scripts", () => {
    const policy = applicationPolicy({ ...input("preview"), nonce: "n" })
    const script = directives(policy).get("script-src")!
    expect(script).toEqual(["'self'", "'nonce-n'", "https://vercel.live"])
    expect(policy).not.toContain("'unsafe-eval'")
    expect(directives(policy).get("frame-src")).toEqual(["https://vercel.live"])
    expect(admittedOrigins(policy)).toEqual(
      new Set([
        SUPABASE,
        "https://vercel.live",
        "https://vercel.com",
        "https://assets.vercel.com",
        "wss://ws-us3.pusher.com",
      ]),
    )
  })

  it("a local production build is the production policy without the https-only parts", () => {
    const policy = applicationPolicy({ ...input("local"), nonce: "n" })
    expect(directives(policy).get("script-src")).toEqual(["'self'", "'nonce-n'"])
    expect(directives(policy).has("upgrade-insecure-requests")).toBe(false)
    expect(baselineHeaders("local").map((h) => h.key)).not.toContain("Strict-Transport-Security")
  })
})

describe("the marketing routes", () => {
  it("are exactly the routes the last build prerendered, when a build is present", () => {
    const manifest = join(ROOT, ".next", "prerender-manifest.json")
    if (!existsSync(manifest)) return
    const routes = Object.keys(
      (JSON.parse(readFileSync(manifest, "utf8")) as { routes: Record<string, unknown> }).routes,
    )
      .filter((route) => !route.startsWith("/_"))
      .sort()
    expect(routes).toEqual([...STATIC_MARKETING_ROUTES].sort())
  })

  it("are matched with or without a trailing slash, and nothing dynamic is", () => {
    expect(isStaticMarketingRoute("/terms")).toBe(true)
    expect(isStaticMarketingRoute("/terms/")).toBe(true)
    expect(isStaticMarketingRoute("/")).toBe(false)
    expect(isStaticMarketingRoute("/sign-in")).toBe(false)
    expect(isStaticMarketingRoute("/pricing/plans")).toBe(false)
    expect(isStaticMarketingRoute("/best-night")).toBe(false)
  })

  it("get every restriction but a script one, and no default-src that would stand in for it", () => {
    const d = directives(marketingPolicy(input("production")))
    expect(d.has("script-src")).toBe(false)
    expect(d.has("default-src")).toBe(false)
    expect(d.get("frame-ancestors")).toEqual(["'none'"])
    expect(d.get("object-src")).toEqual(["'none'"])
    expect(d.get("form-action")).toEqual(["'self'"])
    expect(d.get("img-src")).toContain(SUPABASE)
  })

  it("get the strict policy in report-only form, with a report target when there is a DSN", () => {
    const withReports = directives(
      marketingReportOnlyPolicy({
        ...input("production"),
        reportUri: "https://o1.ingest.sentry.io/api/2/security/?sentry_key=k",
      }),
    )
    expect(withReports.get("script-src")).toEqual(["'self'"])
    expect(withReports.get("default-src")).toEqual(["'self'"])
    expect(withReports.get("report-uri")).toEqual([
      "https://o1.ingest.sentry.io/api/2/security/?sentry_key=k",
    ])
    const without = directives(marketingReportOnlyPolicy(input("production")))
    expect(without.has("report-uri")).toBe(false)
  })

  it("derives the report target from the Sentry DSN and refuses a malformed one", () => {
    expect(cspReportUri("https://abc123@o456.ingest.sentry.io/789")).toBe(
      "https://o456.ingest.sentry.io/api/789/security/?sentry_key=abc123",
    )
    expect(cspReportUri("")).toBeNull()
    expect(cspReportUri(undefined)).toBeNull()
    expect(cspReportUri("not a dsn")).toBeNull()
    expect(cspReportUri("https://o456.ingest.sentry.io/789")).toBeNull()
  })
})

describe("the headers next.config.ts configures", () => {
  async function configured(env: Record<string, string>): Promise<Map<string, string>> {
    process.env = { ...originalEnv, ...env }
    const rules = await config.headers!()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.source).toBe("/(.*)")
    return new Map(rules[0]!.headers.map((h) => [h.key, h.value]))
  }

  it("apply nosniff, a referrer policy, a permissions policy and anti-framing everywhere", async () => {
    const headers = await configured({ VERCEL_ENV: "preview" })
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin")
    expect(headers.get("Permissions-Policy")).toContain("camera=()")
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()")
    expect(headers.get("X-Frame-Options")).toBe("DENY")
    expect(headers.has("Content-Security-Policy")).toBe(false)
  })

  it("send HSTS in production only", async () => {
    expect((await configured({ VERCEL_ENV: "production" })).get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    )
    expect((await configured({ VERCEL_ENV: "preview" })).has("Strict-Transport-Security")).toBe(
      false,
    )
    expect((await configured({ NODE_ENV: "production" })).has("Strict-Transport-Security")).toBe(
      false,
    )
  })
})

describe("the theme initialiser", () => {
  it("is an external file that reads the same storage key and legacy values as the toggle", () => {
    const script = readFileSync(join(ROOT, "public", "theme.js"), "utf8")
    expect(script).toContain(`localStorage.getItem("${THEME_KEY}")`)
    for (const legacy of ['"flip"', '"base"']) expect(script).toContain(legacy)
    expect(script).toContain("document.documentElement.dataset.theme")
  })

  it("is loaded by the root layout as a same-origin script, and nothing inline remains", () => {
    const layout = readFileSync(join(ROOT, "app", "layout.tsx"), "utf8")
    expect(layout).toContain('<script src="/theme.js" />')
    expect(layout).not.toContain("dangerouslySetInnerHTML")
    const toggle = readFileSync(join(ROOT, "components", "ui", "theme-toggle.tsx"), "utf8")
    expect(toggle).not.toContain("dangerouslySetInnerHTML")
  })
})
