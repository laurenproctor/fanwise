import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const credentialsMock = vi.hoisted(() => ({
  read: vi.fn(),
}))
vi.mock("@/lib/credentials", () => ({
  readConnectionCredentials: credentialsMock.read,
  storeConnectionCredentials: vi.fn(async () => {}),
}))

import {
  gumroadOAuth,
  parseUsernameHint,
  revokeAccessToken,
} from "@/lib/channels/adapters/gumroad/oauth"
import { resetConfigCacheForTests } from "@/lib/channels/adapters/gumroad/config"

/**
 * Gumroad authorization: OAuth 2.0 with PKCE, a token that never expires, and
 * a revoke on disconnect because nothing else would ever end it. The verifier
 * never reaches the browser; the challenge in the URL and the verifier at the
 * exchange are one pair minted by the shared flow.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  process.env.GUMROAD_CLIENT_ID = "app-id-test"
  process.env.GUMROAD_CLIENT_SECRET = "app-secret-test"
  resetConfigCacheForTests()
  credentialsMock.read.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("username hint", () => {
  it("takes a username, or the username out of either store address", () => {
    expect(parseUsernameHint("astertype")).toEqual({ ok: true, value: "astertype" })
    expect(parseUsernameHint("@astertype")).toEqual({ ok: true, value: "astertype" })
    expect(parseUsernameHint("https://astertype.gumroad.com/l/aster")).toEqual({
      ok: true,
      value: "astertype",
    })
    expect(parseUsernameHint("https://gumroad.com/astertype?ref=x")).toEqual({
      ok: true,
      value: "astertype",
    })
    expect(parseUsernameHint("   ").ok).toBe(false)
  })
})

describe("the authorize URL", () => {
  it("carries the application id, the one scope, the state and the challenge", () => {
    const url = new URL(
      gumroadOAuth.authorizeUrl({
        state: "state-1",
        accountHint: "astertype",
        redirectUri: "https://app.example/api/channels/x/oauth/callback",
        grantUri: "https://app.example/api/channels/x/oauth/grant",
        codeChallenge: "challenge-1",
      }),
    )
    expect(url.origin + url.pathname).toBe("https://gumroad.com/oauth/authorize")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe("app-id-test")
    expect(url.searchParams.get("scope")).toBe("edit_products")
    expect(url.searchParams.get("state")).toBe("state-1")
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.toString()).not.toContain("app-secret-test")
  })

  it("refuses to build one without a challenge", () => {
    expect(() =>
      gumroadOAuth.authorizeUrl({
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
    expect(gumroadOAuth.verifyCallback(new URLSearchParams({ code: "c", state: "s" }))).toBe(true)
    expect(gumroadOAuth.verifyCallback(new URLSearchParams({ state: "s" }))).toBe(false)
    expect(
      gumroadOAuth.verifyCallback(
        new URLSearchParams({ code: "c", state: "s", error: "access_denied" }),
      ),
    ).toBe(false)
  })
})

describe("the exchange", () => {
  it("presents the verifier and the secret, reads the user, and seals a token with no expiry", async () => {
    const calls: { url: string; body: string | null; auth: string | undefined }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        const headers = init?.headers as Record<string, string>
        calls.push({
          url,
          body: init?.body ? String(init.body) : null,
          auth: headers?.Authorization,
        })
        if (url === "https://api.gumroad.com/oauth/token") {
          return json({ access_token: "tok-1", refresh_token: "ref-1", token_type: "Bearer" })
        }
        if (url === "https://api.gumroad.com/v2/user") {
          return json({
            success: true,
            user: {
              user_id: "G_-mnBf9b1j9A7a4ub4nFQ==",
              name: "Aster Type",
              url: "https://gumroad.com/astertype",
            },
          })
        }
        return json({ success: false, message: "no route" }, 404)
      }),
    )

    const grant = await gumroadOAuth.exchange({
      accountHint: "astertype",
      query: new URLSearchParams({ code: "code-1", state: "s" }),
      redirectUri: "https://app.example/cb",
      codeVerifier: "verifier-1",
    })

    const token = calls[0]!
    expect(token.body).toContain("grant_type=authorization_code")
    expect(token.body).toContain("code_verifier=verifier-1")
    expect(token.body).toContain("client_id=app-id-test")
    expect(token.body).toContain("client_secret=app-secret-test")
    expect(token.body).toContain("code=code-1")
    expect(calls[1]!.auth).toBe("Bearer tok-1")

    expect(grant.externalAccountId).toBe("G_-mnBf9b1j9A7a4ub4nFQ==")
    expect(grant.externalAccountName).toBe("Aster Type")
    expect(grant.scopes).toEqual(["edit_products"])
    expect(grant.expiresAt).toBeNull()
    expect(grant.credentials).toEqual({ accessToken: "tok-1", refreshToken: "ref-1" })
    expect(grant.metadata).toEqual({ profileUrl: "https://gumroad.com/astertype" })
  })

  it("refuses when Gumroad answers the user read with success false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith("/oauth/token")) return json({ access_token: "t" })
        return json({ success: false, message: "The user was not found." })
      }),
    )
    await expect(
      gumroadOAuth.exchange({
        accountHint: "x",
        query: new URLSearchParams({ code: "c", state: "s" }),
        redirectUri: "https://app.example/cb",
        codeVerifier: "v",
      }),
    ).rejects.toMatchObject({ normalized: { code: "validation_rejected" } })
  })
})

describe("revoke", () => {
  it("posts the token with the application's id and secret", async () => {
    let body: string | null = null
    let url = ""
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        url = String(input)
        body = init?.body ? String(init.body) : null
        return json({})
      }),
    )
    await revokeAccessToken("tok-1")
    expect(url).toBe("https://api.gumroad.com/oauth/revoke")
    expect(body).toContain("token=tok-1")
    expect(body).toContain("client_id=app-id-test")
    expect(body).toContain("client_secret=app-secret-test")
  })

  it("reads the sealed credential itself and does nothing when there is none", async () => {
    const fetchMock = vi.fn(async () => json({}))
    vi.stubGlobal("fetch", fetchMock)

    credentialsMock.read.mockResolvedValueOnce(null)
    await gumroadOAuth.revoke!({ workspaceId: "w", connectionId: "c" })
    expect(fetchMock).not.toHaveBeenCalled()

    credentialsMock.read.mockResolvedValueOnce({ accessToken: "tok-2", refreshToken: null })
    await gumroadOAuth.revoke!({ workspaceId: "w", connectionId: "c" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(credentialsMock.read).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "w", connectionId: "c" }),
    )
  })
})
