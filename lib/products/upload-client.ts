"use client"

import { createUploadIntent, finalizeUploadAction } from "./actions"
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

  const response = await fetch(intent.intent.signedUrl, {
    method: "PUT",
    body: params.file,
    headers: { "content-type": params.file.type || "application/octet-stream" },
  })

  if (!response.ok) {
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
