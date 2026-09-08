import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import type { ChannelOAuth, OAuthAuthorizeRequest, OAuthGrant } from "@/lib/channels/types"
import { createEtsyClient } from "./client"
import { AUTHORIZE_URL, SCOPES, TOKEN_URL, apiKeyHeader, etsyConfig } from "./config"

/**
 * Etsy authorization: OAuth 2.0 authorization code with PKCE.
 *
 * The shared flow mints the verifier and keeps it on the state row; this
 * module puts the challenge in the URL and the verifier in the exchange. The
 * shared secret is never sent here — Etsy's flow needs only the keystring —
 * but every API call afterwards carries both in the key header.
 *
 * Tokens expire in an hour and the refresh token in ninety days, so the
 * credential Fanwise seals is the pair plus the expiry, and the adapter
 * refreshes before a call when the hour is nearly up. A shop untouched for
 * ninety days has to be reconnected, which is Etsy's rule and not ours.
 *
 * The account hint is the shop name as the creator knows it, used only to
 * label the field: Etsy's flow identifies the shop from the token, and the
 * connection records what the API says rather than what was typed.
 */

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
})

const meSchema = z.object({
  user_id: z.number(),
  shop_id: z.number().nullish(),
})

const shopSchema = z.object({
  shop_id: z.number(),
  shop_name: z.string(),
  currency_code: z.string().nullish(),
  url: z.string().nullish(),
})

export const etsyCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** ISO time the access token stops working. */
  expiresAt: z.string().min(1),
  shopId: z.number(),
  userId: z.number(),
})

export type EtsyCredentials = z.infer<typeof etsyCredentialsSchema>

/** Etsy access tokens are `<user_id>.<token>`; the prefix is the user. */
export function userIdFromToken(token: string): number | null {
  const prefix = token.split(".")[0]
  const id = Number(prefix)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function parseShopHint(
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim()
  if (value.length === 0 || value.length > 100) {
    return {
      ok: false,
      message: "Enter your Etsy shop name. It is in your shop's address after etsy.com/shop/.",
    }
  }
  // A pasted shop URL is the common case, and the name is its last segment.
  const match = /etsy\.com\/shop\/([^/?#]+)/i.exec(value)
  return { ok: true, value: match ? match[1]! : value.replace(/^@/, "") }
}

async function tokenRequest(
  form: Record<string, string>,
  fetchImpl?: typeof fetch,
): Promise<z.infer<typeof tokenResponseSchema>> {
  const client = createEtsyClient({ apiKey: apiKeyHeader(), ...(fetchImpl ? { fetchImpl } : {}) })
  return client.request({
    method: "POST",
    path: TOKEN_URL,
    body: { kind: "form", value: form },
    schema: tokenResponseSchema,
  })
}

/** A fresh access token from the refresh token. The refresh token rotates. */
export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl?: typeof fetch,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const { clientId } = etsyConfig()
  const token = await tokenRequest(
    { grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken },
    fetchImpl,
  )
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
  }
}

export const etsyOAuth: ChannelOAuth = {
  scopes: SCOPES,
  pkce: true,
  accountHintLabel: "Your Etsy shop name",
  accountHintPlaceholder: "AsterTypeFoundry",

  parseAccountHint: parseShopHint,

  authorizeUrl({ state, redirectUri, codeChallenge }: OAuthAuthorizeRequest): string {
    const { clientId } = etsyConfig()
    if (!codeChallenge)
      throw new Error("refusing to build an authorize URL without a PKCE challenge")
    const url = new URL(AUTHORIZE_URL)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("scope", SCOPES.join(" "))
    url.searchParams.set("state", state)
    url.searchParams.set("code_challenge", codeChallenge)
    url.searchParams.set("code_challenge_method", "S256")
    return url.toString()
  },

  /**
   * The return carries no signature. What can be checked is that Etsy did not
   * report an error and that a code and a state are present; the code is
   * worthless without the verifier on the state row, which is the check that
   * matters, and it happens at the exchange.
   */
  verifyCallback(query: URLSearchParams): boolean {
    if (query.get("error")) return false
    return Boolean(query.get("code") && query.get("state"))
  },

  async exchange({ query, redirectUri, codeVerifier }): Promise<OAuthGrant> {
    const code = query.get("code")
    if (!code || !codeVerifier) {
      throw new ChannelError(
        normalized(
          "unknown",
          "Etsy did not return an authorization code. Try connecting the shop again.",
        ),
      )
    }
    const { clientId } = etsyConfig()
    const token = await tokenRequest({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    })

    const client = createEtsyClient({ apiKey: apiKeyHeader(), accessToken: token.access_token })
    const me = await client.request({
      method: "GET",
      path: "application/users/me",
      schema: meSchema,
    })
    if (!me.shop_id) {
      throw new ChannelError(
        normalized(
          "permission_denied",
          "That Etsy account has no shop. Open a shop on Etsy first, then connect it.",
        ),
      )
    }
    const shop = await client.request({
      method: "GET",
      path: `application/shops/${me.shop_id}`,
      schema: shopSchema,
    })

    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString()
    return {
      externalAccountId: String(shop.shop_id),
      externalAccountName: shop.shop_name,
      scopes: [...SCOPES],
      // The refresh token is what expires, in ninety days; the access token's
      // hour is the adapter's business and recorded in the credential.
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        shopId: shop.shop_id,
        userId: me.user_id,
      } satisfies EtsyCredentials,
      metadata: {
        currencyCode: shop.currency_code ?? null,
        shopUrl: shop.url ?? null,
      },
    }
  },
}
