import { computeReadiness } from "./readiness"
import { evaluateRequirements } from "./requirements"
import type { ProductAsset } from "@/lib/products/types"
import type { Product } from "@/lib/products/types"
import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelField,
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

/**
 * The fields a listing takes from the product unless it says otherwise.
 *
 * Until 13 September 2026 a build copied these into the row, and a later edit
 * to the product changed nothing: every channel held a snapshot of the words as
 * they were when the listing was made, and a creator who fixed a typo fixed it
 * five times. An empty column now means "whatever the product says", and a
 * value means "this channel says something else".
 *
 * Currency is not one of them because it is not edited on its own: it travels
 * with the price, and an inherited price brings the product's currency with it.
 */
export const INHERITED_FIELDS = ["title", "description", "shortDescription", "price"] as const

export type InheritedField = (typeof INHERITED_FIELDS)[number]

/** The canonical values a listing may inherit. */
export type CanonicalValues = Pick<
  Product,
  | "name"
  | "canonical_title"
  | "canonical_description"
  | "short_description"
  | "base_price"
  | "currency"
>

/** What the product says for one inheritable field. */
export function canonicalValue(
  field: InheritedField,
  product: CanonicalValues,
): string | number | null {
  switch (field) {
    case "title":
      return product.canonical_title ?? product.name
    case "description":
      return product.canonical_description
    case "shortDescription":
      return product.short_description
    case "price":
      return product.base_price === null ? null : Number(product.base_price)
  }
}

/**
 * A stored row as everything downstream should read it: inherited where the
 * column is empty, empty where the channel has no such field.
 *
 * Every reader goes through this — readiness, the adapters, the fingerprint
 * that decides whether there are unsent changes, and the snapshot written when
 * something is published — so "what this listing says" has exactly one answer.
 */
export function resolveDraft(
  draft: ChannelListingDraft,
  product: CanonicalValues,
  adapter: Pick<ChannelAdapter, "fields">,
): ChannelListingDraft {
  const has = (field: ChannelField) => adapter.fields.includes(field)
  const inherited = <T extends string | number>(field: InheritedField, value: T | null) => {
    if (!has(field)) return null
    return (value ?? canonicalValue(field, product)) as T | null
  }

  return {
    ...draft,
    title: inherited("title", draft.title),
    description: inherited("description", draft.description),
    shortDescription: inherited("shortDescription", draft.shortDescription),
    seoTitle: has("seoTitle") ? draft.seoTitle : null,
    seoDescription: has("seoDescription") ? draft.seoDescription : null,
    price: inherited("price", draft.price),
    // An inherited price is quoted in the product's currency; an overridden one
    // in whatever the listing was saved with.
    currency: draft.price === null ? product.currency : draft.currency,
    category: has("category") ? draft.category : null,
    tags: has("tags") ? draft.tags : [],
  }
}

/** A stored row, resolved. The browser resolves the draft it is editing instead. */
export function resolveListing(
  listing: ChannelListing,
  product: CanonicalValues,
  adapter: Pick<ChannelAdapter, "fields">,
): ChannelListing {
  const draft = resolveDraft(listingToDraft(listing), product, adapter)
  return { ...listing, ...draftToColumns(draft) }
}

/** The resolved row as a draft, which is what every rule is written against. */
export function resolvedDraft(
  listing: ChannelListing,
  product: CanonicalValues,
  adapter: Pick<ChannelAdapter, "fields">,
): ChannelListingDraft {
  return resolveDraft(listingToDraft(listing), product, adapter)
}

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
    seoTitle: listing.seo_title,
    seoDescription: listing.seo_description,
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
    seo_title: draft.seoTitle,
    seo_description: draft.seoDescription,
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
 * Two keys survive, and they are the reason this is a function rather than a
 * shorter object literal. The draft owns adapter metadata; publication owns
 * these:
 *
 *   `externalState`  read by the adapter to decide whether an update sends
 *                    ACTIVE or DRAFT. Dropping it turns the next edit into an
 *                    instruction to take a live product off sale.
 *   `purchasable`    read by liveness to decide whether "Live" may be shown.
 *                    Dropping it was a bug that shipped: a rebuild after
 *                    activation erased a recorded `false`, absent reads as
 *                    unknown, and unknown keeps the old answer — so a product
 *                    on no sales channel would have been reported as buyable
 *                    the moment its listing was regenerated. Found on the
 *                    first live run, 7 September 2026, where the erased value
 *                    happened to be `true` and the display happened to stay
 *                    right for the wrong reason.
 */
const PUBLICATION_OWNED_KEYS = ["externalState", "purchasable"] as const

export function rebuildColumns(
  draft: ChannelListingDraft,
  existingMetadata: unknown,
  generatedAt: string,
) {
  const existing = (existingMetadata as Record<string, unknown> | null) ?? {}
  const kept: Record<string, unknown> = {}
  for (const key of PUBLICATION_OWNED_KEYS) {
    if (existing[key] !== undefined) kept[key] = existing[key]
  }

  return {
    ...draftToColumns(draft),
    generated_at: generatedAt,
    metadata: { ...draft.metadata, ...kept } as never,
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
