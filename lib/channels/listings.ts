import { computeReadiness } from "./readiness"
import { evaluateRequirements } from "./requirements"
import type { ProductAsset } from "@/lib/products/types"
import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelListing,
  ChannelListingDraft,
  Readiness,
  RequirementResult,
} from "./types"

/**
 * Turning a canonical product into a channel listing, and judging the result.
 *
 * Everything in this file is pure. It takes rows and returns values, touches no
 * database and no network, and is therefore the part of A3 that unit tests can
 * pin down completely. Persistence lives in actions.ts.
 *
 * The direction is one-way by construction: a draft is built from a product,
 * and nothing here ever writes back to one.
 */

export function buildDraft(adapter: ChannelAdapter, subject: AdapterSubject): ChannelListingDraft {
  return adapter.buildListing(subject)
}

/**
 * Reads a stored listing back into the shape requirements are written against.
 *
 * Once A4 lets a creator hand-edit a listing, the stored row and the adapter's
 * freshly built draft diverge, and readiness must be judged on what is actually
 * stored. Judging the rebuilt draft instead would tell the creator their edits
 * were fine when the thing that would be submitted is not.
 */
export function listingToDraft(listing: ChannelListing): ChannelListingDraft {
  return {
    title: listing.title,
    description: listing.description,
    shortDescription: listing.short_description,
    price: listing.price === null ? null : Number(listing.price),
    currency: listing.currency,
    category: listing.category,
    tags: listing.tags ?? [],
    metadata: (listing.metadata as Record<string, unknown>) ?? {},
  }
}

export interface Evaluation {
  results: RequirementResult[]
  readiness: Readiness
}

export function evaluate(
  adapter: ChannelAdapter,
  draft: ChannelListingDraft,
  subject: AdapterSubject,
): Evaluation {
  const results = evaluateRequirements(adapter.requirements, draft, subject)
  return { results, readiness: computeReadiness(results) }
}

/** Column shape for an insert or update. Kept next to the draft it mirrors. */
export function draftToColumns(draft: ChannelListingDraft) {
  return {
    title: draft.title,
    description: draft.description,
    short_description: draft.shortDescription,
    price: draft.price,
    currency: draft.currency,
    category: draft.category,
    tags: draft.tags,
    metadata: draft.metadata as never,
  }
}

/**
 * The columns a rebuild is allowed to write over an existing listing.
 *
 * Rebuilding regenerates the *draft*. It has no business having an opinion
 * about what the channel is currently holding, and this function exists so that
 * boundary is stated once rather than implied by the shape of an upsert.
 *
 * What is deliberately absent: `status` and `status_source`. Those describe
 * publication, and a rebuild has published nothing. They were previously part
 * of the same upsert, so regenerating a live listing set it back to draft and
 * self_reported while leaving its external id in place — a row claiming to be
 * unpublished while pointing at a real product.
 *
 * `externalState` survives, and it is the reason this is a function rather than
 * a shorter object literal. The Shopify adapter reads it to decide whether an
 * update sends ACTIVE or DRAFT, so dropping it turns the next edit into an
 * instruction to take a live product off sale. The draft owns adapter metadata;
 * publication owns this one key.
 */
export function rebuildColumns(
  draft: ChannelListingDraft,
  existingMetadata: unknown,
  generatedAt: string,
) {
  const externalState = (existingMetadata as Record<string, unknown> | null)?.externalState

  return {
    ...draftToColumns(draft),
    generated_at: generatedAt,
    metadata: (externalState === undefined
      ? draft.metadata
      : { ...draft.metadata, externalState }) as never,
  }
}

/**
 * The payload written to listing_snapshots.
 *
 * Snapshots exist to answer "what changed before revenue moved", which means
 * the readiness verdict at the time matters as much as the field values. A
 * snapshot holding only the text would leave the more useful half of that
 * question unanswerable.
 */
export function snapshotPayload(
  draft: ChannelListingDraft,
  evaluation: Evaluation,
  /**
   * The images this listing would send, in the order it would send them.
   *
   * Recorded because a snapshot that held only the text would under-report what
   * was published the moment images became publishable, and a history that is
   * silently incomplete is worse than one that is obviously partial: it answers
   * "what changed before revenue moved" with a confident half-truth. Ids and
   * positions rather than URLs, because a signed URL expires and would make the
   * row unreadable a few minutes after it was written.
   */
  images: readonly ProductAsset[] = [],
): Record<string, unknown> {
  return {
    listing: draft,
    images: images.map((asset, position) => ({
      id: asset.id,
      filename: asset.filename,
      assetType: asset.asset_type,
      position,
    })),
    readiness: {
      score: evaluation.readiness.score,
      errorsTotal: evaluation.readiness.errorsTotal,
      errorsResolved: evaluation.readiness.errorsResolved,
      ready: evaluation.readiness.ready,
    },
    requirements: evaluation.results.map((r) => ({
      key: r.key,
      severity: r.severity,
      satisfied: r.satisfied,
      message: r.message,
    })),
  }
}
