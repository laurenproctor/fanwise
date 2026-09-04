import type { Readiness, RequirementResult } from "./types"

/**
 * Readiness is errors resolved over errors total.
 *
 * Warnings are counted and shown, and never block. Two consequences worth
 * stating because both are easy to get wrong later:
 *
 *   1. A channel with no error-severity rules is ready. The score is 1, not 0
 *      and not NaN. Dividing by zero here would render a readiness bar that
 *      says a product can never be published to a channel that will accept
 *      anything.
 *   2. `ready` is exactly "no unsatisfied errors". It is not the score crossing
 *      a threshold, because a threshold invites the idea that 90% ready is
 *      publishable, and it is not.
 */
export function computeReadiness(results: readonly RequirementResult[]): Readiness {
  const errors = results.filter((r) => r.severity === "error")
  const errorsResolved = errors.filter((r) => r.satisfied).length
  const blocking = errors.filter((r) => !r.satisfied)

  const advisory = results.filter(
    (r) => (r.severity === "warning" && !r.satisfied) || r.severity === "info",
  )

  return {
    score: errors.length === 0 ? 1 : errorsResolved / errors.length,
    errorsTotal: errors.length,
    errorsResolved,
    blocking,
    advisory,
    ready: blocking.length === 0,
  }
}

/** For display. Never used in a comparison; `ready` is the only gate. */
export function readinessPercent(readiness: Readiness): number {
  return Math.round(readiness.score * 100)
}
