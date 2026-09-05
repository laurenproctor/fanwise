import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Private object storage for product assets.
 *
 * Path convention: <workspace_id>/<product_id>/<asset_id><ext>
 * The workspace id leads so one storage policy expression covers the bucket.
 *
 * SECURITY, and recorded in docs/security.md: a signed upload URL is a bearer
 * capability. It bypasses the storage RLS policies for whoever holds it. The
 * server action that mints one is therefore the authorization boundary, and it
 * builds the path itself from ids it has already checked. A caller never names
 * its own destination, so a signed URL cannot be pointed at another workspace's
 * prefix.
 */

export const PRODUCT_ASSET_BUCKET = "product-assets"

/** Matches the bucket's own limit and the largest package any target channel takes. */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024 * 1024

/** How long an upload capability stays valid. Long enough for a slow 4 GB push. */
const UPLOAD_URL_TTL_SECONDS = 60 * 60 * 4

/** Download links are short lived and minted per click. */
const DOWNLOAD_URL_TTL_SECONDS = 60 * 5

/**
 * How long a link handed to a marketplace stays valid.
 *
 * Much longer than a creator's download link, and for a reason that is not
 * generosity: a provider given a media URL fetches it on its own schedule, in
 * its own queue, after the API call that supplied it has already returned. A
 * five minute link is a product whose image silently fails to appear whenever
 * the provider is busy, which looks like a Fanwise bug and is not debuggable
 * from either end.
 */
const INGEST_URL_TTL_SECONDS = 60 * 60

/**
 * How long a preview link stays valid.
 *
 * Short on purpose, and affordable because of how the route works: an <img>
 * points at /preview, which mints a URL and redirects, so the signed URL only
 * has to survive the browser following one redirect. Nothing holds it, nothing
 * retries against it later, and a signed URL is a bearer capability, so there
 * is no reason to hand out one that outlives the request that asked for it.
 */
const PREVIEW_URL_TTL_SECONDS = 60 * 5

/**
 * The only extension characters that may reach a storage path. Everything else
 * is dropped rather than escaped, because a path is not the place to be clever.
 */
function safeExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(filename.trim())
  return match?.[1] ? `.${match[1].toLowerCase()}` : ""
}

export function buildStoragePath(params: {
  workspaceId: string
  productId: string
  assetId: string
  filename: string
}): string {
  return `${params.workspaceId}/${params.productId}/${params.assetId}${safeExtension(params.filename)}`
}

/**
 * Strips any directory component a browser may have supplied, plus control
 * characters, which would otherwise end up inside a Content-Disposition header.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "file"
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim()
  return cleaned.slice(0, 255) || "file"
}

export async function createUploadUrl(storagePath: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(PRODUCT_ASSET_BUCKET)
    .createSignedUploadUrl(storagePath)

  if (error || !data) throw error ?? new Error("could not create an upload URL")
  return { signedUrl: data.signedUrl, token: data.token, path: storagePath }
}

/**
 * A creator-facing download link.
 *
 * `download` sets Content-Disposition on the signed response, so the file
 * arrives named as the creator named it rather than as the opaque asset uuid
 * the storage path uses. Required by ADR 0001.
 */
export async function createDownloadUrl(storagePath: string, filename: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(PRODUCT_ASSET_BUCKET)
    .createSignedUrl(storagePath, DOWNLOAD_URL_TTL_SECONDS, {
      download: sanitizeFilename(filename),
    })

  if (error || !data) throw error ?? new Error("could not create a download URL")
  return data.signedUrl
}

/**
 * A link for a marketplace to fetch an asset from.
 *
 * Deliberately not `createDownloadUrl`. That one sets Content-Disposition so a
 * creator's browser saves the file under its real name; a provider ingesting
 * media wants the bytes inline, and some reject an attachment response outright.
 * Same bucket, same signing, different purpose, so a different function rather
 * than a boolean argument nobody reads at the call site.
 */
export async function createIngestUrl(storagePath: string): Promise<string> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(PRODUCT_ASSET_BUCKET)
    .createSignedUrl(storagePath, INGEST_URL_TTL_SECONDS)

  if (error || !data) throw error ?? new Error("could not create an ingest URL")
  return data.signedUrl
}

/**
 * A link for Fanwise's own UI to render an image from.
 *
 * The third of the three, and distinct from both. createDownloadUrl sets
 * Content-Disposition, so an <img> pointed at it renders nothing and the
 * browser saves a file instead. createIngestUrl is inline too but lives for an
 * hour because a provider fetches on its own schedule; nothing here does, so
 * this one is short lived. A boolean argument across three call sites would
 * hide exactly the distinctions that matter.
 */
export async function createPreviewUrl(storagePath: string): Promise<string> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(PRODUCT_ASSET_BUCKET)
    .createSignedUrl(storagePath, PREVIEW_URL_TTL_SECONDS)

  if (error || !data) throw error ?? new Error("could not create a preview URL")
  return data.signedUrl
}

export async function downloadObject(storagePath: string): Promise<Buffer> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(PRODUCT_ASSET_BUCKET).download(storagePath)
  if (error || !data) throw error ?? new Error("object not found")
  return Buffer.from(await data.arrayBuffer())
}

export async function uploadObject(
  storagePath: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.storage
    .from(PRODUCT_ASSET_BUCKET)
    .upload(storagePath, data, { contentType, upsert: true })
  if (error) throw error
}

/**
 * Removes objects. Callers delete the object BEFORE the row, never after: an
 * orphaned object with no row is invisible and merely wastes space, while a row
 * with no object is a broken asset the UI keeps offering. See the known
 * limitations in README.md.
 */
export async function removeObjects(storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return
  const admin = createAdminClient()
  const { error } = await admin.storage.from(PRODUCT_ASSET_BUCKET).remove(storagePaths)
  if (error) throw error
}

export const STORAGE_TTL = {
  upload: UPLOAD_URL_TTL_SECONDS,
  download: DOWNLOAD_URL_TTL_SECONDS,
  ingest: INGEST_URL_TTL_SECONDS,
  preview: PREVIEW_URL_TTL_SECONDS,
} as const
