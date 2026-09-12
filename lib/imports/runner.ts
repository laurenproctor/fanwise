import { createAdminClient } from "@/lib/supabase/admin"
import { buildStoragePath, uploadObject } from "@/lib/products/storage"
import type { AiProvider } from "@/lib/ai/types"
import { composeDraft, type ComposeDeps } from "./compose"
import { ImportError, normalizeImportError, statusForImportError } from "./errors"
import { toJson } from "./json"
import { parseEvidence, type ProductSourceEvidence, type SourceAsset } from "./evidence"
import { fetchPage, type FetchPageOptions } from "./retrieval/fetch-page"
import { AssetSkipped, ASSET_LIMITS, fetchAsset } from "./retrieval/fetch-asset"
import { importerFor } from "./sources/registry"
import { CONTENT_IMPORTERS } from "./sources/content"
import { isSourcePathFor, readStoredSource } from "./source-storage"
import { isContentSourceKind, type SourceKind } from "./types"

/**
 * One import, run to a recorded end.
 *
 * Runs in a background job holding the service role, so every query scopes
 * `workspace_id` by hand, per docs/security.md rule 4. The workspace comes from
 * the job payload, which came from a row an authorized member inserted through
 * RLS; nothing here trusts an argument beyond that.
 *
 * What it does, in order, and what each step writes:
 *
 *   1. claim the row              pending|failed -> retrieving
 *   2. read the page, or the      resolved_url (links only)
 *      stored paste or file
 *   3. extract evidence           evidence, content_hash, retrieved_at
 *   4. fetch the pictures         product_assets rows, evidence.previewAssets
 *   5. compose a draft            suggestions, prompt_version, schema_version
 *   6. settle                     ready, or unavailable/failed with a code
 *
 * Three properties worth holding on to:
 *
 * **Nothing reaches `products`.** Not a title, not a price, not a tag. The
 * product row exists because the action made one; this job fills in an import
 * beside it and a person moves values across on the review screen.
 *
 * **An unchanged page composes nothing.** Step 3 hashes what it extracted; if
 * the hash matches what the row already carries and suggestions are already
 * there, step 5 is skipped. A refresh therefore costs one HTTP request and no
 * model call, and — the part that matters — cannot overwrite anything.
 *
 * **`accepted` is never written here.** It holds what the creator settled, and
 * a job that re-read a page has learned nothing about their decisions.
 */

export interface RunImportPayload {
  workspaceId: string
  importId: string
}

export interface RunImportDeps extends ComposeDeps, FetchPageOptions {
  provider?: AiProvider
  /** Test seam. Production reads the stored object from the private bucket. */
  readSource?: (path: string) => Promise<Uint8Array>
}

type Admin = ReturnType<typeof createAdminClient>

export async function runImport(
  payload: RunImportPayload,
  deps: RunImportDeps = {},
): Promise<void> {
  const { workspaceId, importId } = payload
  const admin = createAdminClient()

  /*
    Claim by compare-and-swap, so a redelivered job does nothing. `failed` is
    claimable as well as `pending` because retrying a failure is the whole
    point of the retry button; `ready` and `unavailable` are not, because
    re-reading those is an explicit refresh that resets the row first.
  */
  const { data: claimed, error: claimError } = await admin
    .from("product_imports")
    .update({ status: "retrieving", error_code: null, error_message: null })
    .eq("id", importId)
    .eq("workspace_id", workspaceId)
    .in("status", ["pending", "failed"])
    .select(
      "id, product_id, source_url, source_path, source_filename, provider, content_hash, suggestions",
    )
    .maybeSingle()

  if (claimError) {
    console.error("[imports] could not claim the import", { importId, error: claimError })
    return
  }
  if (!claimed) return

  try {
    await execute(admin, workspaceId, importId, claimed, deps)
  } catch (error) {
    // Nothing below may leave the row `retrieving`: an import stuck there holds
    // the URL's unique index and the creator can never import that link again.
    const normalized = normalizeImportError(error)
    console.error("[imports] import failed outside normalization", {
      importId,
      code: normalized.code,
      name: error instanceof Error ? error.name : "unknown",
    })
    await settleWithError(admin, workspaceId, importId, normalized)
  }
}

async function settleWithError(
  admin: Admin,
  workspaceId: string,
  importId: string,
  error: ImportError,
): Promise<void> {
  await admin
    .from("product_imports")
    .update({
      status: statusForImportError(error.code),
      error_code: error.code,
      error_message: error.userMessage,
    })
    .eq("id", importId)
    .eq("workspace_id", workspaceId)
}

async function execute(
  admin: Admin,
  workspaceId: string,
  importId: string,
  row: {
    product_id: string
    provider: SourceKind
    source_url: string | null
    source_path: string | null
    source_filename: string | null
    content_hash: string | null
    suggestions: unknown
  },
  deps: RunImportDeps,
): Promise<void> {
  let evidence: ProductSourceEvidence

  try {
    evidence = await readSource(workspaceId, row, deps)
  } catch (error) {
    await settleWithError(admin, workspaceId, importId, normalizeImportError(error))
    return
  }

  const unchanged = row.content_hash !== null && row.content_hash === evidence.contentHash
  const hasSuggestions =
    typeof row.suggestions === "object" &&
    row.suggestions !== null &&
    Object.keys(row.suggestions as Record<string, unknown>).length > 0

  // Pictures are fetched even on an unchanged page, because a previous run may
  // have been the one that failed to reach them.
  const withAssets = await attachAssets(admin, workspaceId, row.product_id, evidence)

  await admin
    .from("product_imports")
    .update({
      status: "analyzing",
      resolved_url: withAssets.resolvedUrl ?? null,
      content_hash: withAssets.contentHash,
      evidence: toJson(withAssets),
      retrieved_at: withAssets.retrievedAt,
    })
    .eq("id", importId)
    .eq("workspace_id", workspaceId)

  if (unchanged && hasSuggestions) {
    // The page has not changed and a draft already exists. Composing again
    // would spend a model call to produce different words for the same facts,
    // and would invite a creator's edits to be argued with.
    await admin
      .from("product_imports")
      .update({ status: "ready", analyzed_at: new Date().toISOString() })
      .eq("id", importId)
      .eq("workspace_id", workspaceId)
    return
  }

  try {
    const composed = await composeDraft(withAssets, { provider: deps.provider })
    await admin
      .from("product_imports")
      .update({
        status: "ready",
        suggestions: toJson({
          draft: composed.draft,
          withheld: composed.withheld,
          violations: composed.violations,
          provider: composed.provider,
          model: composed.model,
          inputHash: composed.inputHash,
        }),
        prompt_version: composed.promptVersion,
        schema_version: composed.schemaVersion,
        analyzed_at: new Date().toISOString(),
      })
      .eq("id", importId)
      .eq("workspace_id", workspaceId)
  } catch (error) {
    /*
      The page was read and the evidence is saved. A missing model is not a
      failed import — the creator writes the listing themselves, from evidence
      Fanwise did gather — so the row settles `ready` with the reason recorded
      rather than `failed` with everything thrown away.
    */
    const normalized = normalizeImportError(error)
    if (normalized.code === "ai_unavailable") {
      await admin
        .from("product_imports")
        .update({
          status: "ready",
          error_code: null,
          error_message: null,
          suggestions: toJson({
            draft: { missingInformation: [] },
            withheld: [],
            unavailable: true,
          }),
          analyzed_at: new Date().toISOString(),
        })
        .eq("id", importId)
        .eq("workspace_id", workspaceId)
      return
    }
    await settleWithError(admin, workspaceId, importId, normalized)
  }
}

/**
 * The evidence for one row, from wherever its source is.
 *
 * A link is fetched through the outbound boundary, as it always was. A paste
 * or a file is read from private storage — and only after the path has been
 * checked against the workspace this job is running for. The database checks
 * the same thing when the row is written; this is the second lock on the same
 * door, because the service role reading another workspace's object is the one
 * mistake here that crosses a tenant boundary.
 */
async function readSource(
  workspaceId: string,
  row: {
    provider: SourceKind
    source_url: string | null
    source_path: string | null
    source_filename: string | null
  },
  deps: RunImportDeps,
): Promise<ProductSourceEvidence> {
  if (isContentSourceKind(row.provider)) {
    if (!row.source_path || !isSourcePathFor(workspaceId, row.source_path)) {
      throw new ImportError("internal", { reason: "source_path" })
    }
    let bytes: Uint8Array
    try {
      bytes = await (deps.readSource ?? readStoredSource)(row.source_path)
    } catch (error) {
      throw new ImportError("internal", { reason: "storage", name: (error as Error)?.name })
    }
    return CONTENT_IMPORTERS[row.provider].read({
      bytes,
      filename: row.source_filename,
    })
  }

  if (!row.source_url) throw new ImportError("internal", { reason: "source_url" })
  const page = await fetchPage(row.source_url, { outbound: deps.outbound })
  return importerFor(new URL(row.source_url)).read(page, row.source_url)
}

/**
 * Fetches the pictures a page advertised into the product's own assets.
 *
 * Each one is a URL a stranger chose, so each goes through the same outbound
 * boundary and the same signature and dimension checks; an asset that fails any
 * of them is recorded with the reason rather than dropped, because a creator
 * needs to know which picture to add by hand.
 *
 * The first becomes the cover image and the rest previews, which is the order
 * `listingImageSlots` already reads.
 */
async function attachAssets(
  admin: Admin,
  workspaceId: string,
  productId: string,
  evidence: ProductSourceEvidence,
): Promise<ProductSourceEvidence> {
  const attached: SourceAsset[] = []
  let kept = 0

  for (const asset of evidence.previewAssets) {
    if (kept >= ASSET_LIMITS.maxAssets) {
      attached.push({ ...asset, skipped: "limit" })
      continue
    }

    try {
      const fetched = await fetchAsset(asset.sourceUrl)
      const assetId = crypto.randomUUID()
      const filename = filenameFor(asset.sourceUrl, fetched.mimeType)
      const storagePath = buildStoragePath({ workspaceId, productId, assetId, filename })

      await uploadObject(storagePath, fetched.bytes, fetched.mimeType)

      const { error } = await admin.from("product_assets").insert({
        id: assetId,
        workspace_id: workspaceId,
        product_id: productId,
        asset_type: kept === 0 ? "cover_image" : "preview_image",
        // Measured here from the bytes that were stored, so `ready` is honest:
        // nothing is being taken on trust from the page or from a header.
        asset_state: "ready",
        storage_path: storagePath,
        filename,
        checksum: fetched.checksum,
        byte_size: fetched.byteSize,
        mime_type: fetched.mimeType,
      })

      if (error) {
        console.error("[imports] could not record a preview asset", { productId, error })
        attached.push({ ...asset, skipped: "unreachable" })
        continue
      }

      attached.push({
        ...asset,
        assetId,
        mimeType: fetched.mimeType,
        byteSize: fetched.byteSize,
        width: fetched.width,
        height: fetched.height,
      })
      kept += 1
    } catch (error) {
      const reason = error instanceof AssetSkipped ? error.reason : "unreachable"
      attached.push({ ...asset, skipped: reason })
    }
  }

  return { ...evidence, previewAssets: attached }
}

/** A storage filename from a URL, with the extension the bytes earned. */
function filenameFor(sourceUrl: string, mimeType: string): string {
  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin"
  let stem = "preview"
  try {
    const last = new URL(sourceUrl).pathname.split("/").pop() ?? ""
    const cleaned = last.replace(/\.[A-Za-z0-9]{1,8}$/, "").replace(/[^A-Za-z0-9_-]/g, "-")
    if (cleaned.length > 0) stem = cleaned.slice(0, 60)
  } catch {
    // The default stands. A filename is a convenience, not a correctness
    // property: the storage path is built from ids.
  }
  return `${stem}.${extension}`
}

/** Evidence from a row, for anything reading an import back. */
export function evidenceOf(row: { evidence: unknown }): ProductSourceEvidence | null {
  return parseEvidence(row.evidence)
}
