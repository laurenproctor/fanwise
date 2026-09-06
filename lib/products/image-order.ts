import type { AssetType, ProductAsset } from "./types"

/**
 * Deciding what a drag means, with no database in the room.
 *
 * The action that persists this reads rows, calls the function below, and
 * writes what it returns. Keeping the decision pure is what makes it testable
 * at all: the alternative is asserting against a mocked query builder, which
 * tests the mock rather than the rule.
 */

/**
 * The two roles an image may move between, and the exact pair the ordering
 * migration's trigger permits.
 *
 * Deliberately NOT `IMAGE_ASSET_TYPES`, which is a wider set: a thumbnail and a
 * specimen are images that can produce derivatives, and neither may become a
 * cover. Using the wider list here would send writes the database is right to
 * refuse, and the creator would get a constraint violation instead of a
 * sentence. The narrow pair is the contract; this constant and the trigger have
 * to move together.
 */
export const REORDERABLE_ASSET_TYPES = [
  "cover_image",
  "preview_image",
] as const satisfies readonly AssetType[]

export type ReorderableAssetType = (typeof REORDERABLE_ASSET_TYPES)[number]

export function isReorderable(type: AssetType): type is ReorderableAssetType {
  return (REORDERABLE_ASSET_TYPES as readonly AssetType[]).includes(type)
}

/** The state one asset should end in. */
export interface ImageOrderWrite {
  id: string
  sortOrder: number
  assetType: ReorderableAssetType
}

/**
 * Why an order was refused.
 *
 * `unknown_assets` covers a duplicate id as well as a missing one. Both mean
 * the same thing — the ids the creator dragged do not correspond one-to-one
 * with rows this workspace can see — and both must be refused, because a
 * duplicate would write two positions to one row and drop another asset out of
 * the ordering entirely.
 */
export type ImageOrderRejection = "unknown_assets" | "not_reorderable"

export type ImageOrderPlan =
  { ok: true; writes: ImageOrderWrite[] } | { ok: false; reason: ImageOrderRejection }

/**
 * Position is the model: the first image is the cover, the rest are previews.
 *
 * There is no separate cover picker, so this is the only place the cover is
 * chosen, and it is chosen by where the creator dropped the picture.
 *
 * `found` is what the database returned for these ids, already scoped to the
 * caller's workspace and product. Comparing against it rather than trusting the
 * id list is the authorization check: an id from another workspace does not
 * come back, the counts disagree, and the whole order is refused rather than
 * partially applied.
 */
export function planImageOrder(
  assetIds: readonly string[],
  found: readonly Pick<ProductAsset, "id" | "asset_type">[],
): ImageOrderPlan {
  if (assetIds.length === 0) return { ok: true, writes: [] }

  const byId = new Map(found.map((asset) => [asset.id, asset]))

  // Every id resolves exactly once. A Set of the requested ids catches a
  // duplicate, which a length comparison against `found` would also catch but
  // only by accident of how `.in()` de-duplicates.
  if (new Set(assetIds).size !== assetIds.length) return { ok: false, reason: "unknown_assets" }
  if (assetIds.some((id) => !byId.has(id))) return { ok: false, reason: "unknown_assets" }

  if (assetIds.some((id) => !isReorderable(byId.get(id)!.asset_type))) {
    return { ok: false, reason: "not_reorderable" }
  }

  return {
    ok: true,
    writes: assetIds.map((id, sortOrder) => ({
      id,
      sortOrder,
      assetType: sortOrder === 0 ? "cover_image" : "preview_image",
    })),
  }
}
