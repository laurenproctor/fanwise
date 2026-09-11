import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  etsyOAuth,
  parseShopHint,
  refreshAccessToken,
  userIdFromToken,
} from "@/lib/channels/adapters/etsy/oauth"
import { resetConfigCacheForTests } from "@/lib/channels/adapters/etsy/config"
import { codeChallenge, generateCodeVerifier } from "@/lib/channels/pkce"

/**
 * Etsy authorization: OAuth 2.0 with PKCE. The verifier never reaches the
 * browser; the challenge in the URL and the verifier at the exchange are one
 * pair minted by the shared flow, and the exchange is the check that matters.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  process.env.ETSY_CLIENT_ID = "keystring-test"
  process.env.ETSY_CLIENT_SECRET = "secret-test"
  resetConfigCacheForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("PKCE", () => {
  it("mints a base64url verifier and its S256 challenge", () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(codeChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(codeChallenge(verifier)).not.toBe(verifier)
  })
})

describe("shop hint", () => {
  it("takes a name or the name out of a pasted shop URL", () => {
    expect(parseShopHint("AsterType")).toEqual({ ok: true, value: "AsterType" })
    expect(parseShopHint("https://www.etsy.com/shop/AsterType?ref=x")).toEqual({
      ok: true,
      value: "AsterType",
    })
    expect(parseShopHint("   ").ok).toBe(false)
  })
})

describe("the authorize URL", () => {
  it("carries the keystring, the scopes, the state and the challenge", () => {
    const url = new URL(
      etsyOAuth.authorizeUrl({
        state: "state-1",
        accountHint: "AsterType",
        redirectUri: "https://app.example/api/channels/x/oauth/callback",
        grantUri: "https://app.example/api/channels/x/oauth/grant",
        codeChallenge: "challenge-1",
      }),
    )
    expect(url.origin + url.pathname).toBe("https://www.etsy.com/oauth/connect")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe("keystring-test")
    expect(url.searchParams.get("scope")).toBe("listings_r listings_w listings_d shops_r")
    expect(url.searchParams.get("state")).toBe("state-1")
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    // The shared secret is not in the flow.
    expect(url.toString()).not.toContain("secret-test")
  })

  it("refuses to build one without a challenge", () => {
    expect(() =>
      etsyOAuth.authorizeUrl({
        state: "s",
        accountHint: "a",
        redirectUri: "https://app.example/cb",
        grantUri: "https://app.example/grant",
      }),
    ).toThrow()
  })
})

describe("the callback", () => {
  it("is accepted with a code and a state, and refused on a provider error", () => {
    expect(etsyOAuth.verifyCallback(new URLSearchParams({ code: "c", state: "s" }))).toBe(true)
    expect(etsyOAuth.verifyCallback(new URLSearchParams({ state: "s" }))).toBe(false)
    expect(
      etsyOAuth.verifyCallback(
        new URLSearchParams({ code: "c", state: "s", error: "access_denied" }),
      ),
    ).toBe(false)
  })
})

describe("the exchange", () => {
  it("presents the verifier, then reads the shop, and seals the pair with its expiry", async () => {
    const calls: {
      url: string
      body: string | null
      auth: string | undefined
      key: string | undefined
    }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        const headers = init?.headers as Record<string, string>
        calls.push({
          url,
          body: init?.body ? String(init.body) : null,
          auth: headers?.Authorization,
          key: headers?.["x-api-key"],
        })
        if (url.endsWith("/public/oauth/token")) {
          return json({
            access_token: "12345.tok",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "12345.ref",
          })
        }
        if (url.endsWith("/users/me")) return json({ user_id: 12345, shop_id: 777 })
        if (url.endsWith("/shops/777"))
          return json({
            shop_id: 777,
            shop_name: "AsterType",
            currency_code: "USD",
            url: "https://www.etsy.com/shop/AsterType",
          })
        return json({ error: "no route" }, 404)
      }),
    )

    const grant = await etsyOAuth.exchange({
      accountHint: "AsterType",
      query: new URLSearchParams({ code: "code-1", state: "s" }),
      redirectUri: "https://app.example/cb",
      codeVerifier: "verifier-1",
    })

    const token = calls[0]!
    expect(token.url).toBe("https://api.etsy.com/v3/public/oauth/token")
    expect(token.body).toContain("grant_type=authorization_code")
    expect(token.body).toContain("code_verifier=verifier-1")
    expect(token.body).toContain("client_id=keystring-test")
    expect(token.body).not.toContain("secret-test")
    expect(token.key).toBe("keystring-test:secret-test")
    expect(calls[1]!.auth).toBe("Bearer 12345.tok")

    expect(grant.externalAccountId).toBe("777")
    expect(grant.externalAccountName).toBe("AsterType")
    expect(grant.metadata).toEqual({
      currencyCode: "USD",
      shopUrl: "https://www.etsy.com/shop/AsterType",
    })
    expect(grant.credentials).toMatchObject({
      accessToken: "12345.tok",
      refreshToken: "12345.ref",
      shopId: 777,
      userId: 12345,
    })
    expect(typeof (grant.credentials as { expiresAt: string }).expiresAt).toBe("string")
    expect(grant.expiresAt).not.toBeNull()
  })

  it("refuses an account with no shop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith("/public/oauth/token"))
          return json({ access_token: "1.t", expires_in: 3600, refresh_token: "1.r" })
        return json({ user_id: 1, shop_id: null })
      }),
    )
    await expect(
      etsyOAuth.exchange({
        accountHint: "x",
        query: new URLSearchParams({ code: "c", state: "s" }),
        redirectUri: "https://app.example/cb",
        codeVerifier: "v",
      }),
    ).rejects.toMatchObject({ normalized: { code: "permission_denied" } })
  })

  it("refreshes with the refresh token and returns the rotated pair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        expect(String(init?.body)).toContain("grant_type=refresh_token")
        expect(String(init?.body)).toContain("refresh_token=old")
        return json({ access_token: "1.new", expires_in: 3600, refresh_token: "1.newref" })
      }),
    )
    const fresh = await refreshAccessToken("old")
    expect(fresh.accessToken).toBe("1.new")
    expect(fresh.refreshToken).toBe("1.newref")
    expect(new Date(fresh.expiresAt).getTime()).toBeGreaterThan(Date.now() + 3_000_000)
  })

  it("reads the user id off the token prefix", () => {
    expect(userIdFromToken("12345.abc")).toBe(12345)
    expect(userIdFromToken("abc")).toBeNull()
  })
})
