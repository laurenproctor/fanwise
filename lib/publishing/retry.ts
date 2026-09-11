import { isRetryable, type NormalizedErrorCode } from "@/lib/channels/errors"
import type { PublicationKind } from "./idempotency"

/**
 * Whether a failed job is tried again by Fanwise, and when. ADR 0005, decision 8.
 *
 * Retry has two tiers and they answer different questions. Inside an adapter's
 * HTTP client, within one job attempt, the question is "was this request
 * momentarily unlucky", and the horizon is seconds; that tier lives in
 * lib/channels/errors.ts because it is a property of a code rather than of a
 * channel. Here the question is "is the channel having a bad quarter of an
 * hour", and the horizon is minutes, so it is a delayed hand-off to the queue
 * rather than a sleep inside a request (rule 7).
 *
 * Three re-attempts and then the job fails for good. The point is to cover a
 * deploy, a throttle window or a brief outage; anything past twenty-one minutes
 * is a channel with a problem the creator should hear about rather than one
 * Fanwise should keep quietly asking about. The delays are also the answer to a
 * rate limit that counts per application rather than per connection, and is
 * therefore shared by every tenant at once: the worst case those channels see
 * is a handful of calls per listing per quarter-hour, not a tight loop.
 *
 * A creator pressing Try again is never refused and never counted here. It is a
 * new decision, not attempt four of an old one.
 */
export const REATTEMPT_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const

export interface ReattemptInput {
  code: NormalizedErrorCode
  kind: PublicationKind
  /** Attempts that have already run, including the one that just failed. */
  attempts: number
}

export type ReattemptRefusal = "not_retryable" | "create_not_repeatable" | "schedule_exhausted"

export type ReattemptDecision =
  { reattempt: true; delayMs: number } | { reattempt: false; reason: ReattemptRefusal }

export function planReattempt({ code, kind, attempts }: ReattemptInput): ReattemptDecision {
  if (!isRetryable(code)) return { reattempt: false, reason: "not_retryable" }

  /*
   * The create exception, and the reason "recovered without duplicates" is in
   * A7's exit test at all.
   *
   * `publish` is the one kind that creates the external object, and a transport
   * failure on a create is the one failure whose retry is not idempotent: the
   * request may have landed and taken the response with it, in which case
   * asking again creates a second product. Every other kind writes to an object
   * that already has an id, which is safe to repeat.
   *
   * So this waits for the creator instead. Their Try again may still create a
   * second product after a lost response; closing that needs the adapter to
   * stamp the listing id on what it creates and look for the stamp before
   * creating, which is deferred (ADR 0005, "accept, amend or overrule", item 3).
   */
  if (kind === "publish" && code === "network") {
    return { reattempt: false, reason: "create_not_repeatable" }
  }

  const delayMs = REATTEMPT_DELAYS_MS[attempts - 1]
  if (delayMs === undefined) return { reattempt: false, reason: "schedule_exhausted" }

  return { reattempt: true, delayMs }
}
