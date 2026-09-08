import { describe, expect, it, vi } from "vitest"
import { woocommerceGrant, woocommerceOAuth } from "@/lib/channels/adapters/woocommerce/oauth"
import { parseStoreUrl } from "@/lib/channels/adapters/woocommerce/transform"
import { ChannelError } from "@/lib/channels/errors"

/**
 * WooCommerce authorization.
 *
 * The store address becomes a hostname Fanwise redirects a person to and then
 * sends their keys to, so it is validated rather than trusted. The grant the
 * store posts is the only secret in the flow, and it is proven against the
 * store the creator named before it is stored.
 */

describe("store address parsing", () => {
  it("accepts a bare domain and assumes https", () => {
    expect(parseStoreUrl("shop.example.com")).toEqual({ ok: true, value: "shop.example.com" })
  })

  it("normalizes a pasted admin or product URL to the store", () => {
    expect(parseStoreUrl("https://Shop.Example.com/wp-admin/edit.php")).toEqual({
      ok: true,
      value: "shop.example.com",
    })
    expect(parseStoreUrl("https://example.com/store/product/aster/")).toEqual({
      ok: true,
      value: "example.com/store",
    })
  })

  it("refuses plain http, because the keys travel in every request", () => {
    const result = parseStoreUrl("http://shop.example.com")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("https")
  })

  it("refuses a host it cannot recognise", () => {
    expect(parseStoreUrl("localhost").ok).toBe(false)
    expect(parseStoreUrl("not a url").ok).toBe(false)
    expect(parseStoreUrl("https://user:pw@shop.example.com").ok).toBe(false)
  })
})

describe("the authorize URL", () => {
  it("sends the creator to their own store with the state as the reference", () => {
    const url = new URL(
      woocommerceOAuth.authorizeUrl({
        state: "state-token-abcdefghijklmnop",
        accountHint: "shop.example.com",
        redirectUri: "https://app.example/api/channels/x/oauth/callback",
        grantUri: "https://app.example/api/channels/x/oauth/grant",
      }),
    )
    expect(url.origin + url.pathname).toBe("https://shop.example.com/wc-auth/v1/authorize")
    expect(url.searchParams.get("app_name")).toBe("Fanwise")
    expect(url.searchParams.get("scope")).toBe("read_write")
    expect(url.searchParams.get("user_id")).toBe("state-token-abcdefghijklmnop")
    expect(url.searchParams.get("callback_url")).toBe(
      "https://app.example/api/channels/x/oauth/grant",
    )
    const returnUrl = new URL(url.searchParams.get("return_url")!)
    expect(returnUrl.searchParams.get("state")).toBe("state-token-abcdefghijklmnop")
  })
})

describe("the browser's return", () => {
  const ok = new URLSearchParams({ state: "s1", user_id: "s1", success: "1" })
  it("is accepted when the store said yes and named the same state", () => {
    expect(woocommerceOAuth.verifyCallback(ok)).toBe(true)
  })
  it("is refused when the store said no", () => {
    expect(
      woocommerceOAuth.verifyCallback(
        new URLSearchParams({ state: "s1", user_id: "s1", success: "0" }),
      ),
    ).toBe(false)
  })
  it("is refused when the reference does not match the state", () => {
    expect(
      woocommerceOAuth.verifyCallback(
        new URLSearchParams({ state: "s1", user_id: "s2", success: "1" }),
      ),
    ).toBe(false)
  })
})

describe("the posted grant", () => {
  const body = {
    key_id: 7,
    user_id: "state-token-abcdefghijklmnop",
    consumer_key: "ck_test",
    consumer_secret: "cs_test",
    key_permissions: "read_write",
  }

  it("parses a well-formed grant into state, credentials and scopes", () => {
    expect(woocommerceGrant.parse(body)).toEqual({
      state: "state-token-abcdefghijklmnop",
      credentials: { consumerKey: "ck_test", consumerSecret: "cs_test" },
      scopes: ["read_write"],
    })
  })

  it("returns null rather than throwing on a stranger's body", () => {
    expect(woocommerceGrant.parse(null)).toBeNull()
    expect(woocommerceGrant.parse({ user_id: "x" })).toBeNull()
    expect(woocommerceGrant.parse({ ...body, key_permissions: "admin" })).toBeNull()
  })

  it("proves the keys against the named store and reads its currency", async () => {
    const calls: { url: string; auth: string | undefined }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization })
        if (url.endsWith("/settings/general")) {
          return new Response(JSON.stringify([{ id: "woocommerce_currency", value: "eur" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response(
          JSON.stringify({ name: "Aster Type", url: "https://shop.example.com" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        )
      }),
    )
    try {
      const grant = await woocommerceGrant.verify({
        accountHint: "shop.example.com",
        credentials: { consumerKey: "ck_test", consumerSecret: "cs_test" },
        scopes: ["read_write"],
      })
      expect(calls[0]!.url).toBe("https://shop.example.com/wp-json/wc/v3/settings/general")
      expect(calls[0]!.auth).toBe(`Basic ${Buffer.from("ck_test:cs_test").toString("base64")}`)
      expect(grant.externalAccountId).toBe("shop.example.com")
      expect(grant.externalAccountName).toBe("Aster Type")
      expect(grant.metadata).toEqual({ currency: "EUR" })
      expect(grant.expiresAt).toBeNull()
      expect(grant.credentials).toEqual({ consumerKey: "ck_test", consumerSecret: "cs_test" })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("refuses keys the store rejects, without repeating the store's words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "woocommerce_rest_cannot_view",
              message: "Sorry, you cannot list resources.",
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    )
    try {
      await expect(
        woocommerceGrant.verify({
          accountHint: "shop.example.com",
          credentials: { consumerKey: "ck_bad", consumerSecret: "cs_bad" },
          scopes: ["read_write"],
        }),
      ).rejects.toMatchObject({ normalized: { code: "credentials_invalid" } })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("refuses a read-only grant before touching the store", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    try {
      await expect(
        woocommerceGrant.verify({
          accountHint: "shop.example.com",
          credentials: { consumerKey: "ck", consumerSecret: "cs" },
          scopes: ["read"],
        }),
      ).rejects.toBeInstanceOf(ChannelError)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
