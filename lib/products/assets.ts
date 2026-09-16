import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { renderDerivative, specHash, derivativeFilename, type ImageSpec } from "./derivatives"
import { isDerivableImage, sniffMimeType } from "./sniff"
import { describeUpload, isUnreadFont } from "@/lib/fonts/read-upload"
import type { ProductAsset } from "./types"
import { toJson } from "@/lib/imports/json"
import {
  buildStoragePath,
  downloadObject,
  removeObjects,
  uploadObject,
  sanitizeFilename,
} from "./storage"

/**
 * Asset finalization and derivative building.
 *
 * Both run as background jobs, so both use the service-role client and BYPASS
 * RLS. Per docs/security.md rule 4 every function here therefore scopes the
 * workspace itself, in code: the workspace id travels in the job payload and is
 * matched on every query. The database will not do it for you here.
 */

export interface FinalizeAssetPayload {
  workspaceId: string
  assetId: string
}

export interface BuildDerivativePayload {
  workspaceId: string
  sourceAssetId: string
  spec: ImageSpec
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

/**
 * Verifies an uploaded object and moves the row to ready.
 *
 * Everything recorded here is measured from the stored bytes. Nothing the client
 * claimed about size or type is trusted, because the client uploaded straight to
 * storage and could have sent anything.
 *
 * Run again for a row that is already ready, it completes the one measurement
 * that can be missing, a font's reading (`completeReading`), and otherwise does
 * nothing. A failed row is never revisited: the creator replaces it.
 */
export async function finalizeAsset(payload: FinalizeAssetPayload): Promise<void> {
  const admin = createAdminClient()

  const { data: asset, error } = await admin
    .from("product_assets")
    .select("*")
    .eq("id", payload.assetId)
    .eq("workspace_id", payload.workspaceId) // service role bypasses RLS; scope by hand
    .maybeSingle()

  if (error) throw error
  if (!asset) throw new Error("asset not found")
  if (asset.asset_state === "ready") {
    await completeReading(admin, asset, payload.workspaceId)
    return
  }
  if (asset.asset_state !== "pending") return // failed; jobs may retry, creators replace

  try {
    const data = await downloadObject(asset.storage_path)
    const mimeType = sniffMimeType(data)
    // What a font says about itself, or an image's dimensions. Measured here
    // with everything else, and written in the same update so a ready font is
    // never briefly a font with no reading.
    const described = await describeUpload(data, mimeType)

    await admin
      .from("product_assets")
      .update({
        asset_state: "ready",
        checksum: sha256(data),
        byte_size: data.byteLength,
        mime_type: mimeType,
        failure_reason: null,
        ...(described
          ? {
              metadata: toJson({
                ...((asset.metadata as Record<string, unknown>) ?? {}),
                ...described,
              }),
            }
          : {}),
      })
      .eq("id", asset.id)
      .eq("workspace_id", payload.workspaceId)
  } catch (cause) {
    // Rule 8: persist the original, show the creator something they can act on.
    console.error("[assets] finalize failed", { assetId: asset.id, cause })
    await admin
      .from("product_assets")
      .update({
        asset_state: "failed",
        failure_reason: "The upload could not be verified. Try uploading the file again.",
      })
      .eq("id", asset.id)
      .eq("workspace_id", payload.workspaceId)
  }
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Reads a ready font whose reading never landed.
 *
 * The reading is written by the same update that makes a row ready, so a
 * ready font with none was settled by a worker built before fonts were read.
 * Worker deploys are by hand and lag behind `main`; the font workspace asks
 * for this on every such row it shows, and a re-upload is never needed.
 *
 * The row's bytes, type and checksum are correct and immutable, and stay so:
 * only `metadata` is written, which the immutability trigger permits, and only
 * when the reading is absent, so a second request is a no-op, not a rewrite.
 * A failure here throws rather than marking the row failed. The file is fine,
 * and a download that did not complete is worth the queue's retry.
 */
async function completeReading(
  admin: AdminClient,
  asset: ProductAsset,
  workspaceId: string,
): Promise<void> {
  if (!isUnreadFont(asset.mime_type, asset.metadata)) return

  const data = await downloadObject(asset.storage_path)
  const described = await describeUpload(data, asset.mime_type!)
  if (!described) return

  const { error } = await admin
    .from("product_assets")
    .update({
      metadata: toJson({
        ...((asset.metadata as Record<string, unknown>) ?? {}),
        ...described,
      }),
    })
    .eq("id", asset.id)
    .eq("workspace_id", workspaceId)

  if (error) throw error
}

export interface BuildDerivativeResult {
  assetId: string
  cached: boolean
}

/**
 * Builds one derivative, or returns the existing one.
 *
 * The cache is (derived_from, spec_hash), enforced by a unique index. There is
 * no checksum in the key and there does not need to be: a ready asset's bytes
 * are immutable, so derived_from already pins the input exactly.
 */
export async function buildDerivative(
  payload: BuildDerivativePayload,
): Promise<BuildDerivativeResult> {
  const admin = createAdminClient()
  const hash = specHash(payload.spec)

  const { data: source, error: sourceError } = await admin
    .from("product_assets")
    .select("*")
    .eq("id", payload.sourceAssetId)
    .eq("workspace_id", payload.workspaceId)
    .maybeSingle()

  if (sourceError) throw sourceError
  if (!source) throw new Error("source asset not found")
  if (source.asset_state !== "ready") throw new Error("source asset is not ready")
  if (!source.mime_type || !isDerivableImage(source.mime_type)) {
    throw new Error(`cannot derive an image from ${source.mime_type ?? "unknown content"}`)
  }

  const { data: existing } = await admin
    .from("product_assets")
    .select("id")
    .eq("derived_from", source.id)
    .eq("spec_hash", hash)
    .maybeSingle()

  if (existing) return { assetId: existing.id, cached: true }

  const bytes = await downloadObject(source.storage_path)
  const rendered = await renderDerivative(bytes, payload.spec)

  const assetId = crypto.randomUUID()
  const filename = derivativeFilename(payload.spec, source.filename)
  const storagePath = buildStoragePath({
    workspaceId: payload.workspaceId,
    productId: source.product_id,
    assetId,
    filename,
  })

  await uploadObject(storagePath, rendered.data, `image/${rendered.format}`)

  const { data: inserted, error: insertError } = await admin
    .from("product_assets")
    .insert({
      id: assetId,
      workspace_id: payload.workspaceId,
      product_id: source.product_id,
      asset_type: "preview_image",
      asset_state: "ready",
      storage_path: storagePath,
      filename,
      mime_type: `image/${rendered.format}`,
      byte_size: rendered.byteSize,
      checksum: sha256(rendered.data),
      derived_from: source.id,
      spec_hash: hash,
      sort_order: source.sort_order,
      metadata: {
        specKey: payload.spec.key,
        width: rendered.width,
        height: rendered.height,
        quality: rendered.quality,
      },
    })
    .select("id")
    .single()

  if (insertError) {
    // A concurrent build won the unique index. Clean up our object and use theirs.
    await removeObjects([storagePath]).catch(() => {})
    const { data: winner } = await admin
      .from("product_assets")
      .select("id")
      .eq("derived_from", source.id)
      .eq("spec_hash", hash)
      .maybeSingle()
    if (winner) return { assetId: winner.id, cached: true }
    throw insertError
  }

  return { assetId: inserted.id, cached: false }
}

/**
 * Deletes an asset and everything derived from it.
 *
 * Object first, row second, always. An object with no row merely wastes space
 * and is invisible; a row with no object is a broken asset the UI keeps
 * offering. See the known limitations in README.md.
 */
export async function deleteAssetCascade(workspaceId: string, assetId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .from("product_assets")
    .select("id, storage_path")
    .eq("workspace_id", workspaceId)
    .or(`id.eq.${assetId},derived_from.eq.${assetId}`)

  if (error) throw error
  if (!rows || rows.length === 0) return

  await removeObjects(rows.map((r) => r.storage_path))

  await admin
    .from("product_assets")
    .delete()
    .eq("workspace_id", workspaceId)
    .in(
      "id",
      rows.map((r) => r.id),
    )
}

export { sanitizeFilename }
