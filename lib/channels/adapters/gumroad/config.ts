import { z } from "zod"

/**
 * Gumroad app configuration, parsed here rather than in lib/env.ts for the two
 * reasons the Shopify and Etsy adapters give: a provider name in the shared
 * schema is a provider name everywhere, and an app with no Gumroad credentials
 * is a valid app.
 *
 * Gumroad calls these the application id and the application secret, from the
 * Applications section of a seller's advanced settings. One application per
 * environment, because each holds exactly one redirect URI.
 */

const schema = z.object({
  clientId: z.string().min(1, "GUMROAD_CLIENT_ID is not set"),
  clientSecret: z.string().min(1, "GUMROAD_CLIENT_SECRET is not set"),
})

export type GumroadConfig = z.infer<typeof schema>

export const API_BASE = "https://api.gumroad.com/v2"
export const AUTHORIZE_URL = "https://gumroad.com/oauth/authorize"
export const TOKEN_URL = "https://api.gumroad.com/oauth/token"
export const REVOKE_URL = "https://api.gumroad.com/oauth/revoke"

/**
 * One scope. `edit_products` covers every call a publish makes: the presigned
 * upload, the product write, covers, thumbnail, enable and the compensating
 * delete. `view_sales` arrives with B5 and means a reconnect then, the same
 * trade Etsy made with its transactions scope.
 */
export const SCOPES = ["edit_products"] as const

/**
 * The currencies Gumroad prices in, lowercased as it wants them, and the
 * minimum price for each in the currency's own units. Zero is always allowed,
 * and means free. From Gumroad's currency table, docs/channels/gumroad.md §4.
 */
export const CURRENCIES: Readonly<Record<string, { minimum: number; minorUnits: 1 | 100 }>> = {
  usd: { minimum: 0.99, minorUnits: 100 },
  gbp: { minimum: 0.59, minorUnits: 100 },
  eur: { minimum: 0.79, minorUnits: 100 },
  jpy: { minimum: 100, minorUnits: 1 },
  inr: { minimum: 49, minorUnits: 100 },
  aud: { minimum: 0.99, minorUnits: 100 },
  cad: { minimum: 0.99, minorUnits: 100 },
  hkd: { minimum: 7.9, minorUnits: 100 },
  sgd: { minimum: 0.99, minorUnits: 100 },
  twd: { minimum: 30, minorUnits: 100 },
  nzd: { minimum: 0.99, minorUnits: 100 },
  brl: { minimum: 2.9, minorUnits: 100 },
  zar: { minimum: 9.9, minorUnits: 100 },
  chf: { minimum: 0.99, minorUnits: 100 },
  ils: { minimum: 2.9, minorUnits: 100 },
  php: { minimum: 49, minorUnits: 100 },
  krw: { minimum: 1000, minorUnits: 1 },
  pln: { minimum: 2.9, minorUnits: 100 },
  czk: { minimum: 19, minorUnits: 100 },
}

/** Gumroad's own limits, stated once. */
export const LIMITS = {
  titleMax: 255,
  tagMin: 2,
  tagMax: 20,
  coverMax: 8,
  coverBytesMax: 50 * 1024 * 1024,
  thumbnailBytesMax: 5 * 1024 * 1024,
  thumbnailEdge: 1200,
  fileBytesMax: 20 * 1024 * 1024 * 1024,
  /** Gumroad presigns one URL per part of this size. */
  partBytes: 100 * 1024 * 1024,
  permalinkMax: 255,
} as const

/**
 * The platform-wide pace for creates, docs/channels/gumroad.md §10.
 *
 * Gumroad throttles `POST /v2/products` by IP address, ten a minute and
 * escalating, and every workspace's creates leave from the same workers. So
 * Gumroad publishes run one at a time and each holds its turn for at least
 * this long: six a minute at most, below the limit with room for a retry.
 */
export const CREATE_PACE = {
  queue: "paced_creates",
  minIntervalMs: 10_000,
} as const

let cached: GumroadConfig | null = null

export function gumroadConfig(): GumroadConfig {
  if (cached) return cached
  const parsed = schema.safeParse({
    clientId: process.env.GUMROAD_CLIENT_ID,
    clientSecret: process.env.GUMROAD_CLIENT_SECRET,
  })
  if (!parsed.success) {
    throw new Error(
      "Gumroad is not configured on this deployment:\n" +
        parsed.error.issues.map((i) => `  ${i.message}`).join("\n"),
    )
  }
  cached = parsed.data
  return cached
}

export function isConfigured(): boolean {
  return Boolean(process.env.GUMROAD_CLIENT_ID && process.env.GUMROAD_CLIENT_SECRET)
}

/** The scopes a connection is missing, if any. Plain membership: Gumroad grants back what it was asked. */
export function staleScopes(granted: readonly string[]): string[] {
  if (granted.length === 0) return []
  return SCOPES.filter((scope) => !granted.includes(scope))
}

/** Test seam. */
export function resetConfigCacheForTests(): void {
  cached = null
}
