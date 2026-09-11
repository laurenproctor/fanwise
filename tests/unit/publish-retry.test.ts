import { describe, expect, it } from "vitest"
import { planReattempt, REATTEMPT_DELAYS_MS } from "@/lib/publishing/retry"
import { NORMALIZED_ERROR_CODES, isRetryable, IN_CALL_MAX_ATTEMPTS } from "@/lib/channels/errors"

/**
 * Whether Fanwise tries again by itself, and when. ADR 0005 decision 8.
 *
 * The half of A7's exit test that says "recovered without duplicates" lives
 * here: a failure that is worth another attempt gets three of them, and the one
 * request whose repeat could create a second product gets none.
 */

describe("the re-attempt schedule", () => {
  it("is three delays, one, five and fifteen minutes", () => {
    expect(REATTEMPT_DELAYS_MS).toEqual([60_000, 300_000, 900_000])
  })

  it("hands back each delay in turn, then gives up", () => {
    const delays = [1, 2, 3, 4].map((attempts) =>
      planReattempt({ code: "provider_unavailable", kind: "update", attempts }),
    )

    expect(delays).toEqual([
      { reattempt: true, delayMs: 60_000 },
      { reattempt: true, delayMs: 300_000 },
      { reattempt: true, delayMs: 900_000 },
      { reattempt: false, reason: "schedule_exhausted" },
    ])
  })

  it("never re-attempts a code the vocabulary calls final", () => {
    const final = NORMALIZED_ERROR_CODES.filter((code) => !isRetryable(code))

    // Not a hand-written list: whatever the error vocabulary says is retryable
    // is what this obeys, so a code added there cannot quietly become one this
    // file keeps asking about.
    expect(final.length).toBeGreaterThan(0)
    for (const code of final) {
      expect(planReattempt({ code, kind: "publish", attempts: 1 })).toEqual({
        reattempt: false,
        reason: "not_retryable",
      })
    }
  })

  it("re-attempts a throttle, which is the case the delays were chosen for", () => {
    expect(planReattempt({ code: "rate_limited", kind: "publish", attempts: 1 })).toEqual({
      reattempt: true,
      delayMs: 60_000,
    })
  })
})

describe("the create exception", () => {
  it("never re-attempts a publish whose response was lost", () => {
    // A publish is the one kind that creates the external object. A transport
    // failure may mean the create landed and took the answer with it, so asking
    // again is how one click becomes two products.
    expect(planReattempt({ code: "network", kind: "publish", attempts: 1 })).toEqual({
      reattempt: false,
      reason: "create_not_repeatable",
    })
  })

  it("still re-attempts the kinds that write to an object that already exists", () => {
    for (const kind of ["update", "activate"] as const) {
      expect(planReattempt({ code: "network", kind, attempts: 1 })).toMatchObject({
        reattempt: true,
      })
    }
  })

  it("refuses the create on every attempt, not only the first", () => {
    for (const attempts of [1, 2, 3, 9]) {
      expect(planReattempt({ code: "network", kind: "publish", attempts })).toMatchObject({
        reattempt: false,
      })
    }
  })
})

describe("the two tiers together", () => {
  it("bounds what one failing channel costs", () => {
    // In-call attempts multiply by re-attempts, and the product is the number
    // to hold against a channel whose rate limit is shared across tenants.
    const worstCase = IN_CALL_MAX_ATTEMPTS * (REATTEMPT_DELAYS_MS.length + 1)
    const minutes = REATTEMPT_DELAYS_MS.reduce((total, ms) => total + ms, 0) / 60_000

    expect(worstCase).toBe(12)
    expect(minutes).toBe(21)
  })
})
