import type { DraftProduct } from "./profile-draft"
import type { PublicPageStatus } from "./types"

/**
 * One product's place on the profile, decided from its public page.
 *
 * The profile builder remains where the arrangement is made: which products,
 * in what order, published together so the live profile matches its preview.
 * This is the one shortcut it allows, a checkbox on a product's public page,
 * and it stays honest with the builder by writing the builder's own draft
 * rather than a second source of truth. Turning a product on appends it to
 * the arrangement (or turns its existing entry back on, where it was); turning
 * it off leaves the entry in place and switches it off, so turning it on again
 * puts it back in the same spot rather than at the end.
 *
 * Whether the change reaches the public web now depends on two things this
 * checkbox cannot alter: the profile must be published, and the product must be
 * live in a connected shop (the builder's own eligibility rule). Where either
 * is missing the choice is kept and the outcome says what is still owed.
 */

export function withProductShown(
  products: readonly DraftProduct[],
  productId: string,
  visible: boolean,
): DraftProduct[] {
  const present = products.some((entry) => entry.productId === productId)
  if (!present) {
    return visible ? [...products, { productId, visible: true }] : [...products]
  }
  return products.map((entry) => (entry.productId === productId ? { ...entry, visible } : entry))
}

export type ProfileChoiceOutcome =
  /** On the live profile now, last in the order. */
  | "shown"
  /** Chosen; the profile itself is not published yet. */
  | "chosen_until_published"
  /** Chosen; the product is not live in a connected shop, so it cannot show yet. */
  | "kept_until_live"
  /** Off the profile. */
  | "hidden"

export interface ProfileChoicePlan {
  outcome: ProfileChoiceOutcome
  /** Publish this one page onto the live profile, at the end of the order. */
  publishNow: boolean
  /** Return this page to draft so the live profile stops showing it. */
  unpublishPage: boolean
}

export function planProfileChoice(input: {
  onProfile: boolean
  profileStatus: PublicPageStatus
  /** The builder's rule: not archived, and live in at least one connected shop. */
  eligible: boolean
  /** Whether the page is published on the profile today. */
  live: boolean
}): ProfileChoicePlan {
  if (!input.onProfile) {
    return { outcome: "hidden", publishNow: false, unpublishPage: input.live }
  }
  if (input.profileStatus !== "published") {
    return { outcome: "chosen_until_published", publishNow: false, unpublishPage: false }
  }
  if (!input.eligible) {
    return { outcome: "kept_until_live", publishNow: false, unpublishPage: false }
  }
  return { outcome: "shown", publishNow: !input.live, unpublishPage: false }
}

export const PROFILE_CHOICE_TEXT: Record<ProfileChoiceOutcome, string> = {
  shown: "Shown on your public profile, last in the order.",
  chosen_until_published: "Chosen for your profile. It appears once you publish the profile.",
  kept_until_live:
    "Chosen for your profile. It shows once the product is live in a connected shop.",
  hidden: "Not on your public profile.",
}
