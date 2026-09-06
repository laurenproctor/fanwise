import { createHash } from "node:crypto"
import type { ChannelListingDraft } from "@/lib/channels/types"

/**
 * Idempotency keys for external writes.
 *
 * Architecture invariant 3: every external write carries a key that is
 * persisted before the call, in the same transaction as the job row. Here the
 * key is a NOT NULL column with a global unique constraint, so "persisted in
 * the same transaction" is not a discipline anyone has to remember: the insert
 * that creates the job is the insert that claims the key, and there is no way
 * to write one without the other.
 *
 * What goes into a key is the whole design, and the two kinds differ on purpose:
 *
 *   publish   (workspace, listing). Deliberately NOT the content. Two clicks of
 *             Publish on one listing are the same operation whatever was typed
 *             in between, so they must collide. This is the key that makes
 *             "a second click creates nothing" true.
 *
 *   update    (workspace, listing, content fingerprint, image fingerprint). Two
 *             different edits are two different operations and must not
 *             collide, or a creator could only ever push one correction. Two
 *             identical edits are one operation and do collide, which is also
 *             right. Images are in the key because swapping a cover image while
 *             leaving the text alone is a real change the channel must be told
 *             about; without them that edit would collide with the one before
 *             it and silently never be sent.
 *
 *   activate  (workspace, listing). There is one transition from draft to live.
 */

export type PublicationKind = "publish" | "update" | "activate"

export function publishKey(workspaceId: string, listingId: string): string {
  return `publish:${workspaceId}:${listingId}`
}

export function activateKey(workspaceId: string, listingId: string): string {
  return `activate:${workspaceId}:${listingId}`
}

export function updateKey(
  workspaceId: string,
  listingId: string,
  draft: ChannelListingDraft,
  /**
   * A stable summary of the images this update would send, from
   * imagesFingerprint(). Required rather than defaulted: a caller that omitted
   * it would go on producing one key for every image-only edit, which is the
   * precise collision this argument exists to prevent, and a default would let
   * that happen silently. Rule 1 — an idempotency check is never weakened to
   * make a caller more convenient.
   */
  images: string,
): string {
  return `update:${workspaceId}:${listingId}:${sentFingerprint(draft, images)}`
}

/**
 * Everything that would be sent to the provider, as one value.
 *
 * Persisted on the listing after a successful write, and recomputed by the UI
 * to decide whether there is anything left to send. It is the same expression
 * updateKey is built from, deliberately: the question the creator is asked
 * ("is there a change to publish?") and the question the idempotency key
 * answers ("has this exact update already run?") must not be able to disagree
 * about what counts as a change, and sharing the expression is what makes that
 * structural rather than remembered.
 *
 * The image half is hashed rather than interpolated. The fingerprint is a join
 * of asset ids and grows with the gallery; neither the key column, which is
 * unique-indexed, nor the listing row has any reason to carry a kilobyte of
 * uuids.
 */
export function sentFingerprint(draft: ChannelListingDraft, images: string): string {
  const imageDigest = createHash("sha256").update(images).digest("hex").slice(0, 16)
  return `${fingerprint(draft)}:${imageDigest}`
}

/**
 * A stable hash of everything that would be sent to the provider.
 *
 * Field order is fixed by this function rather than by JSON.stringify's
 * iteration order, and tags are sorted, so a listing whose tags were reordered
 * in the editor is not treated as a different update. `metadata` is excluded:
 * it holds Fanwise's own bookkeeping, including the external state written back
 * after a publish, and including it would make every successful publish change
 * the fingerprint of the next update.
 */
export function fingerprint(draft: ChannelListingDraft): string {
  const canonical = JSON.stringify([
    draft.title ?? "",
    draft.description ?? "",
    draft.shortDescription ?? "",
    draft.price ?? "",
    draft.currency,
    draft.category ?? "",
    [...draft.tags].sort(),
  ])
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}

/**
 * A union rather than one shape with an optional `images`.
 *
 * Publish and activate ignore content entirely, so asking them for an image
 * fingerprint would be asking for something meaningless. Update cannot be
 * built without one. Saying that in the type means the compiler refuses the
 * only call that would be wrong, and no caller has to remember the rule.
 */
export type KeyParams =
  | {
      kind: "publish" | "activate"
      workspaceId: string
      listingId: string
      draft: ChannelListingDraft
    }
  | {
      kind: "update"
      workspaceId: string
      listingId: string
      draft: ChannelListingDraft
      images: string
    }

export function keyFor(params: KeyParams): string {
  switch (params.kind) {
    case "publish":
      return publishKey(params.workspaceId, params.listingId)
    case "activate":
      return activateKey(params.workspaceId, params.listingId)
    case "update":
      return updateKey(params.workspaceId, params.listingId, params.draft, params.images)
  }
}
