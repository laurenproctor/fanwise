import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  firstPublicationLanded,
  isConfirmedPublication,
  summarizePublications,
  type PublicationFacts,
} from "@/lib/publishing/first-publication"
import { FAVICON_FRAMES } from "@/lib/favicon/animation"
import type { ListingLiveness } from "@/lib/publishing/manual-steps"

/**
 * When the favicon may celebrate. The rule is a comparison of two server
 * renders of a product's cards, so every case is a pair of card lists.
 */

function facts(
  liveness: ListingLiveness,
  statusSource: PublicationFacts["statusSource"] = "verified",
): PublicationFacts {
  return { liveness, statusSource }
}

const P = "product-1"

describe("what counts as a confirmed publication", () => {
  it("is a verified listing the channel holds, buyable or not yet", () => {
    expect(isConfirmedPublication(facts("live"))).toBe(true)
    expect(isConfirmedPublication(facts("published_not_live"))).toBe(true)
  })

  it("is not a draft, a job in flight or a failure", () => {
    expect(isConfirmedPublication(facts("unpublished"))).toBe(false)
    expect(isConfirmedPublication(facts("publishing"))).toBe(false)
    expect(isConfirmedPublication(facts("failed"))).toBe(false)
  })

  it("is not a self-reported status, because nothing confirmed it", () => {
    expect(isConfirmedPublication(facts("live", "self_reported"))).toBe(false)
    expect(isConfirmedPublication(facts("published_not_live", null))).toBe(false)
  })
})

describe("a first publication", () => {
  it("is the step from no confirmed listing to one", () => {
    const before = summarizePublications(P, [facts("publishing")])
    const after = summarizePublications(P, [facts("live")])
    expect(firstPublicationLanded(before, after)).toBe(true)
  })

  it("is also a retry that finally lands, and a job that lands before the first refresh", () => {
    expect(
      firstPublicationLanded(
        summarizePublications(P, [facts("failed")]),
        summarizePublications(P, [facts("published_not_live")]),
      ),
    ).toBe(true)
    expect(
      firstPublicationLanded(
        summarizePublications(P, [facts("unpublished")]),
        summarizePublications(P, [facts("live")]),
      ),
    ).toBe(true)
  })

  it("is not the first render, whatever it shows", () => {
    expect(firstPublicationLanded(null, summarizePublications(P, [facts("live")]))).toBe(false)
  })

  it("is not an edit to a listing already on a channel", () => {
    const before = summarizePublications(P, [facts("live")])
    const after = summarizePublications(P, [facts("live")])
    expect(firstPublicationLanded(before, after)).toBe(false)
  })

  it("is not a second channel for a product already on one", () => {
    const before = summarizePublications(P, [facts("live"), facts("publishing")])
    const after = summarizePublications(P, [facts("live"), facts("live")])
    expect(firstPublicationLanded(before, after)).toBe(false)
  })

  it("is not a failure, a refusal or a job still running", () => {
    const before = summarizePublications(P, [facts("unpublished")])
    expect(firstPublicationLanded(before, summarizePublications(P, [facts("publishing")]))).toBe(
      false,
    )
    expect(firstPublicationLanded(before, summarizePublications(P, [facts("failed")]))).toBe(false)
    expect(firstPublicationLanded(before, summarizePublications(P, [facts("unpublished")]))).toBe(
      false,
    )
  })

  it("is not a step that takes a published listing live", () => {
    const before = summarizePublications(P, [facts("published_not_live")])
    const after = summarizePublications(P, [facts("live")])
    expect(firstPublicationLanded(before, after)).toBe(false)
  })

  it("is not a self-reported status arriving on an assisted channel", () => {
    const before = summarizePublications(P, [facts("unpublished", "self_reported")])
    const after = summarizePublications(P, [facts("live", "self_reported")])
    expect(firstPublicationLanded(before, after)).toBe(false)
  })

  it("never compares one product's cards with another's", () => {
    const before = summarizePublications("product-a", [])
    const after = summarizePublications("product-b", [facts("live")])
    expect(firstPublicationLanded(before, after)).toBe(false)
  })

  it("counts a run that lands on several channels at once as one first publication", () => {
    const before = summarizePublications(P, [facts("publishing"), facts("publishing")])
    const after = summarizePublications(P, [facts("live"), facts("live")])
    expect(after.confirmed).toBe(2)
    expect(firstPublicationLanded(before, after)).toBe(true)
  })
})

describe("the frame files", () => {
  it("exist in public/ at the paths the animator will request", () => {
    for (const href of FAVICON_FRAMES) {
      expect(existsSync(join(process.cwd(), "public", href)), href).toBe(true)
    }
    for (const file of [
      "fanwise-favicon/favicon.svg",
      "favicon.ico",
      "favicon-16x16.png",
      "favicon-32x32.png",
      "apple-touch-icon.png",
      "safari-pinned-tab.svg",
      "site.webmanifest",
      "icon-192.png",
      "icon-512.png",
    ]) {
      expect(existsSync(join(process.cwd(), "public", file)), file).toBe(true)
    }
  })
})
