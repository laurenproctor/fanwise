import type { AnalyzingStage } from "./machine"
import { ANALYZING_STAGES } from "./machine"
import { sourceKindFor } from "./sources/registry"
import { FIXTURE_SCENARIOS, type FixtureScenario } from "./sources/fixtures"
import type { SourceAnalysis } from "./types"

/**
 * The boundary between the screen and whatever actually reads a link.
 *
 * Provider-neutral on purpose: nothing in this interface names a service, a
 * transport or a parser. Today the only implementation returns fixtures. When
 * phases 3 and 4 of `docs/product-link-import.md` land, the real one is a
 * server action that enqueues a job and polls a row, and it satisfies this same
 * interface — so the screen, the reducer and every test above this line are
 * untouched by that change.
 *
 * **This is not where the security boundary lives.** A real implementation
 * fetches through `lib/net/outbound.ts`, server-side, with no credential and no
 * cookie, and never renders or executes what comes back. Nothing in this file
 * fetches anything at all.
 */

export interface AnalyzeRequest {
  /** Already through `validateSourceUrl`. Normalized, https, public host. */
  readonly url: string
  /** Called as the work moves on, so the screen can say what is happening. */
  readonly onStage?: (stage: AnalyzingStage) => void
  /** Abandons the read when the creator replaces the link mid-flight. */
  readonly signal?: AbortSignal
}

export interface SourceAnalysisService {
  analyze(request: AnalyzeRequest): Promise<SourceAnalysis>
}

/** Raised when a read is abandoned. Never shown: the screen has already moved on. */
export class AnalysisAbortedError extends Error {
  constructor() {
    super("the analysis was abandoned")
    this.name = "AnalysisAbortedError"
  }
}

/**
 * Which fixture a URL demonstrates.
 *
 * A development affordance, and deliberately an ugly one: a real link never
 * contains `fanwise-demo-`, so nothing a creator pastes can land on a scenario
 * by accident, and the marker is obvious in a screenshot or a bug report. It
 * disappears with this service.
 *
 * Without a marker, the answer is the honest default: a link Fanwise recognises
 * analyzes, and so does an ordinary page.
 */
export function scenarioFor(url: string): FixtureScenario {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "webpage"
  }

  const marker = /fanwise-demo-([a-z]+)/.exec(parsed.href.toLowerCase())?.[1]
  if (marker && marker in FIXTURE_SCENARIOS) return marker as FixtureScenario

  return sourceKindFor(parsed) === "hosted_artifact" ? "artifact" : "webpage"
}

export interface FixtureServiceOptions {
  /**
   * How long to dwell on each stage. Zero in tests, so a suite does not wait on
   * a progress animation it is not asserting.
   */
  readonly stageDelayMs?: number
  /** Injected in tests. Defaults to a real timer. */
  readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Overrides the scenario entirely, for a test that wants one state. */
  readonly resolve?: (url: string) => FixtureScenario
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new AnalysisAbortedError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * The fixture-backed service.
 *
 * Walks the named stages in order before answering, so the analyzing state is
 * a real sequence the screen reports rather than a spinner with a caption. It
 * reports each stage as it begins and never reports a stage as finished, which
 * is the same restraint the progress UI keeps: what is happening is knowable,
 * how much is left is not.
 */
export function createFixtureAnalysisService(
  options: FixtureServiceOptions = {},
): SourceAnalysisService {
  const delay = options.stageDelayMs ?? 420
  const wait = options.wait ?? sleep
  const resolve = options.resolve ?? scenarioFor

  return {
    async analyze({ url, onStage, signal }: AnalyzeRequest): Promise<SourceAnalysis> {
      for (const stage of ANALYZING_STAGES) {
        if (signal?.aborted) throw new AnalysisAbortedError()
        onStage?.(stage)
        await wait(delay, signal)
      }
      if (signal?.aborted) throw new AnalysisAbortedError()
      return FIXTURE_SCENARIOS[resolve(url)]
    },
  }
}
