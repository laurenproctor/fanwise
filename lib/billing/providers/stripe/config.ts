import { z } from "zod"
import type { BillingInterval } from "@/lib/billing/gateway"

/**
 * The vendor's configuration, parsed lazily and only here.
 *
 * Optional as a whole: a deployment with no secret key has no billing, and
 * that is a valid deployment — CI, the database suite, a fresh checkout. Once
 * the key is present, everything else is required, because a half-configured
 * billing provider fails at the first checkout with a message that names the
 * price rather than the missing variable.
 *
 * The four price ids are the base and channel prices for each interval. They
 * are created in the vendor's dashboard to match lib/billing/rules.ts, and
 * itemRole() below is how a subscription's items are told apart: by the price
 * they carry, never by position.
 */

const schema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_BASE_MONTHLY: z.string().min(1),
  STRIPE_PRICE_BASE_YEARLY: z.string().min(1),
  STRIPE_PRICE_CHANNEL_MONTHLY: z.string().min(1),
  STRIPE_PRICE_CHANNEL_YEARLY: z.string().min(1),
})

export interface StripeConfig {
  secretKey: string
  webhookSecret: string
  prices: Record<BillingInterval, { base: string; channel: string }>
}

export type ItemRole = { role: "base" | "channel"; interval: BillingInterval }

export function readStripeConfig(
  env: Record<string, string | undefined> = process.env,
): StripeConfig | null {
  const key = env.STRIPE_SECRET_KEY
  if (!key || key.trim().length === 0) return null

  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")
    throw new Error(
      `Billing is partly configured. STRIPE_SECRET_KEY is set but these are missing: ${missing}`,
    )
  }

  const v = parsed.data
  return {
    secretKey: v.STRIPE_SECRET_KEY,
    webhookSecret: v.STRIPE_WEBHOOK_SECRET,
    prices: {
      month: { base: v.STRIPE_PRICE_BASE_MONTHLY, channel: v.STRIPE_PRICE_CHANNEL_MONTHLY },
      year: { base: v.STRIPE_PRICE_BASE_YEARLY, channel: v.STRIPE_PRICE_CHANNEL_YEARLY },
    },
  }
}

/** Which of the four prices this is, or null for a price Fanwise does not know. */
export function itemRole(config: StripeConfig, priceId: string): ItemRole | null {
  for (const interval of ["month", "year"] as const) {
    if (config.prices[interval].base === priceId) return { role: "base", interval }
    if (config.prices[interval].channel === priceId) return { role: "channel", interval }
  }
  return null
}
