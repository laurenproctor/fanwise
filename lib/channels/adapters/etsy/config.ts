import { z } from "zod"

/**
 * Etsy app configuration, parsed here rather than in lib/env.ts for the two
 * reasons the Shopify adapter gives: a provider name in the shared schema is
 * a provider name everywhere, and an app with no Etsy credentials is a valid
 * app.
 *
 * Etsy calls these the keystring and the shared secret. The keystring is the
 * OAuth client_id. The shared secret is never sent in the OAuth flow, which
 * uses PKCE, but every v3 call carries both in one header, so both are
 * required to do anything at all.
 */

const schema = z.object({
  clientId: z.string().min(1, "ETSY_CLIENT_ID is not set"),
  clientSecret: z.string().min(1, "ETSY_CLIENT_SECRET is not set"),
})

export type EtsyConfig = z.infer<typeof schema>

export const API_BASE = "https://api.etsy.com/v3"
export const AUTHORIZE_URL = "https://www.etsy.com/oauth/connect"
export const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token"

/**
 * Only what publishing needs. listings_d is for the compensating delete a
 * failed publish performs on its own draft, not for removing a creator's
 * listings. transactions_r arrives at B5, and adding it will re-authorize
 * every connected shop, which is right: the ask changed.
 */
export const SCOPES = ["listings_r", "listings_w", "listings_d", "shops_r"] as const

/** Etsy's own limits, stated once. */
export const LIMITS = {
  titleMax: 140,
  tagMax: 13,
  tagLength: 20,
  imageMax: 10,
  fileMax: 5,
  fileBytesMax: 20 * 1024 * 1024,
} as const

let cached: EtsyConfig | null = null

export function etsyConfig(): EtsyConfig {
  if (cached) return cached
  const parsed = schema.safeParse({
    clientId: process.env.ETSY_CLIENT_ID,
    clientSecret: process.env.ETSY_CLIENT_SECRET,
  })
  if (!parsed.success) {
    throw new Error(
      "Etsy is not configured on this deployment:\n" +
        parsed.error.issues.map((i) => `  ${i.message}`).join("\n"),
    )
  }
  cached = parsed.data
  return cached
}

/** The header every v3 call carries. */
export function apiKeyHeader(config: EtsyConfig = etsyConfig()): string {
  return `${config.clientId}:${config.clientSecret}`
}

export function isConfigured(): boolean {
  return Boolean(process.env.ETSY_CLIENT_ID && process.env.ETSY_CLIENT_SECRET)
}

/** The scopes a connection is missing, if any. Plain membership: Etsy grants back what it was asked. */
export function staleScopes(granted: readonly string[]): string[] {
  if (granted.length === 0) return []
  return SCOPES.filter((scope) => !granted.includes(scope))
}

/** Test seam. */
export function resetConfigCacheForTests(): void {
  cached = null
}
