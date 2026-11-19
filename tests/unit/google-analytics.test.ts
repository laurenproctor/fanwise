import { describe, expect, it } from "vitest"
import { cleanAddress, eventName, gaMeasurementId } from "@/lib/analytics/ga"
import {
  applicationPolicy,
  marketingPolicy,
  marketingReportOnlyPolicy,
} from "@/lib/security/headers"

describe("the measurement ID", () => {
  it.each([
    ["G-ABC123DEF4", "G-ABC123DEF4"],
    ["  G-ABC123DEF4  ", "G-ABC123DEF4"],
    ["", null],
    [undefined, null],
    ["UA-12345-1", null],
    ["G-abc", null],
    ["G-ABC123'><script>", null],
  ])("%o reads as %o", (raw, expected) => {
    expect(gaMeasurementId(raw)).toBe(expected)
  })
})

describe("addresses sent to analytics", () => {
  it("drop the query string and the fragment", () => {
    expect(cleanAddress("https://fanwise.test/creators?q=secret+words&page=2#top")).toBe(
      "https://fanwise.test/creators",
    )
  })

  it("never carry an OAuth code or a sign-in token", () => {
    const cleaned = cleanAddress("https://fanwise.test/auth/confirm?token_hash=abc&code=xyz")
    expect(cleaned).toBe("https://fanwise.test/auth/confirm")
    expect(cleaned).not.toContain("abc")
    expect(cleaned).not.toContain("xyz")
  })

  it.each([[""], [undefined], ["not a url"], ["javascript:alert(1)"]])(
    "%o becomes an empty string",
    (raw) => {
      expect(cleanAddress(raw)).toBe("")
    },
  )
})

describe("event names", () => {
  it.each([
    ["Creator marketplace viewed", "creator_marketplace_viewed"],
    ["Product opened from creator marketplace", "product_opened_from_creator_marketplace"],
    ["Creator profile opened from creator marketplace", "creator_profile_opened_from_creator_mark"],
    ["Creator searched", "creator_searched"],
    ["  Creator filter applied!  ", "creator_filter_applied"],
    ["2 fast", "event_2_fast"],
  ])("%s becomes %s", (label, expected) => {
    const name = eventName(label)
    expect(name).toBe(expected)
    expect(name).toMatch(/^[a-z][a-z0-9_]{0,39}$/)
  })
})

describe("the policy names Google's hosts only when analytics is on", () => {
  const base = { environment: "production" as const, supabaseUrl: "https://abc.supabase.co" }
  const GOOGLE = /google|doubleclick/

  it("off: no policy names a Google host", () => {
    expect(applicationPolicy({ ...base, nonce: "n" })).not.toMatch(GOOGLE)
    expect(marketingPolicy(base)).not.toMatch(GOOGLE)
    expect(marketingReportOnlyPolicy(base)).not.toMatch(GOOGLE)
  })

  it("on: the application policy admits the tag and its collection hosts, and no ad host", () => {
    const policy = applicationPolicy({ ...base, analytics: true, nonce: "n" })
    expect(policy).toContain("script-src 'self' 'nonce-n' https://*.googletagmanager.com")
    expect(policy).toMatch(/connect-src [^;]*https:\/\/\*\.google-analytics\.com/)
    expect(policy).toMatch(/connect-src [^;]*https:\/\/\*\.analytics\.google\.com/)
    expect(policy).toMatch(/img-src [^;]*https:\/\/\*\.google-analytics\.com/)
    expect(policy).not.toContain("doubleclick")
    expect(policy).not.toContain("'unsafe-inline' https://*.googletagmanager.com")
    expect(policy).not.toMatch(/script-src [^;]*'unsafe-(inline|eval)'/)
  })

  it("on: the report-only marketing policy admits the tag too, so it is not counted as a violation", () => {
    expect(marketingReportOnlyPolicy({ ...base, analytics: true })).toContain(
      "script-src 'self' https://*.googletagmanager.com",
    )
  })
})
