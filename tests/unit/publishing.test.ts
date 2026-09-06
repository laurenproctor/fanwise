import { describe, expect, it } from "vitest"
import {
  LIVENESS_LABELS,
  liveness,
  mergeManualSteps,
  outstandingRequired,
  readyToActivate,
} from "@/lib/publishing/manual-steps"
import type { ManualStepRow } from "@/lib/publishing/manual-steps"
import type { ChannelListing, ManualStepSpec } from "@/lib/channels/types"

/**
 * The derived condition from ADR 0001.
 *
 * "Fully published is a derived condition, not a status value: published, and
 * no required manual step left incomplete. Do not report the product as live
 * until it holds."
 *
 * Every test below is one way of getting that wrong, and the one that matters
 * most is the third: a published listing with an outstanding file step must
 * never be called live, because a live Shopify product with no deliverable
 * attached is a product that can take money and give nothing back.
 */

const attachFile: ManualStepSpec = {
  key: "attach_digital_file",
  label: "Attach the download file",
  description: "…",
  instructions: ["a", "b"],
  required: true,
  gatesActivation: true,
  needsDeliverable: true,
}

const optionalStep: ManualStepSpec = {
  ...attachFile,
  key: "optional_thing",
  required: false,
  gatesActivation: false,
}

function row(stepKey: string, completedAt: string | null): ManualStepRow {
  return {
    id: `row-${stepKey}`,
    workspace_id: "ws-1",
    channel_listing_id: "listing-1",
    step_key: stepKey,
    completed_at: completedAt,
    completed_by: null,
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z",
  }
}

const published = {
  status: "published",
  external_listing_id: "gid://shopify/Product/900",
} as Pick<ChannelListing, "status" | "external_listing_id">

describe("merging steps", () => {
  it("treats a spec with no row as incomplete", () => {
    const states = mergeManualSteps([attachFile], [])
    expect(states).toHaveLength(1)
    expect(states[0]!.completedAt).toBeNull()
  })

  it("drops a row whose adapter no longer declares the step", () => {
    // The channel stopped asking, so the step is not outstanding any more.
    const states = mergeManualSteps([], [row("retired_step", null)])
    expect(states).toEqual([])
  })

  it("is driven by the adapter's order, not the database's", () => {
    const states = mergeManualSteps(
      [attachFile, optionalStep],
      [row("optional_thing", null), row("attach_digital_file", null)],
    )
    expect(states.map((s) => s.spec.key)).toEqual(["attach_digital_file", "optional_thing"])
  })
})

describe("outstanding work", () => {
  it("counts only required steps", () => {
    const states = mergeManualSteps([attachFile, optionalStep], [])
    expect(outstandingRequired(states).map((s) => s.spec.key)).toEqual(["attach_digital_file"])
  })

  it("is empty once the required step is done", () => {
    const states = mergeManualSteps(
      [attachFile],
      [row("attach_digital_file", "2026-09-04T10:00:00Z")],
    )
    expect(outstandingRequired(states)).toEqual([])
  })
})

describe("readiness to activate", () => {
  it("is false while a gating step is outstanding", () => {
    expect(readyToActivate(mergeManualSteps([attachFile], []))).toBe(false)
  })

  it("is true once every gating step is complete", () => {
    const states = mergeManualSteps(
      [attachFile],
      [row("attach_digital_file", "2026-09-04T10:00:00Z")],
    )
    expect(readyToActivate(states)).toBe(true)
  })

  it("is false for a channel with no gating steps, so nothing is activated by accident", () => {
    // A channel that never gates activation must not be told to go live simply
    // because it has no steps to wait for.
    expect(readyToActivate(mergeManualSteps([optionalStep], []))).toBe(false)
  })
})

describe("liveness", () => {
  it("is unpublished before anything has been sent", () => {
    expect(liveness({ status: "draft", external_listing_id: null }, [])).toBe("unpublished")
  })

  it("is publishing while a job is in flight", () => {
    expect(liveness({ status: "publishing", external_listing_id: null }, [])).toBe("publishing")
  })

  it("is published_not_live while a required step is outstanding", () => {
    // The assertion ADR 0001 exists for.
    const states = mergeManualSteps([attachFile], [])
    expect(liveness(published, states)).toBe("published_not_live")
    expect(LIVENESS_LABELS.published_not_live).toBe("Published, not live")
  })

  it("is live only once every required step is complete", () => {
    const states = mergeManualSteps(
      [attachFile],
      [row("attach_digital_file", "2026-09-04T10:00:00Z")],
    )
    expect(liveness(published, states)).toBe("live")
  })

  it("is live immediately for a channel that declares no steps", () => {
    expect(liveness(published, [])).toBe("live")
  })

  it("is never live on a status of published without an external id", () => {
    // A listing marked published that the provider never confirmed is not a
    // published listing, whatever the column says.
    expect(liveness({ status: "published", external_listing_id: null }, [])).toBe("unpublished")
  })

  it("is failed when the last attempt failed", () => {
    expect(liveness({ status: "failed", external_listing_id: null }, [])).toBe("failed")
  })

  it("does not become live because an optional step was skipped", () => {
    const states = mergeManualSteps([attachFile, optionalStep], [])
    expect(liveness(published, states)).toBe("published_not_live")
  })
})
