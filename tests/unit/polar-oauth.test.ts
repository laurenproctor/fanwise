import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const credentialsMock = vi.hoisted(() => ({
  read: vi.fn(),
}))
vi.mock("@/lib/credentials", () => ({
  readConnectionCredentials: credentialsMock.read,
  storeConnectionCredentials: vi.fn(async () => {}),
}))

import {
  parseOrganizationHint,
  polarOAuth,
  refreshAccessToken,
  revokeToken,
} from "@/lib/channels/adapters/polar/oauth"
import { resetConfigCacheForTests } from "@/lib/channels/adapters/polar/config"

/**
 * Polar authorization: OpenID Connect with PKCE, a user-scoped token tied to
 * one organization by the slug the creator typed, a ten-day access token with
 * a refresh, and a revoke of both on disconnect. The verifier never reaches
 * the browser; the challenge in the URL and the verifier at the exchange are
 * one pair minted by the shared flow.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  process.env.POLAR_CLIENT_ID = "client-id-test"
  process.env.POLAR_CLIENT_SECRET = "client-secret-test"
  delete process.env.POLAR_ENVIRONMENT
  resetConfigCacheForTests()
  credentialsMock.read.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("organization hint", () => {
  it("takes a slug, or the slug out of a Polar address", () => {
    expect(parseOrganizationHint("astertype")).toEqual({ ok: true, value: "astertype" })
    expect(parseOrganizationHint("@AsterType")).toEqual({ ok: true, value: "astertype" })
    expect(parseOrganizationHint("https://polar.sh/astertype/")).toEqual({
      ok: true,
      value: "astertype",
    })
    expect(parseOrganizationHint("https://polar.sh/dashboard/astertype/products")).toEqual({
      ok: true,
      value: "astertype",
    })
    expect(parseOrganizationHint("   ").ok).toBe(false)
    expect(parseOrganizationHint("aster type").ok).toBe(false)
  })
})

describe("the authorize URL", () => {
  it("carries the client id, the seven scopes, the state and the challenge", () => {
    const url = new URL(
      polarOAuth.authorizeUrl({
        state: "state-1",
        accountHint: "astertype",
        redirectUri: "https://app.example/api/channels/x/oauth/callback",
        grantUri: "https://app.example/api/channels/x/oauth/grant",
        codeChallenge: "challenge-1",
      }),
    )
    expect(url.origin + url.pathname).toBe("https://polar.sh/oauth2/authorize")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe("client-id-test")
    expect(url.searchParams.get("scope")).toBe(
      "organizations:read products:read products:write files:write benefits:write checkout_links:read checkout_links:write",
    )
    expect(url.searchParams.get("state")).toBe("state-1")
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.toString()).not.toContain("client-secret-test")
  })

  it("points at the sandbox when the deployment says so", () => {
    process.env.POLAR_ENVIRONMENT = "sandbox"
    resetConfigCacheForTests()
    const url = new URL(
      polarOAuth.authorizeUrl({
        state: "s",
        accountHint: "a",
        redirectUri: "https://app.example/cb",
        grantUri: "https://app.example/grant",
        codeChallenge: "c",
      }),
    )
    expect(url.origin).toBe("https://sandbox.polar.sh")
  })

  it("refuses to build one without a challenge", () => {
    expect(() =>
      polarOAuth.authorizeUrl({
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
    expect(polarOAuth.verifyCallback(new URLSearchParams({ code: "c", state: "s" }))).toBe(true)
    expect(polarOAuth.verifyCallback(new URLSearchParams({ state: "s" }))).toBe(false)
    expect(
      polarOAuth.verifyCallback(
        new URLSearchParams({ code: "c", state: "s", error: "access_denied" }),
      ),
    ).toBe(false)
  })
})

const ORGANIZATIONS = {
  items: [
    {
      id: "org-1",
      name: "Aster Type",
      slug: "astertype",
      default_presentment_currency: "usd",
      status: "active",
    },
    { id: "org-2", name: "Side Project", slug: "side", default_presentment_currency: "eur" },
  ],
  pagination: { total_count: 2, max_page: 1 },
}

describe("the exchange", () => {
  it("presents the verifier and the secret, picks the named organization, and seals the pair with its expiry", async () => {
    const calls: { url: string; body: string | null; headers: Record<string, string> }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        calls.push({
          url,
          body: init?.body ? String(init.body) : null,
          headers: (init?.headers as Record<string, string>) ?? {},
        })
        if (url === "https://api.polar.sh/v1/oauth2/token") {
          return json({
            access_token: "polar_at_1",
            refresh_token: "polar_rt_1",
            token_type: "Bearer",
            expires_in: 864000,
            scope: "organizations:read products:write",
          })
        }
        if (url.startsWith("https://api.polar.sh/v1/organizations")) return json(ORGANIZATIONS)
        return json({ error: "ResourceNotFound", detail: "no route" }, 404)
      }),
    )

    const before = Date.now()
    const grant = await polarOAuth.exchange({
      accountHint: "astertype",
      query: new URLSearchParams({ code: "code-1", state: "s" }),
      redirectUri: "https://app.example/cb",
      codeVerifier: "verifier-1",
    })

    const token = calls[0]!
    expect(token.body).toContain("grant_type=authorization_code")
    expect(token.body).toContain("code_verifier=verifier-1")
    expect(token.body).toContain("client_id=client-id-test")
    expect(token.body).toContain("client_secret=client-secret-test")
    expect(token.body).toContain("code=code-1")
    expect(token.headers["Polar-Version"]).toBe("2026-04")
    expect(calls[1]!.headers.Authorization).toBe("Bearer polar_at_1")

    expect(grant.externalAccountId).toBe("org-1")
    expect(grant.externalAccountName).toBe("Aster Type")
    expect(grant.scopes).toHaveLength(7)
    expect(grant.expiresAt).toBeNull()
    expect(grant.credentials).toMatchObject({
      accessToken: "polar_at_1",
      refreshToken: "polar_rt_1",
    })
    const expiresAt = new Date(grant.credentials.expiresAt as string).getTime()
    expect(expiresAt - before).toBeGreaterThanOrEqual(864000 * 1000 - 1000)
    expect(expiresAt - before).toBeLessThanOrEqual(864000 * 1000 + 5000)
    expect(grant.metadata).toEqual({ slug: "astertype", currencyCode: "usd", status: "active" })
  })

  it("refuses when the named organization is not among the ones the token can reach", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith("/oauth2/token"))
          return json({ access_token: "t", expires_in: 100, scope: "", token_type: "Bearer" })
        return json(ORGANIZATIONS)
      }),
    )
    await expect(
      polarOAuth.exchange({
        accountHint: "someone-else",
        query: new URLSearchParams({ code: "c", state: "s" }),
        redirectUri: "https://app.example/cb",
        codeVerifier: "v",
      }),
    ).rejects.toMatchObject({
      normalized: {
        code: "permission_denied",
        message: expect.stringContaining("someone-else"),
        raw: { allowed: ["astertype", "side"] },
      },
    })
  })
})

describe("refresh", () => {
  it("presents the refresh token with the client's secret and keeps the old refresh token when none comes back", async () => {
    const bodies: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        bodies.push(String(init?.body))
        return json({
          access_token: "polar_at_2",
          token_type: "Bearer",
          expires_in: 864000,
          scope: "",
        })
      }),
    )
    const fresh = await refreshAccessToken("polar_rt_1")
    expect(bodies[0]).toContain("grant_type=refresh_token")
    expect(bodies[0]).toContain("refresh_token=polar_rt_1")
    expect(bodies[0]).toContain("client_secret=client-secret-test")
    expect(fresh).toMatchObject({ accessToken: "polar_at_2", refreshToken: "polar_rt_1" })
  })
})

describe("revoke", () => {
  it("posts the token with its hint and the client's id and secret", async () => {
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
    await revokeToken("polar_at_1", "access_token")
    expect(url).toBe("https://api.polar.sh/v1/oauth2/revoke")
    expect(body).toContain("token=polar_at_1")
    expect(body).toContain("token_type_hint=access_token")
    expect(body).toContain("client_id=client-id-test")
    expect(body).toContain("client_secret=client-secret-test")
  })

  it("reads the sealed credential itself, revokes both tokens, and does nothing when there is none", async () => {
    const fetchMock = vi.fn(async () => json({}))
    vi.stubGlobal("fetch", fetchMock)

    credentialsMock.read.mockResolvedValueOnce(null)
    await polarOAuth.revoke!({ workspaceId: "w", connectionId: "c" })
    expect(fetchMock).not.toHaveBeenCalled()

    credentialsMock.read.mockResolvedValueOnce({
      accessToken: "polar_at_2",
      refreshToken: "polar_rt_2",
      expiresAt: "2026-10-03T00:00:00.000Z",
    })
    await polarOAuth.revoke!({ workspaceId: "w", connectionId: "c" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(credentialsMock.read).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "w", connectionId: "c" }),
    )
  })
})
