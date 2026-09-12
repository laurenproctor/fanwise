import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

/*
  The panel is a client component that reads the router and calls server
  actions. Neither exists in a node test and rendering touches neither, so both
  are replaced with the smallest thing that satisfies the import.
*/
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}))
vi.mock("@/lib/channels/actions", () => ({ buildListingAction: async () => ({ error: null }) }))
vi.mock("@/lib/publishing/actions", () => ({
  publishListingAction: async () => ({ error: null }),
  publishChangesAction: async () => ({ error: null }),
}))

import { ListingPanel, type ChannelListingCard } from "@/components/channels/listing-panel"
import { computeReadiness } from "@/lib/channels/readiness"
import type { RequirementResult } from "@/lib/channels/types"
import type { ListingLiveness } from "@/lib/publishing/manual-steps"

/**
 * The publish affordance on a listing card, over every state that decides it.
 *
 * Two browser tests used to read this off a real product page: an assisted
 * channel never offers Publish, and a listing that is not ready offers a
 * Publish that refuses. Both are decided by what the card is handed, so they
 * are rendered here for every liveness a card can be in rather than the one
 * state each browser test happened to reach. The browser still sees both, on
 * the way through journey-05-publish.spec.ts and
 * journey-05-publish-everywhere.spec.ts.
 */

const BLOCKING: RequirementResult[] = [
  { key: "deliverable", label: "Deliverable", severity: "error", satisfied: false },
  { key: "title", label: "Title", severity: "error", satisfied: true },
]
const SATISFIED: RequirementResult[] = [
  { key: "deliverable", label: "Deliverable", severity: "error", satisfied: true },
]

const LIVENESSES: ListingLiveness[] = [
  "unpublished",
  "publishing",
  "published_not_live",
  "live",
  "failed",
]

function card(overrides: Partial<ChannelListingCard>): ChannelListingCard {
  const results = overrides.results ?? SATISFIED
  return {
    connectionId: "c1",
    channelName: "Mock Storefront",
    integrationType: "api",
    canPublish: true,
    canPublishChanges: false,
    listingId: "l1",
    title: "Aster Grotesk Display",
    statusSource: "verified",
    readiness: computeReadiness(results),
    results,
    liveness: "unpublished",
    externalUrl: null,
    manualSteps: [],
    lastError: null,
    awaitingReview: false,
    deliverable: null,
    ...overrides,
  }
}

function render(cards: ChannelListingCard[]): string {
  return renderToStaticMarkup(
    createElement(ListingPanel, {
      workspaceSlug: "northbound-type",
      productSlug: "aster-grotesk",
      productId: "p1",
      cards,
    }),
  )
}

function buttons(markup: string): Array<{ text: string; disabled: boolean }> {
  return [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    text: (m[2] ?? "")
      .split(/<[^>]*>/)
      .join("")
      .trim(),
    disabled: /\bdisabled=""/.test(m[1] ?? ""),
  }))
}

const PUBLISHING = /^(re)?publish|^try again/i

describe("the listing card's publish affordance", () => {
  it("never offers an assisted channel anything that publishes, in any state", () => {
    for (const liveness of LIVENESSES) {
      for (const results of [SATISFIED, BLOCKING]) {
        const markup = render([
          card({
            channelName: "Mock Marketplace",
            integrationType: "assisted",
            statusSource: "self_reported",
            canPublish: false,
            liveness,
            results,
            readiness: computeReadiness(results),
          }),
        ])

        // Absent, not disabled.
        expect(
          buttons(markup).filter((b) => PUBLISHING.test(b.text)),
          liveness,
        ).toEqual([])
        expect(markup).not.toContain("Resolve what is blocking before publishing.")
        expect(markup).toContain("Status here is self-reported.")
      }
    }
  })

  it("offers a listing that is not ready a Publish that refuses, and says why", () => {
    const markup = render([card({ results: BLOCKING, readiness: computeReadiness(BLOCKING) })])

    expect(buttons(markup).filter((b) => b.text === "Publish")).toEqual([
      { text: "Publish", disabled: true },
    ])
    expect(markup).toContain("Resolve what is blocking before publishing.")
  })

  it("enables Publish once nothing blocks it, and stops explaining", () => {
    const markup = render([card({})])

    expect(buttons(markup).filter((b) => b.text === "Publish")).toEqual([
      { text: "Publish", disabled: false },
    ])
    expect(markup).not.toContain("Resolve what is blocking before publishing.")
  })

  it("takes canPublish from the adapter's declared capability, on the product page", () => {
    // The page is an async server component that reads the database, so the
    // mapping from adapter to card, and the gate on Publish Everywhere, are
    // pinned at the source. Which channels a run attempts is
    // tests/unit/publish-run.test.ts.
    const source = readFileSync(
      join(__dirname, "..", "..", "app", "[slug]", "[productSlug]", "page.tsx"),
      "utf8",
    )

    expect(source).toContain("canPublish: adapter!.capabilities.automaticPublish,")
    expect(source).toContain(
      "const canPublishSomewhere = runChannels.some((channel) => channel.canPublish && channel.connected)",
    )
    expect(source).toMatch(/\{canPublishSomewhere \? \(/)
  })
})
