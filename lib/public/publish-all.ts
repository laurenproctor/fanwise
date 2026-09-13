import type { Ineligibility, ProductCandidate } from "./product-arrangement"

/**
 * "Publish all products on my profile", decided before anything is written.
 *
 * The control's whole meaning is public Fanwise visibility. It puts products
 * on the creator's profile at /@handle; it never submits, publishes or syncs
 * anything to a channel, and nothing here reads a listing for any purpose but
 * eligibility.
 *
 * ## What makes a product eligible
 *
 * The same two facts step 2 of the builder uses (product-arrangement.ts), so
 * the bulk action and the per-product switch can never disagree:
 *
 *   - it is not archived, and
 *   - at least one of its listings is live in a connected shop, because a
 *     product card on a profile is a way to buy, and a product with nowhere
 *     to buy it would be a card that leads nowhere.
 *
 * Every other field a public product page shows (title, type, image, price)
 * has a fallback on the canonical product, so none of them blocks publishing.
 *
 * ## Who is in which group
 *
 *   - `toPublish`: eligible and not on the live profile yet. This is the count
 *     the confirmation states and the list the action sends.
 *   - `alreadyShown`: eligible and live already. Untouched.
 *   - `needsAttention`: not archived but not live anywhere. Named, each with a
 *     link to its product, so nothing is skipped silently.
 *   - archived products are counted and otherwise left out: archiving is a
 *     decision already made, not something to fix.
 *
 * It applies to the products that exist now. A product created later is not
 * published by it; step 2 of the builder adds new products hidden, on purpose.
 */

export interface PublishAllPlan {
  toPublish: ProductCandidate[]
  alreadyShown: ProductCandidate[]
  needsAttention: ProductCandidate[]
  archivedCount: number
}

export function planPublishAll(
  candidates: readonly ProductCandidate[],
  liveProductIds: ReadonlySet<string>,
): PublishAllPlan {
  const plan: PublishAllPlan = {
    toPublish: [],
    alreadyShown: [],
    needsAttention: [],
    archivedCount: 0,
  }
  for (const candidate of candidates) {
    if (candidate.eligibility.eligible) {
      if (liveProductIds.has(candidate.id)) plan.alreadyShown.push(candidate)
      else plan.toPublish.push(candidate)
    } else if (candidate.eligibility.reason === "archived") {
      plan.archivedCount += 1
    } else {
      plan.needsAttention.push(candidate)
    }
  }
  return plan
}

export const ATTENTION_REASONS: Record<Exclude<Ineligibility, "archived">, string> = {
  not_live: "Not live in a connected shop yet. Publish a listing first.",
}

/**
 * Which of the ids a creator confirmed may still be published. The screen's
 * list was right when it rendered; by the time Confirm is pressed a product
 * may have been archived or taken down. The action publishes the overlap and
 * reports the rest, rather than trusting the browser's list.
 */
export function confirmedAndEligible(
  confirmed: readonly string[],
  plan: PublishAllPlan,
): { ids: string[]; noLongerEligible: number } {
  const eligible = new Set(plan.toPublish.map((candidate) => candidate.id))
  const ids = [...new Set(confirmed)].filter((id) => eligible.has(id))
  return { ids, noLongerEligible: new Set(confirmed).size - ids.length }
}
