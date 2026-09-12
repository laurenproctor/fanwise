import type { ListingLiveness } from "@/lib/publishing/manual-steps"

/**
 * What the catalog says about one product, and what it offers to do about it.
 *
 * Pure. Rows in, verdict out, no database in the room — the same shape
 * `lib/publishing/run.ts` uses, and for the same reason: every case here is
 * testable without a network, an adapter or a channel anyone has connected.
 *
 * ADR 0005 decision 7 is the constraint this module is written around, and it
 * is worth restating because the obvious implementation breaks it:
 *
 *   "No enum, no column, no derived word for the product. Not `published`, not
 *   `partially_published`, not `unpublished`. [...] If a query needs the answer
 *   it counts listings by liveness at read time."
 *
 * So the catalog's status column is a **count of what is outstanding**, never
 * an adjective over the product. "2 to fix" is a fact about two listings. "Half
 * published" would be a claim about the product, and there is no such thing.
 *
 * The product's own state and its channels' states are also kept apart. A file
 * still finalizing is a fact about the product; a listing waiting on the
 * channel is not, and collapsing the two would let "preparing" mean either.
 * They are separate concerns below, with separate words.
 */

/**
 * The one thing most worth a creator's attention about a product, right now.
 *
 * Exactly one per product, chosen by the order in `CONCERN_ORDER`. One per row
 * rather than a list, because a row that reports three things at once has
 * reported nothing: the eye has to rank them, and ranking them is this
 * module's job.
 */
export type CatalogConcern =
  /** A publication failed and Fanwise has stopped trying. */
  | "publish_failed"
  /** An uploaded file did not finish processing. */
  | "file_failed"
  /** A publication is in flight. Nothing for anyone to do. */
  | "publishing"
  /** A file is still uploading or being finalized. Nothing for anyone to do. */
  | "preparing_files"
  /** Composed copy nobody has approved. docs/ai-merchandising.md. */
  | "awaiting_review"
  /** On the channel, and a buyer still cannot reach it. ADR 0001. */
  | "finish_publishing"
  /** Satisfies a channel's rules and has never been sent. */
  | "ready_to_publish"
  /** The channel holds it, and holds an older version of it. */
  | "changes_to_send"
  /** Nothing has been built for any channel yet. */
  | "no_listings"
  /** Every listing is live and nothing is waiting. */
  | "none"

/**
 * Priority, highest first. The whole ranking lives here, in one array, so that
 * changing the order is a one-line edit rather than a rearrangement of nested
 * conditionals.
 *
 * Failures outrank work in flight, which outranks work waiting on a person,
 * which outranks work waiting on nobody. Within that, a product's own state
 * (`file_failed`, `preparing_files`) sits beside the channel state of the same
 * urgency rather than above or below all of it: a creator whose upload failed
 * and whose publish failed has two problems, and the publish is the one that is
 * costing them sales.
 */
export const CONCERN_ORDER = [
  "publish_failed",
  "file_failed",
  "publishing",
  "preparing_files",
  "awaiting_review",
  "finish_publishing",
  "ready_to_publish",
  "changes_to_send",
  "no_listings",
  "none",
] as const satisfies readonly CatalogConcern[]

/** One listing, reduced to the facts the catalog ranks on. */
export interface CatalogListingFacts {
  /** From the channels table. Never a string this module knows. */
  channelName: string
  /** Derived per ADR 0001, never stored. `lib/publishing/manual-steps.ts`. */
  liveness: ListingLiveness
  /** Computed against the adapter's rules in this request, never read from a row. */
  ready: boolean
  /** Composed copy newer than the last approval. `lib/ai/review.ts`. */
  awaitingReview: boolean
  /** The listing holds an edit the channel has not received. */
  unsentChanges: boolean
  /** The adapter can send an update. A capability, never a row. */
  canUpdate: boolean
  /** The adapter can publish at all. Assisted channels cannot. */
  canPublish: boolean
}

/** One product's files, reduced the same way. */
export interface CatalogAssetFacts {
  preparing: number
  failed: number
}

export interface CatalogFacts {
  listings: readonly CatalogListingFacts[]
  assets: CatalogAssetFacts
}

/**
 * The answer: which concern, how many carry it, and which channels they are.
 *
 * `channels` is the listings the concern names, in the order they were given,
 * and is empty for a concern about the product's own files. It is what the
 * status line's second row says out loud, so the count is never the only thing
 * a creator is told.
 */
export interface CatalogSummary {
  concern: CatalogConcern
  count: number
  channels: readonly string[]
}

/** Listings a buyer can actually reach. The Live channels column counts these. */
export function liveListings(
  listings: readonly CatalogListingFacts[],
): readonly CatalogListingFacts[] {
  return listings.filter((listing) => listing.liveness === "live")
}

/**
 * Which listings, if any, carry each concern.
 *
 * Every branch is a filter over the same array rather than a flag computed
 * along the way, so a concern can be read on its own and none of them can be
 * left stale by an early return.
 */
function listingsFor(
  concern: CatalogConcern,
  listings: readonly CatalogListingFacts[],
): readonly CatalogListingFacts[] {
  switch (concern) {
    case "publish_failed":
      return listings.filter((l) => l.liveness === "failed")
    case "publishing":
      return listings.filter((l) => l.liveness === "publishing")
    case "awaiting_review":
      return listings.filter((l) => l.awaitingReview)
    case "finish_publishing":
      return listings.filter((l) => l.liveness === "published_not_live")
    case "ready_to_publish":
      /*
       * Never sent, ready, and to a channel that can send it. The capability
       * check is what keeps an assisted channel out: its listing can satisfy
       * every rule and still have no Publish to offer, and a row promising one
       * is the capability lie invariant 8 exists to prevent.
       */
      return listings.filter((l) => l.canPublish && l.ready && l.liveness === "unpublished")
    case "changes_to_send":
      /*
       * The channel holds an older version. Same three conditions the product
       * page puts on its "Publish changes" button, because a catalog that
       * promised an update the card then refused would be describing a
       * different application.
       */
      return listings.filter(
        (l) =>
          l.canUpdate &&
          l.unsentChanges &&
          (l.liveness === "live" || l.liveness === "published_not_live"),
      )
    default:
      return []
  }
}

export function summarise(facts: CatalogFacts): CatalogSummary {
  const { listings, assets } = facts

  for (const concern of CONCERN_ORDER) {
    // The two concerns about the product's own files, which count assets
    // rather than listings and name no channel.
    if (concern === "file_failed" && assets.failed > 0) {
      return { concern, count: assets.failed, channels: [] }
    }
    if (concern === "preparing_files" && assets.preparing > 0) {
      return { concern, count: assets.preparing, channels: [] }
    }

    if (concern === "no_listings") {
      if (listings.length > 0) continue
      return { concern, count: 0, channels: [] }
    }

    if (concern === "none") {
      return { concern, count: liveListings(listings).length, channels: [] }
    }

    const carrying = listingsFor(concern, listings)
    if (carrying.length === 0) continue

    return {
      concern,
      count: carrying.length,
      channels: carrying.map((listing) => listing.channelName),
    }
  }

  /* Unreachable: `none` terminates the loop. Kept so the function is total. */
  return { concern: "none", count: 0, channels: [] }
}

/**
 * The status line, as words.
 *
 * A count phrase, never an adjective over the product, per ADR 0005. Singular
 * and plural are written out rather than pluralized with an "(s)", which reads
 * as a form nobody finished.
 */
export function concernLabel(summary: CatalogSummary): string {
  const { concern, count } = summary
  const one = count === 1

  switch (concern) {
    case "publish_failed":
      return `${count} to fix`
    case "file_failed":
      return one ? "1 file failed" : `${count} files failed`
    case "publishing":
      return `${count} publishing`
    case "preparing_files":
      return one ? "1 file preparing" : `${count} files preparing`
    case "awaiting_review":
      return `${count} to review`
    case "finish_publishing":
      return `${count} to finish`
    case "ready_to_publish":
      return `${count} ready to publish`
    case "changes_to_send":
      return one ? "1 with changes to send" : `${count} with changes to send`
    case "no_listings":
      return "No listings yet"
    case "none":
      return "Nothing outstanding"
  }
}

/**
 * The second line: what the count is about, and where.
 *
 * Returns null where the label already said everything. A line that repeated
 * the count in prose would be the "3 of 4 complete" the first-run path was
 * told not to write.
 */
export function concernDetail(summary: CatalogSummary): string | null {
  const { concern, channels } = summary

  switch (concern) {
    case "publish_failed":
      return `Publishing failed on ${listSentence(channels)}`
    case "file_failed":
      return "A file did not finish processing"
    case "publishing":
      return `Waiting for ${listSentence(channels)}`
    case "preparing_files":
      return "Fanwise is still finalizing an upload"
    case "awaiting_review":
      return `Composed copy on ${listSentence(channels)}`
    case "finish_publishing":
      return `${listSentence(channels)} needs a step from you`
    case "ready_to_publish":
      return `${listSentence(channels)} can be sent now`
    case "changes_to_send":
      return `${listSentence(channels)} holds an older version`
    case "no_listings":
      return "Nothing built for a channel yet"
    case "none":
      return null
  }
}

/**
 * Which semantic colour the status dot takes.
 *
 * Paired with the label above, never alone: docs/design-system.md requires
 * state to be readable from form as well as colour, and every status in this
 * table is a word first.
 */
export type ConcernTone = "bad" | "warn" | "working" | "ok" | "quiet"

export const CONCERN_TONES: Record<CatalogConcern, ConcernTone> = {
  publish_failed: "bad",
  file_failed: "bad",
  publishing: "working",
  preparing_files: "working",
  awaiting_review: "warn",
  finish_publishing: "warn",
  ready_to_publish: "working",
  changes_to_send: "warn",
  no_listings: "quiet",
  none: "ok",
}

/**
 * The five groups the status filter offers, and the concerns in each.
 *
 * Every concern belongs to exactly one group and every group has a concern, so
 * the filter partitions the catalog rather than sampling it: a creator who
 * walks all four non-"all" options has seen every product exactly once. A
 * filter whose options overlapped would leave them unable to tell whether a
 * missing product was filtered out or gone.
 */
export const CATALOG_FILTERS = {
  all: { label: "All products", concerns: null },
  attention: { label: "Needs attention", concerns: ["publish_failed", "file_failed"] },
  waiting: {
    label: "Waiting on you",
    concerns: [
      "awaiting_review",
      "finish_publishing",
      "ready_to_publish",
      "changes_to_send",
      "no_listings",
    ],
  },
  working: { label: "In progress", concerns: ["publishing", "preparing_files"] },
  settled: { label: "Nothing outstanding", concerns: ["none"] },
} as const satisfies Record<string, { label: string; concerns: readonly CatalogConcern[] | null }>

export type CatalogFilter = keyof typeof CATALOG_FILTERS

export const CATALOG_FILTER_KEYS = Object.keys(CATALOG_FILTERS) as CatalogFilter[]

/**
 * Falls back to "all" for anything the URL supplies that is not a filter.
 *
 * Checked against the key list rather than with `in`, which is true for every
 * name on Object.prototype: `?status=toString` passed an `in` test, resolved to
 * a function with no `concerns`, and took the page down with a TypeError raised
 * from a query parameter. Own keys only.
 */
export function parseFilter(value: string | undefined): CatalogFilter {
  return value !== undefined && (CATALOG_FILTER_KEYS as string[]).includes(value)
    ? (value as CatalogFilter)
    : "all"
}

export function matchesFilter(filter: CatalogFilter, concern: CatalogConcern): boolean {
  const { concerns } = CATALOG_FILTERS[filter]
  return concerns === null || (concerns as readonly CatalogConcern[]).includes(concern)
}

/**
 * What this row offers to do, as one action.
 *
 * `inert` is not a disabled link. It is a state with no action at all, because
 * the thing it describes is a background job the creator cannot affect, and a
 * greyed-out control would promise that waiting is a choice they are making.
 * The same refusal the first-run screen makes about an import that does not
 * exist.
 */
export type CatalogAction =
  { kind: "link"; label: string; href: string } | { kind: "inert"; label: string }

/**
 * Concern to action, exhaustively, with no conditional outside this function.
 *
 * Every action goes to the product, and that is not laziness. The product page
 * is where the controls are: Publish, Review and publish, Try again, Publish
 * changes and every manual step live on its channel cards. The channel's own
 * page holds the listing editor and nothing that publishes, so a catalog that
 * deep-linked "Publish" to it would land a creator on a page with no Publish
 * button — an action offered and then not available, which is the capability
 * lie invariant 8 exists to prevent, one level up.
 *
 * `href` is taken rather than built so this module stays pure and knows no
 * URLs; `lib/routes.ts` remains the one place a path is written.
 */
export function nextAction(summary: CatalogSummary, productHref: string): CatalogAction {
  const link = (label: string): CatalogAction => ({ kind: "link", label, href: productHref })

  switch (summary.concern) {
    case "publish_failed":
      return link("Resolve issues")
    case "file_failed":
      return link("Resolve issues")
    case "publishing":
      return { kind: "inert", label: "Publishing" }
    case "preparing_files":
      return { kind: "inert", label: "Preparing files" }
    case "awaiting_review":
      return link("Review listings")
    case "finish_publishing":
      return link("Finish publishing")
    case "ready_to_publish":
      return link("Publish")
    case "changes_to_send":
      return link("Publish changes")
    case "no_listings":
      return link("Build listings")
    case "none":
      return link("View listings")
  }
}

/**
 * One name, "one and two", "one, two and 4 more".
 *
 * The examples are deliberately not channel names: this module is product
 * domain, and invariant 2 keeps provider names out of it. Every name it joins
 * arrives from the channels table.
 *
 * Long lists are cut rather than allowed to run, because this sentence goes
 * into a table cell and a creator with nine channels does not need all nine to
 * know what the row is telling them. The full list is always available in the
 * Live channels tip beside it.
 */
export function listSentence(names: readonly string[], limit = 3): string {
  if (names.length === 0) return "No channel"
  if (names.length === 1) return names[0]!

  if (names.length > limit) {
    const rest = names.length - limit
    return `${names.slice(0, limit).join(", ")} and ${rest} more`
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/**
 * The Live channels cell, in words.
 *
 * "No live channels" rather than "0 channels" for the empty case. Zero is the
 * answer a creator most needs to read without counting, and ADR 0001's whole
 * position is that nothing may imply a product is reachable when it is not.
 */
export function liveChannelsLabel(count: number): string {
  if (count === 0) return "No live channels"
  return count === 1 ? "1 live channel" : `${count} live channels`
}

/**
 * What the tip beside that count says, or null when there is nothing to say.
 *
 * Null at zero on purpose: a tip that opened to "none" is a control that
 * punishes the reader for using it, and the label already said so.
 */
export function liveChannelsDetail(names: readonly string[]): string | null {
  if (names.length === 0) return null
  return `Live on ${listSentence(names, names.length)}.`
}

/**
 * Whether a product answers what was typed into the search box.
 *
 * Name and type, which are the two things visible in the row a creator is
 * scanning for. Searching a description they cannot see would return rows with
 * no visible reason to be there, which reads as a broken filter rather than a
 * thorough one.
 *
 * Case and surrounding space are normalized; an empty query matches everything
 * rather than nothing, so clearing the box restores the catalog.
 */
export function matchesSearch(
  product: { name: string; typeLabel: string },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === "") return true
  return (
    product.name.toLowerCase().includes(needle) || product.typeLabel.toLowerCase().includes(needle)
  )
}
