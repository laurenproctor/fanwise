/**
 * The vendor's configuration, parsed here rather than in lib/env.ts.
 *
 * The variable is optional, because an application with no model configured
 * is a valid application: every CI run and every fresh checkout is one. The
 * cost is a plain answer at the moment a generation is asked for, which is
 * where it belongs.
 *
 * Decision 12, docs/decisions/0002: Sonnet 5, effort low, profile prefix
 * cached. The rates are the first-party ones from the same decision and are
 * what estimated_cost is computed from. They are an input to an estimate, not
 * a bill.
 */

export const MODEL = "claude-sonnet-5"
export const EFFORT = "low" as const
export const PROVIDER_NAME = "anthropic"

/** USD per token. */
export const RATES = {
  input: 2 / 1_000_000,
  output: 10 / 1_000_000,
  cacheRead: 0.2 / 1_000_000,
  cacheWrite: 2.5 / 1_000_000,
} as const

export function readApiKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.ANTHROPIC_API_KEY?.trim()
  return key && key.length > 0 ? key : null
}
