import { describe, expect, it } from "vitest"
import {
  IMPORT_STEP_COUNT,
  IMPORT_STEP_KEYS,
  canReviewMarketplaceDrafts,
  importReadiness,
  type ImportReadinessInput,
} from "@/lib/imports/readiness"
import {
  emptyListingDraft,
  fieldsAwaitingReview,
  listingIssues,
  markSuggestionsReviewed,
  setListingField,
} from "@/lib/imports/draft"
import { ANALYZED_ARTIFACT } from "@/lib/imports/sources/fixtures"
import type { BuyerDeliverable, ListingDraft, SourceSnapshot } from "@/lib/imports/types"

/**
 * The five-step readiness, which is the only thing on the import screen
 * allowed to decide whether a listing may be sent anywhere.
 *
 * The suite is deliberately about the *rules* rather than the rendering. The
 * screen renders this object twice, in the progress track and in the checklist,
 * so anything true here is true in both places, and the component suite in
 * tests/unit/import-screen.test.ts proves the rendering reads it rather than
 * deciding for itself.
 */

const SNAPSHOT: SourceSnapshot =
  ANALYZED_ARTIFACT.outcome === "analyzed"
    ? ANALYZED_ARTIFACT.snapshot
    : (() => {
        throw new Error("the artifact fixture must be an analyzed one")
      })()

const ANALYZED_DRAFT: ListingDraft =
  ANALYZED_ARTIFACT.outcome === "analyzed"
    ? ANALYZED_ARTIFACT.draft
    : (() => {
        throw new Error("the artifact fixture must be an analyzed one")
      })()

function readyFile(id = "f1"): BuyerDeliverable {
  return { id, filename: "type-scale-studio.zip", byteSize: 2_400_000, state: "ready" }
}

/** Nothing done. Every step blocked, which is where every import starts. */
function nothing(): ImportReadinessInput {
  return {
    snapshot: null,
    draft: emptyListingDraft(),
    deliverables: [],
    externalDelivery: null,
    license: null,
    rights: null,
  }
}

/** Everything done, so a test can take exactly one thing away. */
function everything(): ImportReadinessInput {
  return {
    snapshot: SNAPSHOT,
    draft: markSuggestionsReviewed(ANALYZED_DRAFT),
    deliverables: [readyFile()],
    externalDelivery: null,
    license: { id: "commercial", name: "Commercial use", summary: "Use it in client work." },
    rights: { attestedAt: "2026-09-12T10:00:00.000Z", attestedBy: "user-1" },
  }
}

describe("import readiness", () => {
  it("always reports the same five steps, in order", () => {
    const readiness = importReadiness(nothing())

    expect(readiness.steps.map((step) => step.key)).toEqual([...IMPORT_STEP_KEYS])
    expect(readiness.steps).toHaveLength(IMPORT_STEP_COUNT)
    expect(IMPORT_STEP_COUNT).toBe(5)
  })

  it("starts at nothing and ends at everything", () => {
    expect(importReadiness(nothing()).completedCount).toBe(0)
    expect(importReadiness(nothing()).percent).toBe(0)
    expect(importReadiness(nothing()).ready).toBe(false)

    expect(importReadiness(everything()).completedCount).toBe(5)
    expect(importReadiness(everything()).percent).toBe(100)
    expect(importReadiness(everything()).ready).toBe(true)
  })

  it("moves in twenties and never lands between them", () => {
    const seen = new Set<number>()
    const base = everything()

    // Take the steps away one at a time, in every prefix, so each count from 0
    // to 5 is produced by a genuinely different input rather than by arithmetic.
    const removals: Array<(input: ImportReadinessInput) => ImportReadinessInput> = [
      (input) => ({ ...input, rights: null }),
      (input) => ({ ...input, license: null }),
      (input) => ({ ...input, deliverables: [] }),
      (input) => ({ ...input, draft: emptyListingDraft() }),
      (input) => ({ ...input, snapshot: null }),
    ]

    let input = base
    seen.add(importReadiness(input).percent)
    for (const remove of removals) {
      input = remove(input)
      seen.add(importReadiness(input).percent)
    }

    expect([...seen].sort((a, b) => a - b)).toEqual([0, 20, 40, 60, 80, 100])
  })

  it("names exactly one next step, and it is the first incomplete one", () => {
    const readiness = importReadiness(nothing())
    expect(readiness.nextStep).toBe("source")

    const withSource = importReadiness({ ...nothing(), snapshot: SNAPSHOT })
    expect(withSource.nextStep).toBe("listing")

    // Nothing left to point at once every step is done.
    expect(importReadiness(everything()).nextStep).toBeNull()
  })

  it("counts what is remaining and says so in one sentence", () => {
    expect(importReadiness(nothing()).remaining).toBe(5)
    expect(importReadiness(nothing()).blockedReason).toBe("Complete 5 required items to continue.")

    const oneLeft = importReadiness({ ...everything(), rights: null })
    expect(oneLeft.remaining).toBe(1)
    // Singular, because "1 required items" is the tell that a count was
    // formatted by a template nobody read.
    expect(oneLeft.blockedReason).toBe("Complete 1 required item to continue.")

    expect(importReadiness(everything()).blockedReason).toBeNull()
  })

  it("gives every incomplete step a reason and every complete step none", () => {
    for (const step of importReadiness(nothing()).steps) {
      expect(step.complete).toBe(false)
      expect(step.blockedBy).not.toBeNull()
      expect(step.blockedBy!.length).toBeGreaterThan(0)
    }
    for (const step of importReadiness(everything()).steps) {
      expect(step.complete).toBe(true)
      expect(step.blockedBy).toBeNull()
    }
  })
})

describe("the source step", () => {
  it("is complete only once a snapshot exists", () => {
    const without = importReadiness(nothing()).steps[0]!
    expect(without.key).toBe("source")
    expect(without.complete).toBe(false)

    const withOne = importReadiness({ ...nothing(), snapshot: SNAPSHOT }).steps[0]!
    expect(withOne.complete).toBe(true)
  })
})

describe("the listing step", () => {
  function listingStep(input: ImportReadinessInput) {
    return importReadiness(input).steps.find((step) => step.key === "listing")!
  }

  it("is blocked while a required field is missing", () => {
    expect(listingStep(nothing()).complete).toBe(false)
    expect(listingIssues(emptyListingDraft()).map((issue) => issue.field)).toEqual([
      "title",
      "productType",
      "price",
      "description",
    ])
  })

  it("stays blocked when the fields pass but a model's suggestion is unread", () => {
    // The artifact fixture is exactly this case: everything valid, three
    // fields proposed rather than observed.
    const input = { ...everything(), draft: ANALYZED_DRAFT }
    expect(listingIssues(ANALYZED_DRAFT)).toEqual([])
    expect(fieldsAwaitingReview(ANALYZED_DRAFT).length).toBeGreaterThan(0)

    const step = listingStep(input)
    expect(step.complete).toBe(false)
    expect(step.blockedBy).toMatch(/^Review the suggested /)
  })

  it("completes once the suggestions have been read", () => {
    const input = { ...everything(), draft: markSuggestionsReviewed(ANALYZED_DRAFT) }
    expect(listingStep(input).complete).toBe(true)
  })

  it("completes when the creator edits the suggested field instead of confirming it", () => {
    // Editing is a stronger review than a checkbox: the value becomes theirs.
    let draft = ANALYZED_DRAFT
    for (const key of fieldsAwaitingReview(draft)) {
      draft =
        key === "tags"
          ? setListingField(draft, "tags", ["mine"])
          : key === "productType"
            ? setListingField(draft, "productType", "font")
            : setListingField(draft, key, "19")
    }

    expect(fieldsAwaitingReview(draft)).toEqual([])
    expect(listingStep({ ...everything(), draft }).complete).toBe(true)
  })

  it("keeps the suggested marker after review, so provenance survives acceptance", () => {
    const reviewed = markSuggestionsReviewed(ANALYZED_DRAFT)
    expect(reviewed.tags.origin).toEqual({ kind: "suggested", reviewed: true })
  })

  it("rejects a price that is not a number, and accepts zero", () => {
    const base = { ...everything() }
    const bad = setListingField(markSuggestionsReviewed(ANALYZED_DRAFT), "price", "free")
    expect(listingStep({ ...base, draft: bad }).complete).toBe(false)

    const free = setListingField(markSuggestionsReviewed(ANALYZED_DRAFT), "price", "0")
    expect(listingStep({ ...base, draft: free }).complete).toBe(true)
  })
})

describe("the buyer files step", () => {
  function filesStep(input: ImportReadinessInput) {
    return importReadiness(input).steps.find((step) => step.key === "buyerFiles")!
  }

  it("counts only a file that has been measured", () => {
    const pending: BuyerDeliverable = { ...readyFile(), state: "pending" }
    const failed: BuyerDeliverable = { ...readyFile(), state: "failed" }

    expect(filesStep({ ...everything(), deliverables: [pending] }).complete).toBe(false)
    expect(filesStep({ ...everything(), deliverables: [failed] }).complete).toBe(false)
    expect(filesStep({ ...everything(), deliverables: [readyFile()] }).complete).toBe(true)
  })

  it("says which of the three empty cases it is looking at", () => {
    expect(filesStep({ ...everything(), deliverables: [] }).blockedBy).toMatch(/No buyer file yet/)
    expect(
      filesStep({ ...everything(), deliverables: [{ ...readyFile(), state: "pending" }] })
        .blockedBy,
    ).toMatch(/still uploading/)
    expect(
      filesStep({ ...everything(), deliverables: [{ ...readyFile(), state: "failed" }] }).blockedBy,
    ).toMatch(/did not finish/)
  })

  it("accepts an approved external delivery in place of a file", () => {
    // The product model has no such type today, so this can only be reached by
    // constructing one. The branch is tested so that the day one exists, the
    // rule it needs is already here and already correct.
    const step = filesStep({
      ...everything(),
      deliverables: [],
      externalDelivery: { kind: "print_on_demand", approvedAt: "2026-09-12T00:00:00.000Z" },
    })
    expect(step.complete).toBe(true)
  })
})

describe("the license step", () => {
  it("needs a selection that actually says something", () => {
    const none = importReadiness({ ...everything(), license: null })
    expect(none.steps.find((step) => step.key === "license")!.complete).toBe(false)

    const blank = importReadiness({
      ...everything(),
      license: { id: "custom", name: "Your own terms", summary: "   " },
    })
    expect(blank.steps.find((step) => step.key === "license")!.complete).toBe(false)
    expect(blank.steps.find((step) => step.key === "license")!.blockedBy).toMatch(/says nothing/)
  })
})

describe("the ownership step", () => {
  it("needs an attestation that records a person", () => {
    const none = importReadiness({ ...everything(), rights: null })
    expect(none.steps.find((step) => step.key === "ownership")!.complete).toBe(false)

    const anonymous = importReadiness({
      ...everything(),
      rights: { attestedAt: "2026-09-12T10:00:00.000Z", attestedBy: "" },
    })
    expect(anonymous.steps.find((step) => step.key === "ownership")!.complete).toBe(false)
  })
})

describe("the marketplace review gate", () => {
  it("is closed at every readiness below the whole of it", () => {
    const base = everything()
    const removals: Array<Partial<ImportReadinessInput>> = [
      { snapshot: null },
      { draft: emptyListingDraft() },
      { deliverables: [] },
      { license: null },
      { rights: null },
    ]

    for (const removal of removals) {
      const readiness = importReadiness({ ...base, ...removal })
      expect(readiness.ready, `${JSON.stringify(Object.keys(removal))} should block`).toBe(false)
      expect(canReviewMarketplaceDrafts(readiness)).toBe(false)
      expect(readiness.percent).toBeLessThan(100)
    }
  })

  it("opens only at five of five", () => {
    const readiness = importReadiness(everything())
    expect(canReviewMarketplaceDrafts(readiness)).toBe(true)
    expect(readiness.completedCount).toBe(IMPORT_STEP_COUNT)
  })

  it("is the count and not the percentage, so no threshold can be mistaken for it", () => {
    // Four of five is 80%: high enough to look nearly done, and not ready.
    const nearly = importReadiness({ ...everything(), rights: null })
    expect(nearly.percent).toBe(80)
    expect(canReviewMarketplaceDrafts(nearly)).toBe(false)
  })
})
