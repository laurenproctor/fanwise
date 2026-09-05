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
 *   update    (workspace, listing, content fingerprint). Two different edits are
 *             two different operations and must not collide, or a creator could
 *             only ever push one correction. Two identical edits are one
 *             operation and do collide, which is also right.
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
): string {
  return `update:${workspaceId}:${listingId}:${fingerprint(draft)}`
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

export function keyFor(params: {
  kind: PublicationKind
  workspaceId: string
  listingId: string
  draft: ChannelListingDraft
}): string {
  const { kind, workspaceId, listingId, draft } = params
  switch (kind) {
    case "publish":
      return publishKey(workspaceId, listingId)
    case "activate":
      return activateKey(workspaceId, listingId)
    case "update":
      return updateKey(workspaceId, listingId, draft)
  }
}
