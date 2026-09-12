import { createAdminClient } from "@/lib/supabase/admin"
import {
  PRODUCT_ASSET_BUCKET,
  createUploadUrl,
  downloadObject,
  uploadObject,
} from "@/lib/products/storage"
import { PDF_LIMITS } from "./retrieval/pdf"
import { HTML_LIMITS } from "./retrieval/html"
import type { ContentSourceKind } from "./types"

/**
 * Where handed-over sources are kept, and the limits on them.
 *
 * Path convention: `<workspace_id>/import-sources/<upload_id>.<ext>`, in the
 * same private bucket as product assets. The workspace id leads, so the storage
 * policies already written for that bucket cover these objects with no new
 * policy, and the migration's check holds a row's `source_path` to its own
 * workspace's prefix with exactly this shape.
 *
 * **The server builds every path.** A browser names a kind and receives an
 * upload id; it never names a path. `sourcePathFor` is the only function that
 * produces one and `isSourcePathFor` is what the job checks before it reads.
 *
 * Nothing here is ever served. Every object is written as an opaque type — a
 * pasted HTML document stored as `text/html` in a bucket that can mint signed
 * URLs is one careless link away from being rendered on the storage host.
 */

export const SOURCE_EXTENSIONS: Record<ContentSourceKind, "txt" | "pdf" | "html"> = {
  pasted_text: "txt",
  pdf_document: "pdf",
  html_document: "html",
}

export const SOURCE_LIMITS = {
  /** Characters a paste may hold. Well inside the server action body limit. */
  maxPasteCharacters: 200_000,
  maxPdfBytes: PDF_LIMITS.maxBytes,
  maxHtmlBytes: HTML_LIMITS.maxBytes,
} as const

/** The bytes a file of this kind may be. Paste limits are characters, above. */
export function maxBytesFor(kind: "pdf_document" | "html_document"): number {
  return kind === "pdf_document" ? SOURCE_LIMITS.maxPdfBytes : SOURCE_LIMITS.maxHtmlBytes
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

export function sourcePathFor(
  workspaceId: string,
  uploadId: string,
  kind: ContentSourceKind,
): string {
  if (!new RegExp(`^${UUID}$`).test(uploadId)) throw new Error("upload id is not a uuid")
  return `${workspaceId}/import-sources/${uploadId}.${SOURCE_EXTENSIONS[kind]}`
}

/** Whether a stored path is one this workspace's server could have built. */
export function isSourcePathFor(workspaceId: string, path: string): boolean {
  const escaped = workspaceId.replace(/[^0-9a-f-]/gi, "")
  return new RegExp(`^${escaped}/import-sources/${UUID}\\.(txt|html|pdf)$`).test(path)
}

/** Stores pasted text. The server wrote the bytes, so it knows their size. */
export async function storePastedSource(path: string, content: string): Promise<number> {
  const bytes = Buffer.from(content, "utf8")
  await uploadObject(path, bytes, "application/octet-stream")
  return bytes.byteLength
}

export async function createSourceUploadUrl(path: string): Promise<string> {
  const upload = await createUploadUrl(path)
  return upload.signedUrl
}

/**
 * The size of an uploaded object, measured from storage, or null when nothing
 * is there.
 *
 * The browser said how big the file was when it asked to upload; that number
 * decided nothing. This is the number the import is started on.
 */
export async function measureStoredSource(path: string): Promise<number | null> {
  const admin = createAdminClient()
  const slash = path.lastIndexOf("/")
  const { data, error } = await admin.storage
    .from(PRODUCT_ASSET_BUCKET)
    .list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 2 })
  if (error || !data) return null
  const found = data.find((entry) => entry.name === path.slice(slash + 1))
  const size = (found?.metadata as { size?: unknown } | null | undefined)?.size
  return typeof size === "number" ? size : null
}

export async function readStoredSource(path: string): Promise<Buffer> {
  return downloadObject(path)
}

export async function removeStoredSource(path: string): Promise<void> {
  const admin = createAdminClient()
  await admin.storage.from(PRODUCT_ASSET_BUCKET).remove([path])
}
