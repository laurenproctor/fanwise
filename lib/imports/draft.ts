import { productNameSchema } from "@/lib/products/schemas"
import { PRODUCT_TYPES, type ProductType } from "@/lib/products/types"
import {
  LISTING_FIELD_KEYS,
  type DraftField,
  type ListingDraft,
  type ListingFieldKey,
} from "./types"

/**
 * The master listing draft: what it must contain, and who last touched it.
 *
 * Validation reuses `productNameSchema` from the canonical product rather than
 * restating a length. Two rules for the same field, written twice, disagree
 * eventually, and the one the import screen enforces would be the one nobody
 * remembered to change.
 *
 * Everything here is pure and total. `readiness.ts` is the only caller that
 * matters, and it is what turns an issue into a blocked step.
 */

export const LISTING_FIELD_LABELS: Record<ListingFieldKey, string> = {
  title: "Product name",
  productType: "Product type",
  price: "Price",
  currency: "Currency",
  description: "Description",
  tags: "Tags",
}

/** The fields a listing cannot be called complete without. Tags are not one. */
export const REQUIRED_LISTING_FIELDS = [
  "title",
  "productType",
  "price",
  "currency",
  "description",
] as const satisfies readonly ListingFieldKey[]

export interface ListingIssue {
  readonly field: ListingFieldKey
  readonly message: string
}

function field<T>(value: T, origin: DraftField<T>["origin"] = { kind: "creator" }): DraftField<T> {
  return { value, origin }
}

/** A draft with nothing in it, for "Start manually" and for tests. */
export function emptyListingDraft(): ListingDraft {
  return {
    title: field(""),
    productType: field<ProductType | null>(null),
    price: field(""),
    currency: field("USD"),
    description: field(""),
    tags: field<readonly string[]>([]),
  }
}

/**
 * Every required field that does not yet pass, in field order.
 *
 * Returns all of them rather than the first, because the checklist names one
 * next step and the form marks every field that needs attention, and those are
 * two different questions asked of the same answer.
 */
export function listingIssues(draft: ListingDraft): ListingIssue[] {
  const issues: ListingIssue[] = []

  const name = productNameSchema.safeParse(draft.title.value)
  if (!name.success) {
    issues.push({
      field: "title",
      message: name.error.issues[0]?.message ?? "Give the product a name.",
    })
  }

  if (draft.productType.value === null || !PRODUCT_TYPES.includes(draft.productType.value)) {
    issues.push({ field: "productType", message: "Choose what kind of product this is." })
  }

  const price = draft.price.value.trim()
  const amount = Number(price)
  if (price.length === 0) {
    issues.push({ field: "price", message: "Set a price. Enter 0 to give it away." })
  } else if (!Number.isFinite(amount) || amount < 0) {
    issues.push({ field: "price", message: "Enter a price of zero or more." })
  }

  if (!/^[A-Za-z]{3}$/.test(draft.currency.value.trim())) {
    issues.push({ field: "currency", message: "Use a three-letter currency code." })
  }

  if (draft.description.value.trim().length === 0) {
    issues.push({ field: "description", message: "Say what a buyer is getting." })
  }

  return issues
}

/**
 * Fields holding a value a model proposed that nobody has looked at yet.
 *
 * This is the list that blocks the Listing step, and the reason it blocks is
 * architecture invariant 5. A suggested description that reached the canonical
 * product unreviewed would enter the FactSheet, and every later generation for
 * every other channel would be free to restate it as fact — a claim Fanwise
 * invented here and then believed. A person looking at it is the whole defence,
 * so the step is not complete until one has.
 */
export function fieldsAwaitingReview(draft: ListingDraft): ListingFieldKey[] {
  return LISTING_FIELD_KEYS.filter((key) => {
    const origin = draft[key].origin
    return origin.kind === "suggested" && !origin.reviewed
  })
}

/** Whether any field on the draft was proposed by a model at all. */
export function hasSuggestions(draft: ListingDraft): boolean {
  return LISTING_FIELD_KEYS.some((key) => draft[key].origin.kind === "suggested")
}

/**
 * A field the creator typed into.
 *
 * Editing is itself a review, and it is a stronger one than a checkbox: the
 * value is now theirs. So the origin becomes `creator` and the field leaves the
 * awaiting-review list whether or not it was ever marked.
 */
export function setListingField<K extends ListingFieldKey>(
  draft: ListingDraft,
  key: K,
  value: ListingDraft[K]["value"],
): ListingDraft {
  return { ...draft, [key]: { value, origin: { kind: "creator" } } }
}

/**
 * Records that a person has read the suggested values.
 *
 * Marks rather than rewrites: the values keep their `suggested` origin, so the
 * screen goes on saying which fields a model wrote after the creator has
 * accepted them. Losing that marker at the moment of acceptance would erase
 * exactly the provenance the next reader needs.
 */
export function markSuggestionsReviewed(draft: ListingDraft): ListingDraft {
  return {
    title: reviewed(draft.title),
    productType: reviewed(draft.productType),
    price: reviewed(draft.price),
    currency: reviewed(draft.currency),
    description: reviewed(draft.description),
    tags: reviewed(draft.tags),
  }
}

/**
 * One field, marked read.
 *
 * Written per field and listed explicitly above rather than looped over
 * `LISTING_FIELD_KEYS`, because a loop cannot keep `DraftField<T>` and `T`
 * together across an index and the only way to make it compile is an `any`.
 * Six lines of repetition are cheaper than a hole in the types.
 */
function reviewed<T>(current: DraftField<T>): DraftField<T> {
  if (current.origin.kind !== "suggested" || current.origin.reviewed) return current
  return { value: current.value, origin: { kind: "suggested", reviewed: true } }
}
