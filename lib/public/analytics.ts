import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"

/**
 * Visitor numbers for a creator's public profile, as the Profile page's
 * Visitors section reads them.
 *
 * Everything is counted in Postgres by `public_profile_analytics()`, as the
 * signed-in creator, so RLS decides what is counted and PostgREST's row cap
 * never truncates a total. This module validates the answer and adds nothing
 * to it.
 */

export const ANALYTICS_PERIODS = [7, 30, 90] as const
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number]

export function parsePeriod(value: string | string[] | undefined): AnalyticsPeriod {
  const raw = Number(Array.isArray(value) ? value[0] : value)
  return (ANALYTICS_PERIODS as readonly number[]).includes(raw) ? (raw as AnalyticsPeriod) : 30
}

const count = z.number().int().nonnegative()

export const profileAnalyticsSchema = z.object({
  days: z.number().int().positive(),
  since: z.string(),
  profileViews: count,
  productViews: count,
  outboundClicks: count,
  previousProfileViews: count,
  previousProductViews: count,
  previousOutboundClicks: count,
  daily: z.array(
    z.object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      profileViews: count,
      productViews: count,
    }),
  ),
  products: z.array(z.object({ slug: z.string(), title: z.string(), views: count, clicks: count })),
  referrers: z.array(z.object({ host: z.string().nullable(), views: count })),
  channels: z.array(z.object({ name: z.string(), clicks: count })),
})

export type ProfileAnalytics = z.infer<typeof profileAnalyticsSchema>

/** Null when the numbers could not be read; the section says so rather than showing zeros. */
export async function loadProfileAnalytics(
  supabase: SupabaseClient<Database>,
  profileId: string,
  days: AnalyticsPeriod,
): Promise<ProfileAnalytics | null> {
  const { data, error } = await supabase.rpc("public_profile_analytics", {
    p_public_profile_id: profileId,
    p_days: days,
  })
  if (error) {
    console.error("[profile] analytics not loaded", error)
    return null
  }
  const parsed = profileAnalyticsSchema.safeParse(data)
  if (!parsed.success) {
    console.error("[profile] analytics response did not validate", parsed.error)
    return null
  }
  return parsed.data
}

/**
 * The change against the period before, as a whole percentage, or null when
 * there is nothing honest to say: no views before means any number is
 * "infinitely more", which is not a figure.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}
