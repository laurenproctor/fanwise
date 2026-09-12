import { describe, expect, it } from "vitest"
import {
  CATALOG_FILTERS,
  CATALOG_FILTER_KEYS,
  CONCERN_ORDER,
  CONCERN_TONES,
  concernDetail,
  concernLabel,
  liveChannelsDetail,
  liveChannelsLabel,
  liveListings,
  listSentence,
  matchesFilter,
  matchesSearch,
  nextAction,
  parseFilter,
  summarise,
  type CatalogConcern,
  type CatalogListingFacts,
} from "@/lib/catalog/summary"

/**
 * The catalog's ranking, its words and its one action per row.
 *
 * All of it is pure, so all of it is asserted here rather than read out of
 * markup: what a row renders is tests/unit/catalog-page.test.ts, and what a
 * creator can click is tests/e2e/catalog.spec.ts.
 *
 * The thing these tests are really holding is ADR 0005 decision 7. No function
 * here may return a word that describes the product — only counts of listings
 * and the channels they name — and the last describe block says so directly.
 */

/** A listing with nothing wrong with it: live, sent, approved, up to date. */
function listing(overrides: Partial<CatalogListingFacts> = {}): CatalogListingFacts {
  return {
    channelName: "One",
    liveness: "live",
    ready: true,
    awaitingReview: false,
    unsentChanges: false,
    canUpdate: true,
    canPublish: true,
    ...overrides,
  }
}

const NO_FILES = { preparing: 0, failed: 0 }

function facts(listings: CatalogListingFacts[], assets = NO_FILES) {
  return { listings, assets }
}

/**
 * Every action goes here: the product page is the only page with the controls.
 * tests/e2e/catalog.spec.ts proves the destination actually offers them.
 */
const PRODUCT = "/studio/aster-grotesk"

describe("what a product's row is about", () => {
  it("calls a product with nothing built not listed, and counts no channels", () => {
    const summary = summarise(facts([]))

    expect(summary.concern).toBe("no_listings")
    expect(concernLabel(summary)).toBe("No listings yet")
    expect(nextAction(summary, PRODUCT)).toEqual({
      kind: "link",
      label: "Build listings",
      href: "/studio/aster-grotesk",
    })
  })

  it("says nothing is outstanding when every listing is live", () => {
    const summary = summarise(facts([listing(), listing({ channelName: "Two" })]))

    expect(summary.concern).toBe("none")
    expect(concernLabel(summary)).toBe("Nothing outstanding")
    // No second line: the label said all of it, and a detail here would be the
    // count written out again in prose.
    expect(concernDetail(summary)).toBeNull()
    expect(nextAction(summary, PRODUCT)).toEqual({
      kind: "link",
      label: "View listings",
      href: "/studio/aster-grotesk",
    })
  })

  it("ranks a failed publication above everything else", () => {
    const summary = summarise(
      facts(
        [
          listing({ channelName: "One", liveness: "failed" }),
          listing({ channelName: "Two", liveness: "publishing" }),
          listing({ channelName: "Three", awaitingReview: true }),
        ],
        { preparing: 2, failed: 1 },
      ),
    )

    expect(summary.concern).toBe("publish_failed")
    expect(concernLabel(summary)).toBe("1 to fix")
    expect(concernDetail(summary)).toBe("Publishing failed on One")
  })

  it("offers a recovery action for a failure, on the page that can retry it", () => {
    const summary = summarise(facts([listing({ liveness: "failed" })]))

    // The product page holds Try again; the channel's own page is the listing
    // editor and has no retry on it.
    expect(nextAction(summary, PRODUCT)).toEqual({
      kind: "link",
      label: "Resolve issues",
      href: "/studio/aster-grotesk",
    })
  })

  it("counts two failures and names both channels", () => {
    const summary = summarise(
      facts([
        listing({ channelName: "One", liveness: "failed" }),
        listing({ channelName: "Two", liveness: "failed" }),
      ]),
    )

    expect(concernLabel(summary)).toBe("2 to fix")
    expect(concernDetail(summary)).toBe("Publishing failed on One and Two")
    expect(nextAction(summary, PRODUCT)).toEqual({
      kind: "link",
      label: "Resolve issues",
      href: "/studio/aster-grotesk",
    })
  })

  it("reports a failed upload against the product, never against a channel", () => {
    const summary = summarise(facts([listing()], { preparing: 0, failed: 1 }))

    expect(summary.concern).toBe("file_failed")
    expect(concernLabel(summary)).toBe("1 file failed")
    expect(summary.channels).toEqual([])
    expect(nextAction(summary, PRODUCT)).toEqual({
      kind: "link",
      label: "Resolve issues",
      href: "/studio/aster-grotesk",
    })
  })

  it("keeps files preparing separate from a channel publishing", () => {
    const preparing = summarise(facts([], { preparing: 3, failed: 0 }))
    const publishing = summarise(facts([listing({ liveness: "publishing" })]))

    expect(preparing.concern).toBe("preparing_files")
    expect(concernLabel(preparing)).toBe("3 files preparing")
    expect(publishing.concern).toBe("publishing")
    expect(concernLabel(publishing)).toBe("1 publishing")
    expect(preparing.concern).not.toBe(publishing.concern)
  })

  it("offers nothing to press while a background job is running", () => {
    for (const summary of [
      summarise(facts([listing({ liveness: "publishing" })])),
      summarise(facts([], { preparing: 1, failed: 0 })),
    ]) {
      const action = nextAction(summary, PRODUCT)
      expect(action.kind).toBe("inert")
      expect(action).not.toHaveProperty("href")
    }
  })

  it("asks for a review before it asks for a publish", () => {
    const summary = summarise(
      facts([
        listing({ channelName: "One", awaitingReview: true }),
        listing({ channelName: "Two", liveness: "unpublished" }),
      ]),
    )

    expect(summary.concern).toBe("awaiting_review")
    expect(concernLabel(summary)).toBe("1 to review")
    expect(nextAction(summary, PRODUCT)).toEqual({
      kind: "link",
      label: "Review listings",
      href: "/studio/aster-grotesk",
    })
  })

  it("asks a creator to finish a publication nobody can buy from", () => {
    const summary = summarise(
      facts([listing({ channelName: "One", liveness: "published_not_live" })]),
    )

    expect(summary.concern).toBe("finish_publishing")
    expect(concernLabel(summary)).toBe("1 to finish")
    expect(concernDetail(summary)).toBe("One needs a step from you")
    expect(nextAction(summary, PRODUCT)).toEqual({
      kind: "link",
      label: "Finish publishing",
      href: "/studio/aster-grotesk",
    })
  })

  it("offers Publish only for a listing that is ready and has never been sent", () => {
    const ready = summarise(facts([listing({ liveness: "unpublished", ready: true })]))
    const notReady = summarise(facts([listing({ liveness: "unpublished", ready: false })]))

    expect(ready.concern).toBe("ready_to_publish")
    expect(nextAction(ready, PRODUCT)).toMatchObject({ label: "Publish" })
    // Not ready and never sent is not an action the catalog can offer: the
    // blocking rules are on the channel's own card.
    expect(notReady.concern).toBe("none")
  })

  it("never offers Publish for a channel that cannot publish", () => {
    const assisted = summarise(
      facts([listing({ liveness: "unpublished", ready: true, canPublish: false })]),
    )

    // Invariant 8: the UI never offers an action a provider cannot perform.
    expect(assisted.concern).not.toBe("ready_to_publish")
  })

  it("offers Publish changes only where the channel already holds an older version", () => {
    const stale = summarise(facts([listing({ liveness: "live", unsentChanges: true })]))
    const cannotUpdate = summarise(
      facts([listing({ liveness: "live", unsentChanges: true, canUpdate: false })]),
    )
    const neverSent = summarise(
      facts([listing({ liveness: "unpublished", unsentChanges: true, ready: false })]),
    )

    expect(stale.concern).toBe("changes_to_send")
    expect(concernLabel(stale)).toBe("1 with changes to send")
    expect(nextAction(stale, PRODUCT)).toMatchObject({ label: "Publish changes" })
    expect(cannotUpdate.concern).toBe("none")
    expect(neverSent.concern).toBe("none")
  })

  it("gives every concern a tone and a label, with no gaps", () => {
    for (const concern of CONCERN_ORDER) {
      expect(CONCERN_TONES[concern], concern).toBeDefined()
      const summary = { concern, count: 2, channels: ["One", "Two"] }
      expect(concernLabel(summary).trim(), concern).not.toBe("")
      expect(nextAction(summary, PRODUCT).label.trim(), concern).not.toBe("")
    }
  })
})

describe("the live channel count", () => {
  it("counts only listings a buyer can reach", () => {
    const listings = [
      listing({ channelName: "One", liveness: "live" }),
      listing({ channelName: "Two", liveness: "published_not_live" }),
      listing({ channelName: "Three", liveness: "publishing" }),
      listing({ channelName: "Four", liveness: "failed" }),
      listing({ channelName: "Five", liveness: "unpublished" }),
      listing({ channelName: "Six", liveness: "live" }),
    ]

    expect(liveListings(listings).map((l) => l.channelName)).toEqual(["One", "Six"])
  })

  it("says none rather than zero, and gets singular and plural right", () => {
    expect(liveChannelsLabel(0)).toBe("No live channels")
    expect(liveChannelsLabel(1)).toBe("1 live channel")
    expect(liveChannelsLabel(2)).toBe("2 live channels")
    expect(liveChannelsLabel(11)).toBe("11 live channels")
  })

  it("names every live channel in the tip, however many there are", () => {
    expect(liveChannelsDetail(["One"])).toBe("Live on One.")
    expect(liveChannelsDetail(["One", "Two"])).toBe("Live on One and Two.")
    expect(liveChannelsDetail(["One", "Two", "Three", "Four"])).toBe(
      "Live on One, Two, Three and Four.",
    )
  })

  it("has no tip at all when nothing is live", () => {
    // A tip that opened to say "none" would charge the reader for the word the
    // label already gave them.
    expect(liveChannelsDetail([])).toBeNull()
  })
})

describe("sentences that have to survive a long list", () => {
  it("caps a status line rather than letting it run", () => {
    const many = ["One", "Two", "Three", "Four", "Five", "Six", "Seven"]

    expect(listSentence(many)).toBe("One, Two, Three and 4 more")
    expect(listSentence(many).length).toBeLessThan(40)
  })

  it("still reads correctly at one, two and exactly the limit", () => {
    expect(listSentence([])).toBe("No channel")
    expect(listSentence(["One"])).toBe("One")
    expect(listSentence(["One", "Two"])).toBe("One and Two")
    expect(listSentence(["One", "Two", "Three"])).toBe("One, Two and Three")
  })

  it("keeps a very long channel name whole rather than truncating mid-word", () => {
    const long = "A Marketplace With A Preposterously Long Registered Name"
    expect(listSentence([long])).toBe(long)
  })
})

describe("the status filter", () => {
  it("partitions the catalog: every concern is in exactly one group", () => {
    const groups = CATALOG_FILTER_KEYS.filter((key) => key !== "all")

    for (const concern of CONCERN_ORDER) {
      const matching = groups.filter((key) => matchesFilter(key, concern))
      expect(matching, `${concern} belongs to ${matching.length} groups`).toHaveLength(1)
    }
  })

  it("gives every group at least one concern, so no option is dead", () => {
    for (const key of CATALOG_FILTER_KEYS) {
      const concerns = CATALOG_FILTERS[key].concerns
      if (concerns === null) continue
      expect(concerns.length, key).toBeGreaterThan(0)
    }
  })

  it("lets everything through on all", () => {
    for (const concern of CONCERN_ORDER) {
      expect(matchesFilter("all", concern)).toBe(true)
    }
  })

  it("falls back to all for anything the URL invents", () => {
    expect(parseFilter(undefined)).toBe("all")
    expect(parseFilter("")).toBe("all")
    expect(parseFilter("attention")).toBe("attention")
    expect(parseFilter("../../etc/passwd")).toBe("all")
    expect(parseFilter("toString")).toBe("all")
  })
})

describe("search", () => {
  const aster = { name: "Aster Grotesk", typeLabel: "Font" }

  it("matches a name or a type, ignoring case and stray space", () => {
    expect(matchesSearch(aster, "aster")).toBe(true)
    expect(matchesSearch(aster, "  GROTESK  ")).toBe(true)
    expect(matchesSearch(aster, "font")).toBe(true)
  })

  it("matches everything when the box is empty, so clearing it restores the catalog", () => {
    expect(matchesSearch(aster, "")).toBe(true)
    expect(matchesSearch(aster, "   ")).toBe(true)
  })

  it("returns nothing for a word that is in neither", () => {
    expect(matchesSearch(aster, "template")).toBe(false)
    // Not searched: a match a creator cannot see in the row reads as a broken
    // filter rather than a thorough one.
    expect(matchesSearch({ name: "Aster", typeLabel: "Font" }, "a humanist sans")).toBe(false)
  })
})

describe("ADR 0005 decision 7: no word describes the product", () => {
  const BANNED = /\b(partially|half|fully)?\s*(published|unpublished|live|not listed)\b/i

  it("never returns an adjective over the product from a status label", () => {
    const concerns: CatalogConcern[] = [...CONCERN_ORDER]

    for (const concern of concerns) {
      const summary = { concern, count: 2, channels: ["One", "Two"] }
      const label = concernLabel(summary)

      expect(label, `${concern} label`).not.toMatch(BANNED)
      expect(label.toLowerCase(), concern).not.toContain("partially")
    }
  })

  it("says how many, not how much", () => {
    // The ADR's own example of what a run may say is a count. The catalog holds
    // to the same rule: a percentage or a fraction over a product is a claim
    // about a thing that has no aggregate state.
    for (const concern of CONCERN_ORDER) {
      const label = concernLabel({ concern, count: 3, channels: ["One"] })
      expect(label, concern).not.toMatch(/%|\d+\s*\/\s*\d+|\d+ of \d+/)
    }
  })
})
