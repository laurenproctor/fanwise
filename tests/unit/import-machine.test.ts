import { describe, expect, it } from "vitest"
import {
  ANALYZING_STAGES,
  RECOVERABLE,
  importReducer,
  initialImportState,
  isBusy,
  snapshotOf,
  validationEvent,
  type AnalyzingStage,
  type ImportEvent,
  type ImportState,
} from "@/lib/imports/machine"
import { validateSourceUrl } from "@/lib/imports/url"
import { createFixtureAnalysisService, scenarioFor } from "@/lib/imports/service"
import { FIXTURE_SCENARIOS } from "@/lib/imports/sources/fixtures"

/**
 * The source panel's state machine.
 *
 * Two properties matter more than any single transition, and both get a test of
 * their own at the bottom: every failure state offers a way out of itself, and
 * an answer that arrives after the creator has moved on cannot land on the
 * screen.
 */

const URL = "https://claude.ai/code/artifact/3f2e8c4e-7d4b-4e9b-b9a1-2c9f4e6a7d1c"

function run(
  events: readonly ImportEvent[],
  from: ImportState = initialImportState(),
): ImportState {
  return events.reduce(importReducer, from)
}

/** The happy path, up to but not including the answer. */
function analyzing(url = URL): ImportState {
  return run([
    { type: "urlChanged", url },
    { type: "submitted" },
    { type: "validationPassed", url },
  ])
}

describe("the import state machine", () => {
  it("starts empty, with nothing typed and nothing wrong", () => {
    const state = initialImportState()
    expect(state).toEqual({ status: "empty", url: "", error: null })
    expect(isBusy(state)).toBe(false)
    expect(snapshotOf(state)).toBeNull()
  })

  it("walks paste, submit, validate, analyze, answer", () => {
    const typed = run([{ type: "urlChanged", url: URL }])
    expect(typed.status).toBe("empty")

    const submitted = importReducer(typed, { type: "submitted" })
    expect(submitted.status).toBe("validating")
    expect(isBusy(submitted)).toBe(true)

    const started = importReducer(submitted, { type: "validationPassed", url: URL })
    expect(started).toEqual({ status: "analyzing", url: URL, stage: "connecting" })

    const settled = importReducer(started, {
      type: "analysisSettled",
      analysis: FIXTURE_SCENARIOS.artifact,
    })
    expect(settled.status).toBe("analyzed")
    expect(snapshotOf(settled)).not.toBeNull()
    expect(isBusy(settled)).toBe(false)
  })

  it("reports each stage without ever claiming one finished", () => {
    let state = analyzing()
    const seen: AnalyzingStage[] = []
    for (const stage of ANALYZING_STAGES) {
      state = importReducer(state, { type: "stageAdvanced", stage })
      if (state.status === "analyzing") seen.push(state.stage)
    }
    expect(seen).toEqual([...ANALYZING_STAGES])
    // Still analyzing after the last stage: the answer is a separate event.
    expect(state.status).toBe("analyzing")
  })

  it("puts a failed validation back on the field with the reason", () => {
    const state = run([
      { type: "urlChanged", url: "not a link" },
      { type: "submitted" },
      { type: "validationFailed", message: "That does not look like a link." },
    ])
    expect(state).toEqual({
      status: "empty",
      url: "not a link",
      error: "That does not look like a link.",
    })
  })

  it("clears the complaint as soon as the field changes", () => {
    const complained = run([
      { type: "urlChanged", url: "x" },
      { type: "submitted" },
      { type: "validationFailed", message: "no" },
    ])
    const retyped = importReducer(complained, { type: "urlChanged", url: "https://example.com/a" })
    expect(retyped).toEqual({ status: "empty", url: "https://example.com/a", error: null })
  })

  it("sends a locked link and a missing link to different states", () => {
    for (const scenario of ["login", "organization"] as const) {
      const state = importReducer(analyzing(), {
        type: "analysisSettled",
        analysis: FIXTURE_SCENARIOS[scenario],
      })
      expect(state.status).toBe("private")
    }

    for (const scenario of ["missing", "expired"] as const) {
      const state = importReducer(analyzing(), {
        type: "analysisSettled",
        analysis: FIXTURE_SCENARIOS[scenario],
      })
      expect(state.status).toBe("notFound")
    }
  })

  it("maps the remaining two outcomes to their own states", () => {
    expect(
      importReducer(analyzing(), {
        type: "analysisSettled",
        analysis: FIXTURE_SCENARIOS.unsupported,
      }).status,
    ).toBe("unsupported")

    expect(
      importReducer(analyzing(), { type: "analysisSettled", analysis: FIXTURE_SCENARIOS.failed })
        .status,
    ).toBe("failed")
  })

  it("retries only from a state where retrying could answer differently", () => {
    for (const scenario of ["login", "missing", "unsupported", "failed"] as const) {
      const settled = importReducer(analyzing(), {
        type: "analysisSettled",
        analysis: FIXTURE_SCENARIOS[scenario],
      })
      const retried = importReducer(settled, { type: "retried" })

      if (RECOVERABLE.includes(settled.status)) {
        expect(retried.status, `${scenario} should retry`).toBe("analyzing")
      } else {
        // A private link retried unchanged is private again, and a button that
        // changes nothing reads as though the creator did it wrong.
        expect(retried, `${scenario} should not retry`).toEqual(settled)
      }
    }
  })

  it("keeps what was typed when the link is replaced", () => {
    const analyzed = importReducer(analyzing(), {
      type: "analysisSettled",
      analysis: FIXTURE_SCENARIOS.artifact,
    })
    const replaced = importReducer(analyzed, { type: "linkReplaced" })
    expect(replaced).toEqual({ status: "empty", url: URL, error: null })
  })

  it("ignores an answer that arrives after the creator has moved on", () => {
    // The exact race the abort in the screen exists for: a slow read answers
    // about a URL nobody is looking at, and applying it would overwrite what is
    // being typed now.
    const movedOn = importReducer(analyzing(), { type: "linkReplaced" })
    const late = importReducer(movedOn, {
      type: "analysisSettled",
      analysis: FIXTURE_SCENARIOS.artifact,
    })
    expect(late).toEqual(movedOn)
  })

  it("ignores a stage report once the answer has landed", () => {
    const analyzed = importReducer(analyzing(), {
      type: "analysisSettled",
      analysis: FIXTURE_SCENARIOS.artifact,
    })
    expect(importReducer(analyzed, { type: "stageAdvanced", stage: "reading" })).toEqual(analyzed)
  })

  it("accepts a draft edit only where there is a draft to edit", () => {
    const analyzed = importReducer(analyzing(), {
      type: "analysisSettled",
      analysis: FIXTURE_SCENARIOS.artifact,
    })
    if (analyzed.status !== "analyzed") throw new Error("expected an analyzed state")

    const edited = importReducer(analyzed, {
      type: "draftChanged",
      draft: { ...analyzed.draft, title: { value: "Renamed", origin: { kind: "creator" } } },
    })
    expect(edited.status === "analyzed" && edited.draft.title.value).toBe("Renamed")

    const empty = initialImportState()
    expect(importReducer(empty, { type: "draftChanged", draft: analyzed.draft })).toEqual(empty)
  })
})

describe("every unhappy state offers a way out of itself", () => {
  it("carries at least one recovery, and a retryable one where a retry helps", () => {
    for (const scenario of [
      "login",
      "organization",
      "missing",
      "expired",
      "unsupported",
      "failed",
    ] as const) {
      const state = importReducer(analyzing(), {
        type: "analysisSettled",
        analysis: FIXTURE_SCENARIOS[scenario],
      })
      if (!("recoveries" in state)) throw new Error(`${scenario} produced no recoveries`)

      expect(state.recoveries.length, `${scenario} has no way out`).toBeGreaterThan(0)
      // Continuing by hand is always available: it is the one recovery that
      // cannot itself fail.
      expect(
        state.recoveries.some((option) => option.action === "continue_manually"),
        `${scenario} cannot be continued manually`,
      ).toBe(true)
      expect(state.message.length).toBeGreaterThan(0)
    }
  })

  it("offers a retry exactly where the machine will honour one", () => {
    for (const scenario of ["login", "missing", "unsupported", "failed"] as const) {
      const state = importReducer(analyzing(), {
        type: "analysisSettled",
        analysis: FIXTURE_SCENARIOS[scenario],
      })
      if (!("recoveries" in state)) throw new Error("expected recoveries")

      const offered = state.recoveries.some((option) => option.action === "retry")
      expect(offered, `${scenario} offers a retry the reducer would ignore`).toBe(
        RECOVERABLE.includes(state.status),
      )
    }
  })
})

describe("the pasted link, checked before anything is fetched", () => {
  it("accepts an ordinary https link and normalizes it", () => {
    const checked = validateSourceUrl("  HTTPS://Claude.ai/code/artifact/abc#frag  ")
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.url).toBe("https://claude.ai/code/artifact/abc")
  })

  it("assumes https for a bare host, and refuses an explicit http", () => {
    const bare = validateSourceUrl("example.com/thing")
    expect(bare.ok).toBe(true)
    if (bare.ok) expect(bare.url).toBe("https://example.com/thing")

    // Not upgraded. Silently changing which origin is read is how a fetch ends
    // up somewhere the creator did not name.
    const insecure = validateSourceUrl("http://example.com/thing")
    expect(insecure.ok).toBe(false)
    if (!insecure.ok) expect(insecure.refusal).toBe("scheme")
  })

  it("refuses the shapes the server boundary refuses", () => {
    const cases: Array<[string, string]> = [
      ["", "empty"],
      ["https://", "unparseable"],
      ["https://user:pw@example.com/a", "credentials"],
      ["https://example.com:8443/a", "port"],
      ["https://localhost/a", "hostname"],
      ["https://box.local/a", "hostname"],
      ["https://internal/a", "hostname"],
      ["https://169.254.169.254/latest", "hostname"],
    ]
    for (const [input, refusal] of cases) {
      const checked = validateSourceUrl(input)
      expect(checked.ok, `${input} was accepted`).toBe(false)
      if (!checked.ok) expect(checked.refusal, input).toBe(refusal)
    }
  })

  it("turns its answer straight into the next event", () => {
    expect(validationEvent("https://example.com/a")).toEqual({
      type: "validationPassed",
      url: "https://example.com/a",
    })
    const bad = validationEvent("nope")
    expect(bad.type).toBe("validationFailed")
  })
})

describe("the fixture analysis service", () => {
  const service = createFixtureAnalysisService({ stageDelayMs: 0 })

  it("reports every stage in order before it answers", async () => {
    const seen: AnalyzingStage[] = []
    await service.analyze({ url: URL, onStage: (stage) => seen.push(stage) })
    expect(seen).toEqual([...ANALYZING_STAGES])
  })

  it("resolves a recognised link and an ordinary page without a marker", async () => {
    await expect(service.analyze({ url: URL })).resolves.toBe(FIXTURE_SCENARIOS.artifact)
    await expect(service.analyze({ url: "https://example.com/x" })).resolves.toBe(
      FIXTURE_SCENARIOS.webpage,
    )
  })

  it("reaches every scenario through its marker, and only through it", () => {
    for (const scenario of Object.keys(FIXTURE_SCENARIOS)) {
      expect(scenarioFor(`https://example.com/fanwise-demo-${scenario}`)).toBe(scenario)
    }
    // A real link can never contain the marker by accident.
    expect(scenarioFor("https://example.com/demo/failed")).toBe("webpage")
  })

  it("drives the reducer from empty to analyzed with nothing else in between", async () => {
    let state = run([{ type: "urlChanged", url: URL }, { type: "submitted" }, validationEvent(URL)])
    const analysis = await service.analyze({
      url: URL,
      onStage: (stage) => {
        state = importReducer(state, { type: "stageAdvanced", stage })
      },
    })
    state = importReducer(state, { type: "analysisSettled", analysis })

    expect(state.status).toBe("analyzed")
    expect(snapshotOf(state)?.title).toBe("Type Scale Studio")
  })

  it("abandons a read that was aborted, rather than answering about it", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(service.analyze({ url: URL, signal: controller.signal })).rejects.toThrow(
      /abandoned/,
    )
  })
})
