import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { renderDerivative, specHash, derivativeFilename, type ImageSpec } from "./derivatives"
import { isDerivableImage, sniffMimeType } from "./sniff"
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
  if (asset.asset_state !== "pending") return // already settled; jobs may retry

  try {
    const data = await downloadObject(asset.storage_path)
    const mimeType = sniffMimeType(data)

    await admin
      .from("product_assets")
      .update({
        asset_state: "ready",
        checksum: sha256(data),
        byte_size: data.byteLength,
        mime_type: mimeType,
        failure_reason: null,
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
