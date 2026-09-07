import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { parseShopDomain, verifyCallbackHmac } from "@/lib/channels/adapters/shopify/oauth"

/**
 * Shopify authorization.
 *
 * Two things are being protected. The shop domain becomes a hostname Fanwise
 * redirects a person to and then posts a client secret to, so it is validated
 * rather than trusted. The callback HMAC is the only proof that a callback came
 * from Shopify at all, and it is checked before any parameter in the URL is
 * used for anything.
 */

const SECRET = "test-client-secret"

function sign(params: Record<string, string>, secret = SECRET): URLSearchParams {
  const message = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")

  const query = new URLSearchParams(params)
  query.set("hmac", createHmac("sha256", secret).update(message, "utf8").digest("hex"))
  return query
}

const CALLBACK = {
  code: "abc123",
  shop: "aster-type.myshopify.com",
  state: "state-token",
  timestamp: "1757000000",
}

describe("shop domain parsing", () => {
  it("accepts a plain myshopify domain", () => {
    expect(parseShopDomain("aster-type.myshopify.com")).toEqual({
      ok: true,
      value: "aster-type.myshopify.com",
    })
  })

  it("completes a bare store handle, which is what the placeholder invites", () => {
    expect(parseShopDomain("aster-type")).toEqual({
      ok: true,
      value: "aster-type.myshopify.com",
    })
  })

  it("normalizes the admin URL a creator will paste instead of typing a domain", () => {
    expect(parseShopDomain("https://aster-type.myshopify.com/admin/products")).toEqual({
      ok: true,
      value: "aster-type.myshopify.com",
    })
  })

  it("normalizes case and surrounding whitespace", () => {
    expect(parseShopDomain("  ASTER-TYPE.myshopify.com  ")).toEqual({
      ok: true,
      value: "aster-type.myshopify.com",
    })
  })

  it.each([
    ["an unrelated host", "evil.example.com"],
    ["a lookalike suffix", "aster-type.myshopify.com.evil.com"],
    ["a subdomain prefix trick", "myshopify.com.evil.com"],
    ["an empty value", ""],
    ["a path traversal attempt", "../../etc/passwd"],
    ["an embedded credential", "user:pass@aster.myshopify.com"],
  ])("refuses %s", (_label, input) => {
    const result = parseShopDomain(input)
    expect(result.ok).toBe(false)
  })

  it("refuses rather than silently trimming a host it does not recognize", () => {
    const result = parseShopDomain("evil.example.com")
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).toContain("myshopify.com")
  })
})

describe("callback HMAC", () => {
  it("accepts a correctly signed callback", () => {
    expect(verifyCallbackHmac(sign(CALLBACK), SECRET)).toBe(true)
  })

  it("rejects a callback with no hmac at all", () => {
    const query = new URLSearchParams(CALLBACK)
    expect(verifyCallbackHmac(query, SECRET)).toBe(false)
  })

  it("rejects a callback signed with the wrong secret", () => {
    expect(verifyCallbackHmac(sign(CALLBACK, "not-the-secret"), SECRET)).toBe(false)
  })

  it("rejects a callback whose parameters were changed after signing", () => {
    // The attack this stops: take a real callback and point it at another shop.
    const query = sign(CALLBACK)
    query.set("shop", "attacker.myshopify.com")
    expect(verifyCallbackHmac(query, SECRET)).toBe(false)
  })

  it("rejects an added parameter", () => {
    const query = sign(CALLBACK)
    query.set("extra", "1")
    expect(verifyCallbackHmac(query, SECRET)).toBe(false)
  })

  it("rejects an hmac of the wrong length without throwing", () => {
    // timingSafeEqual raises on a length mismatch, so this must be answered
    // before the comparison rather than by it.
    const query = new URLSearchParams(CALLBACK)
    query.set("hmac", "abcd")
    expect(() => verifyCallbackHmac(query, SECRET)).not.toThrow()
    expect(verifyCallbackHmac(query, SECRET)).toBe(false)
  })

  it("rejects an hmac that is not hex", () => {
    const query = new URLSearchParams(CALLBACK)
    query.set("hmac", "zzzz")
    expect(verifyCallbackHmac(query, SECRET)).toBe(false)
  })

  it("verifies independently of parameter order in the URL", () => {
    const signed = sign(CALLBACK)
    const reordered = new URLSearchParams()
    reordered.set("hmac", signed.get("hmac")!)
    reordered.set("timestamp", CALLBACK.timestamp)
    reordered.set("shop", CALLBACK.shop)
    reordered.set("state", CALLBACK.state)
    reordered.set("code", CALLBACK.code)
    expect(verifyCallbackHmac(reordered, SECRET)).toBe(true)
  })
})
