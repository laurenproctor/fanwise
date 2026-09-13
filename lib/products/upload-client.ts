"use client"

import { createUploadIntent, finalizeUploadAction } from "./actions"
import {
  confirmStagedSourceAction,
  stageSourceAction,
  type StagedSourceStatus,
} from "@/lib/imports/composer-actions"
import type { AssetType } from "./types"

/**
 * Pushing one file from the browser to storage.
 *
 * Shared by the product page's asset manager and the import screen's buyer
 * files, which were doing the same three steps in two places. The steps are:
 * the server mints a signed URL from ids it has already checked, the browser
 * PUTs the bytes straight to storage, and a job measures what actually landed.
 *
 * **The bytes never pass through a serverless function**, which is what makes a
 * four gigabyte deliverable possible at all, and it is also why nothing the
 * browser says about the file is believed: `finalize_asset` reads the stored
 * object and overwrites the size and the type with what it found.
 *
 * This is the only place in the application where a browser fetches something
 * during an upload, and the URL it fetches is one the server just handed it.
 * `tests/unit/import-source-boundaries.test.ts` holds the import feature to
 * calling this rather than reaching for `fetch` itself — the rule being
 * protected is that no browser ever fetches a URL that came out of an imported
 * page, and a shared helper with one auditable call site is how that stays
 * checkable.
 */
export interface UploadResult {
  assetId: string | null
  /** A creator-readable failure, or null when the file is stored. */
  error: string | null
}

export async function uploadProductFile(params: {
  workspaceSlug: string
  productId: string
  assetType: AssetType
  file: File
}): Promise<UploadResult> {
  const intent = await createUploadIntent(params.workspaceSlug, {
    productId: params.productId,
    assetType: params.assetType,
    filename: params.file.name,
    byteSize: params.file.size,
  })

  if ("error" in intent) return { assetId: null, error: intent.error }

  const stored = await putToSignedUrl(
    intent.intent.signedUrl,
    params.file,
    params.file.type || "application/octet-stream",
  )

  if (!stored) {
    /*
      The asset row stays `pending` and nothing that was already stored has been
      touched. That is what makes replacing a file safe: a failed upload cannot
      take the previous one with it, because the previous one was never part of
      this operation.
    */
    return { assetId: intent.intent.assetId, error: "The upload did not complete. Try again." }
  }

  const finalized = await finalizeUploadAction(params.workspaceSlug, intent.intent.assetId)
  return { assetId: intent.intent.assetId, error: finalized.error }
}

/**
 * The one fetch. Both uploads go through it, and its argument is always a URL
 * the server minted a moment ago — never a string that came out of a page.
 */
async function putToSignedUrl(
  signedUrl: string,
  body: Blob,
  contentType: string,
): Promise<boolean> {
  const response = await fetch(signedUrl, {
    method: "PUT",
    body,
    headers: { "content-type": contentType },
  })
  return response.ok
}

/**
 * Adding a file or a recording to the import composer.
 *
 * The same three steps as a product file, pointed somewhere else: the server
 * records a staged source and mints a signed URL for a path it builds, the
 * browser pushes the bytes, and the server measures and sniffs what landed. The
 * type sent is always opaque, so an HTML file is stored as bytes rather than as
 * a page a signed link could ever render.
 *
 * `onStaged` is called once the row exists, before the bytes move, so the
 * composer can remove the right row if the creator takes the pill away while
 * it uploads.
 */
export async function uploadComposerSource(params: {
  workspaceSlug: string
  body: Blob
  source:
    | { type: "pdf" | "html"; filename: string }
    | { type: "audio"; label: string; durationMs: number; mimeType: string }
  onStaged?: (sourceId: string) => void
}): Promise<StagedSourceStatus | { error: string; sourceId: string | null }> {
  const stage = await stageSourceAction(params.workspaceSlug, {
    ...params.source,
    byteSize: params.body.size,
  })
  if ("error" in stage) return { error: stage.error, sourceId: null }
  params.onStaged?.(stage.sourceId)

  const stored = await putToSignedUrl(stage.signedUrl, params.body, "application/octet-stream")
  if (!stored) {
    return {
      error: "The upload did not complete. Remove it and try again.",
      sourceId: stage.sourceId,
    }
  }

  const confirmed = await confirmStagedSourceAction(params.workspaceSlug, stage.sourceId)
  return "error" in confirmed ? { error: confirmed.error, sourceId: stage.sourceId } : confirmed
}
