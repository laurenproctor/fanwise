import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import type { ChannelOAuth, OAuthAuthorizeRequest, OAuthGrant } from "@/lib/channels/types"
import { createShopifyClient } from "./client"
import { SCOPES, shopifyConfig } from "./config"
import { fail, httpError, transportError } from "./errors"

/**
 * Shopify authorization.
 *
 * A shop domain is not a text field. It is a hostname Fanwise is about to
 * redirect a person to, and then send a client secret to, so it is validated
 * against a fixed pattern before it reaches a URL. A creator who types
 * `evil.example.com` gets a message, not a redirect.
 */

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

/** Parameters that are part of the signature's subject, never of the message. */
const SIGNATURE_PARAMS = new Set(["hmac", "signature"])

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  scope: z.string().default(""),
  /**
   * Present only for an online-access token. Fanwise asks for offline access,
   * which does not expire, because publishing happens in a background job long
   * after the creator has closed the tab.
   */
  expires_in: z.number().int().positive().optional(),
})

const shopQuerySchema = z.object({
  shop: z.object({
    name: z.string(),
    myshopifyDomain: z.string(),
    currencyCode: z.string(),
    ianaTimezone: z.string().nullish(),
  }),
})

const SHOP_QUERY = `
  query FanwiseShop {
    shop {
      name
      myshopifyDomain
      currencyCode
      ianaTimezone
    }
  }
`

export function parseShopDomain(
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  // A creator will paste a full admin URL as often as they will type a domain,
  // so the obvious shapes are accepted and normalized rather than rejected.
  let value = raw.trim().toLowerCase()
  value = value
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")

  // "my-store" alone is what the field's placeholder implies, so complete it.
  if (value.length > 0 && !value.includes(".")) value = `${value}.myshopify.com`

  if (!SHOP_DOMAIN.test(value)) {
    return {
      ok: false,
      message:
        "Enter your store's .myshopify.com domain, for example aster-type.myshopify.com. " +
        "You can find it in Shopify under Settings, Domains.",
    }
  }
  return { ok: true, value }
}

/**
 * Verifies the callback's HMAC.
 *
 * docs/security.md rule 5: signatures are verified before the payload is
 * parsed. Here that means before `code`, `shop` or `state` is read for anything
 * other than building the message, because an unverified callback is a string
 * an attacker chose.
 *
 * The message is every parameter except the signature itself, sorted
 * lexicographically by key and percent-encoded, which is the encoding Shopify's
 * own libraries produce.
 */
export function verifyCallbackHmac(query: URLSearchParams, clientSecret: string): boolean {
  const provided = query.get("hmac")
  if (!provided) return false

  const message = [...query.entries()]
    .filter(([key]) => !SIGNATURE_PARAMS.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")

  const expected = createHmac("sha256", clientSecret).update(message, "utf8").digest()
  const actual = Buffer.from(provided, "hex")

  // timingSafeEqual throws on a length mismatch, and a length mismatch is
  // already a failure, so it is answered before the comparison rather than by
  // it. Comparing lengths is not a timing leak: the length is public.
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

async function exchangeCode(params: {
  shopDomain: string
  code: string
}): Promise<z.infer<typeof tokenResponseSchema>> {
  const { clientId, clientSecret } = shopifyConfig()

  let response: Response
  try {
    response = await fetch(`https://${params.shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: params.code,
      }),
    })
  } catch (error) {
    fail(transportError(error))
  }

  if (!response.ok) {
    // The body of a failed token exchange is Shopify's, and the request that
    // produced it held a client secret. Only the status is kept.
    fail(httpError(response.status, { note: "token exchange refused" }))
  }

  const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    fail(
      normalized(
        "unknown",
        "Shopify returned an authorization Fanwise could not read. Try connecting the store again.",
        { issues: parsed.error.issues },
      ),
    )
  }
  return parsed.data
}

export const shopifyOAuth: ChannelOAuth = {
  accountHintLabel: "Your Shopify store domain",
  accountHintPlaceholder: "aster-type.myshopify.com",

  parseAccountHint: parseShopDomain,

  authorizeUrl({ state, accountHint, redirectUri }: OAuthAuthorizeRequest): string {
    const { clientId } = shopifyConfig()
    const parsed = parseShopDomain(accountHint)
    // Unreachable through the sanctioned path, which parses before it stores.
    // Kept because this function builds a URL a person is redirected to, and a
    // second check on that costs nothing.
    if (!parsed.ok) throw new Error("refusing to build an authorize URL for an invalid shop domain")

    const url = new URL(`https://${parsed.value}/admin/oauth/authorize`)
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("scope", SCOPES.join(","))
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("state", state)
    return url.toString()
  },

  verifyCallback(query: URLSearchParams): boolean {
    return verifyCallbackHmac(query, shopifyConfig().clientSecret)
  },

  async exchange({ accountHint, query }): Promise<OAuthGrant> {
    const code = query.get("code")
    if (!code) {
      throw new ChannelError(
        normalized(
          "unknown",
          "Shopify did not return an authorization code. Try connecting the store again.",
        ),
      )
    }

    // The shop named in the callback must be the shop the flow started against.
    // The HMAC proves Shopify sent the callback; it does not prove the creator
    // asked for this shop, and a state row bound to one shop should not produce
    // a connection to another.
    const callbackShop = query.get("shop")
    if (callbackShop && callbackShop.toLowerCase() !== accountHint) {
      throw new ChannelError(
        normalized(
          "unknown",
          "That authorization was for a different Shopify store than the one you started from. Try again.",
        ),
      )
    }

    const token = await exchangeCode({ shopDomain: accountHint, code })

    // One read, so the connection carries the shop's real name and currency
    // rather than its domain. The currency is what the listing's currency is
    // checked against: Shopify prices in the shop's currency and there is no
    // per-product override.
    const client = createShopifyClient({
      shopDomain: accountHint,
      accessToken: token.access_token,
    })
    const { shop } = await client.request({
      query: SHOP_QUERY,
      variables: {},
      schema: shopQuerySchema,
    })

    return {
      externalAccountId: shop.myshopifyDomain.toLowerCase(),
      externalAccountName: shop.name,
      scopes: token.scope ? token.scope.split(",").filter(Boolean) : [...SCOPES],
      // Offline tokens do not expire. A row claiming an expiry it does not have
      // would have the UI warn about a reconnection that is never needed.
      expiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null,
      credentials: { accessToken: token.access_token },
      metadata: {
        currencyCode: shop.currencyCode,
        ianaTimezone: shop.ianaTimezone ?? null,
      },
    }
  },
}

/** The shape lib/credentials seals and opens for this channel. */
export const shopifyCredentialsSchema = z.object({
  accessToken: z.string().min(1),
})

export type ShopifyCredentials = z.infer<typeof shopifyCredentialsSchema>
