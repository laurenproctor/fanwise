import { describe, expect, it } from "vitest"
import { planRun, runSummary, SKIP_REASON_TEXT, type RunChannelInput } from "@/lib/publishing/run"

/**
 * What one Publish Everywhere click decides.
 *
 * Every case here is a channel state the creator can actually be in, and the
 * assertion is always the same two things: did the run attempt it, and does it
 * say why when it did not. A run that silently omits a connected channel is the
 * failure this step exists to avoid, so the tests count skips as carefully as
 * they count starts.
 */

function channel(overrides: Partial<RunChannelInput> = {}): RunChannelInput {
  return {
    connectionId: "conn-1",
    channelName: "A Channel",
    canPublish: true,
    canUpdate: true,
    connected: true,
    listingId: "listing-1",
    ready: true,
    hasExternalId: false,
    unsentChanges: false,
    ...overrides,
  }
}

describe("planRun", () => {
  it("publishes a connected, ready listing the channel does not have yet", () => {
    const plan = planRun([channel()])

    expect(plan.skips).toEqual([])
    expect(plan.starts).toEqual([
      { kind: "publish", connectionId: "conn-1", listingId: "listing-1", channelName: "A Channel" },
    ])
  })

  it("skips a channel that cannot publish, whatever else is true of it", () => {
    // An assisted channel is not a channel having a bad day: no connection,
    // readiness or listing state changes the answer, so none of them is asked.
    const plan = planRun([
      channel({ canPublish: false, ready: false, connected: false, listingId: null }),
    ])

    expect(plan.starts).toEqual([])
    expect(plan.skips[0]?.reason).toBe("assisted")
  })

  it("skips a channel the workspace has not connected, and still names it", () => {
    const plan = planRun([channel({ connectionId: null, connected: false, listingId: null })])

    expect(plan.skips).toEqual([
      { connectionId: null, channelName: "A Channel", reason: "not_connected" },
    ])
  })

  it("skips a listing that is not ready, and one that does not exist yet", () => {
    const plan = planRun([
      channel({ ready: false }),
      channel({ connectionId: "conn-2", listingId: null }),
    ])

    expect(plan.starts).toEqual([])
    expect(plan.skips.map((s) => s.reason)).toEqual(["not_ready", "not_ready"])
  })

  it("skips a listing the channel already has with nothing new to send", () => {
    const plan = planRun([channel({ hasExternalId: true })])

    expect(plan.starts).toEqual([])
    expect(plan.skips[0]?.reason).toBe("already_published")
  })

  it("sends an edit to a channel that already has the product", () => {
    const plan = planRun([channel({ hasExternalId: true, unsentChanges: true })])

    expect(plan.skips).toEqual([])
    expect(plan.starts[0]).toMatchObject({ kind: "update", listingId: "listing-1" })
  })

  it("does not invent an update for a channel that cannot take one", () => {
    const plan = planRun([channel({ hasExternalId: true, unsentChanges: true, canUpdate: false })])

    expect(plan.starts).toEqual([])
    expect(plan.skips[0]?.reason).toBe("already_published")
  })

  it("decides every channel it is given, exactly once", () => {
    // The run's list is the whole list. A channel that falls through every
    // branch without being reported is the silent omission ADR 0005 forbids.
    const channels = [
      channel({ connectionId: "a" }),
      channel({ connectionId: "b", canPublish: false }),
      channel({ connectionId: null, connected: false }),
      channel({ connectionId: "d", ready: false }),
      channel({ connectionId: "e", hasExternalId: true }),
    ]

    const plan = planRun(channels)

    expect(plan.starts.length + plan.skips.length).toBe(channels.length)
  })

  it("states a reason for every skip", () => {
    const plan = planRun([
      channel({ canPublish: false }),
      channel({ connected: false }),
      channel({ ready: false }),
      channel({ hasExternalId: true }),
    ])

    for (const skip of plan.skips) {
      expect(SKIP_REASON_TEXT[skip.reason]).toBeTruthy()
    }
    expect(new Set(plan.skips.map((s) => s.reason)).size).toBe(4)
  })
})

describe("runSummary", () => {
  it("counts rather than describing the product", () => {
    const plan = planRun([channel({ connectionId: "a" }), channel({ connectionId: "b" })])

    expect(runSummary(plan)).toBe("Publishing to 2 channels.")
  })

  it("says what it skipped alongside what it sent", () => {
    const plan = planRun([channel({ connectionId: "a" }), channel({ canPublish: false })])

    expect(runSummary(plan)).toBe("Publishing to 1 channel · 1 skipped.")
  })

  it("says plainly when there was nothing to publish", () => {
    const plan = planRun([channel({ canPublish: false }), channel({ ready: false })])

    expect(runSummary(plan)).toBe("Nothing to publish: 2 channels skipped.")
  })

  it("never calls the product published, partially published or anything else", () => {
    // ADR 0005 decision 7, as a test rather than a note: a product is never
    // described by a run, only counted over.
    const summaries = [
      runSummary(planRun([channel()])),
      runSummary(planRun([channel({ canPublish: false })])),
      runSummary(planRun([channel({ hasExternalId: true })])),
    ]

    for (const summary of summaries) {
      expect(summary.toLowerCase()).not.toMatch(/partially|product is|unpublished/)
    }
  })
})
