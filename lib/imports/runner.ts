import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildStoragePath, uploadObject } from "@/lib/products/storage"
import type { AiProvider } from "@/lib/ai/types"
import { jobs, type JobQueue } from "@/lib/jobs"
import { composeDraftFromSources, type ComposeDeps } from "./compose"
import { detectConflicts, type LabelledEvidence } from "./conflicts"
import { ImportError, normalizeImportError, statusForImportError } from "./errors"
import { toJson } from "./json"
import { parseEvidence, type ProductSourceEvidence, type SourceAsset } from "./evidence"
import { fetchPage, type FetchPageOptions } from "./retrieval/fetch-page"
import { AssetSkipped, ASSET_LIMITS, fetchAsset } from "./retrieval/fetch-asset"
import { importerFor } from "./sources/registry"
import { CONTENT_IMPORTERS } from "./sources/content"
import { isSourcePathFor, readStoredSource } from "./source-storage"
import {
  CONTENT_KIND_FOR_TYPE,
  isTerminalSourceStatus,
  type ImportSourceStatus,
  type ImportSourceType,
} from "./types"

/**
 * One import session, run to a recorded end.
 *
 * Runs in background jobs holding the service role, so every query scopes
 * `workspace_id` by hand, per docs/security.md rule 4. The workspace comes from
 * the job payload, which came from a row an authorized member inserted through
 * RLS; nothing here trusts an argument beyond that.
 *
 * An import is a session of sources. Each source is read by its own job, and
 * one source failing never stops another. When the last source settles, the
 * session composes one draft from every source that was read:
 *
 *   import_source { importId }            advance: queue a job per pending source,
 *                                         or compose if none is left
 *   import_source { importId, sourceId }  read one source, then try to compose
 *
 * Properties worth holding on to:
 *
 * **Nothing reaches `products`.** A person moves values across on the review
 * screen and not before (architecture invariant 5).
 *
 * **Every step claims by compare-and-swap.** A redelivered job, two sources
 * finishing at once, and a retry racing a composition all do their work once.
 *
 * **Unchanged evidence composes nothing.** The session's `content_hash` is the
 * hash of every readable source's own hash, in order. A refresh, a redelivery
 * or a retry that reads the same words again costs no model call and cannot
 * overwrite what was proposed.
 *
 * **`accepted` is never written here.**
 */

export interface RunImportPayload {
  workspaceId: string
  importId: string
  /** Present to read one source; absent to advance the session. */
  sourceId?: string
}

export interface RunImportDeps extends ComposeDeps, FetchPageOptions {
  provider?: AiProvider
  /** Test seam. Production reads the stored object from the private bucket. */
  readSource?: (path: string) => Promise<Uint8Array>
  /** Test seam. Production hands off to the configured queue. */
  queue?: JobQueue
}

type Admin = ReturnType<typeof createAdminClient>

export interface SourceRow {
  id: string
  source_type: ImportSourceType
  status: ImportSourceStatus
  position: number
  display_name: string
  source_url: string | null
  storage_path: string | null
  text_content: string | null
  content_hash: string | null
  evidence: unknown
  error_code: string | null
}

const SOURCE_COLUMNS =
  "id, source_type, status, position, display_name, source_url, storage_path, text_content, content_hash, evidence, error_code"

export async function runImport(
  payload: RunImportPayload,
  deps: RunImportDeps = {},
): Promise<void> {
  const admin = createAdminClient()
  if (payload.sourceId) {
    await readOneSource(admin, payload.workspaceId, payload.importId, payload.sourceId, deps)
  } else {
    await advanceSession(admin, payload.workspaceId, payload.importId, deps)
  }
}

/* -------------------------------------------------------------- advancing */

/** Queues a job for every source waiting to be read, or composes if none is. */
export async function advanceSession(
  admin: Admin,
  workspaceId: string,
  importId: string,
  deps: RunImportDeps,
): Promise<void> {
  const sources = await loadSources(admin, workspaceId, importId)
  const waiting = sources.filter((source) => source.status === "pending")

  if (waiting.length === 0) {
    await composeSession(admin, workspaceId, importId, deps)
    return
  }

  const queue = deps.queue ?? jobs
  for (const source of waiting) {
    await queue.enqueue(
      "import_source",
      { workspaceId, importId, sourceId: source.id },
      // No delivery key: the source's own compare-and-swap is what makes a
      // second delivery a no-op, and a retry has to be able to queue again.
    )
  }
}

async function loadSources(
  admin: Admin,
  workspaceId: string,
  importId: string,
): Promise<SourceRow[]> {
  const { data, error } = await admin
    .from("product_import_sources")
    .select(SOURCE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("import_id", importId)
    .neq("status", "removed")
    .order("position", { ascending: true })

  if (error) {
    console.error("[imports] could not load sources", { importId, error })
    return []
  }
  return (data ?? []) as SourceRow[]
}

/* ------------------------------------------------------------ one source */

async function readOneSource(
  admin: Admin,
  workspaceId: string,
  importId: string,
  sourceId: string,
  deps: RunImportDeps,
): Promise<void> {
  const { data: claimed, error: claimError } = await admin
    .from("product_import_sources")
    .update({ status: "reading", error_code: null, error_message: null })
    .eq("id", sourceId)
    .eq("import_id", importId)
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .select(SOURCE_COLUMNS)
    .maybeSingle()

  if (claimError) {
    console.error("[imports] could not claim a source", { sourceId, error: claimError })
    return
  }
  if (!claimed) return
  const source = claimed as SourceRow

  // The session is visibly reading once its first source is.
  await admin
    .from("product_imports")
    .update({ status: "retrieving", error_code: null, error_message: null })
    .eq("id", importId)
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")

  try {
    const evidence = await readEvidence(workspaceId, source, deps)
    const withAssets = await attachAssets(admin, workspaceId, importId, evidence)
    await admin
      .from("product_import_sources")
      .update({
        status: "ready",
        evidence: toJson(withAssets),
        content_hash: withAssets.contentHash,
        processed_at: withAssets.retrievedAt,
      })
      .eq("id", sourceId)
      .eq("workspace_id", workspaceId)
      .eq("status", "reading")
  } catch (error) {
    // Nothing may leave a source `reading`: a session waits for every source,
    // and one stuck source would hold the draft back for good.
    const normalized = normalizeImportError(error)
    const code = normalized.code === "ai_unavailable" ? "internal" : normalized.code
    console.error("[imports] a source could not be read", { sourceId, code })
    await admin
      .from("product_import_sources")
      .update({
        status: statusForImportError(code),
        error_code: code,
        error_message: new ImportError(code).userMessage,
        processed_at: new Date().toISOString(),
      })
      .eq("id", sourceId)
      .eq("workspace_id", workspaceId)
      .eq("status", "reading")
  }

  await composeSession(admin, workspaceId, importId, deps)
}

/**
 * The evidence for one source, from wherever it is.
 *
 * A link is fetched through the outbound boundary. A stored file is read from
 * private storage only after its path has been checked against the workspace
 * this job runs for — the database checks the same thing when the row is
 * written, and this is the second lock on the one door that crosses a tenant
 * boundary.
 */
async function readEvidence(
  workspaceId: string,
  source: SourceRow,
  deps: RunImportDeps,
): Promise<ProductSourceEvidence> {
  if (source.source_type === "public_url") {
    if (!source.source_url) throw new ImportError("internal", { reason: "source_url" })
    const page = await fetchPage(source.source_url, { outbound: deps.outbound })
    return importerFor(new URL(source.source_url)).read(page, source.source_url)
  }

  let bytes: Uint8Array = new Uint8Array()
  // A transcript and pasted text are on the row already; the audio itself is
  // never read again once it has been transcribed.
  const needsBytes = source.source_type !== "audio" && source.text_content === null
  if (needsBytes) {
    if (!source.storage_path || !isSourcePathFor(workspaceId, source.storage_path)) {
      throw new ImportError("internal", { reason: "source_path" })
    }
    try {
      bytes = await (deps.readSource ?? readStoredSource)(source.storage_path)
    } catch (error) {
      throw new ImportError("internal", { reason: "storage", name: (error as Error)?.name })
    }
  }

  return CONTENT_IMPORTERS[CONTENT_KIND_FOR_TYPE[source.source_type]].read({
    bytes,
    filename: source.source_type === "pasted_text" ? null : source.display_name,
    text: source.text_content,
  })
}

/* -------------------------------------------------------------- composing */

/**
 * The hash of a session's readable evidence, in the creator's order.
 *
 * Equal hashes mean the same sources said the same things, so an existing
 * draft stands.
 */
export function combinedEvidenceHash(
  sources: readonly { id: string; contentHash: string }[],
): string {
  const material = sources.map((source) => `${source.id}:${source.contentHash}`).join("\n")
  return createHash("sha256").update(material).digest("hex")
}

export interface SessionPlan {
  action: "wait" | "fail" | "reuse" | "compose"
  readable: { row: SourceRow; evidence: ProductSourceEvidence }[]
  unreadable: SourceRow[]
  hash: string | null
}

/**
 * What a session should do next, decided from its sources. Pure.
 *
 * Wait while anything is unsettled. Fail when nothing was readable. Reuse the
 * draft when the evidence hash matches and a draft exists. Compose otherwise.
 */
export function planSession(
  sources: readonly SourceRow[],
  session: { content_hash: string | null; hasSuggestions: boolean },
): SessionPlan {
  const live = sources.filter((source) => source.status !== "removed")
  if (live.length === 0 || live.some((source) => !isTerminalSourceStatus(source.status))) {
    return { action: "wait", readable: [], unreadable: [], hash: null }
  }

  const readable: SessionPlan["readable"] = []
  const unreadable: SourceRow[] = []
  for (const row of live) {
    const evidence = row.status === "ready" ? parseEvidence(row.evidence) : null
    if (evidence) readable.push({ row, evidence })
    else unreadable.push(row)
  }

  if (readable.length === 0) return { action: "fail", readable, unreadable, hash: null }

  const hash = combinedEvidenceHash(
    readable.map(({ row, evidence }) => ({ id: row.id, contentHash: evidence.contentHash })),
  )
  const reuse = session.content_hash === hash && session.hasSuggestions
  return { action: reuse ? "reuse" : "compose", readable, unreadable, hash }
}

export async function composeSession(
  admin: Admin,
  workspaceId: string,
  importId: string,
  deps: RunImportDeps,
): Promise<void> {
  const { data: session } = await admin
    .from("product_imports")
    .select("id, status, content_hash, suggestions")
    .eq("id", importId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (!session || session.status === "discarded") return

  const sources = await loadSources(admin, workspaceId, importId)
  const hasSuggestions =
    typeof session.suggestions === "object" &&
    session.suggestions !== null &&
    Object.keys(session.suggestions as Record<string, unknown>).length > 0
  const plan = planSession(sources, { content_hash: session.content_hash, hasSuggestions })

  if (plan.action === "wait") return

  if (plan.action === "fail") {
    const retryable = plan.unreadable.some((source) => source.status === "failed")
    await admin
      .from("product_imports")
      .update({
        status: retryable ? "failed" : "unavailable",
        error_code: "no_readable_source",
        error_message: new ImportError("no_readable_source").userMessage,
      })
      .eq("id", importId)
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "retrieving", "analyzing"])
    return
  }

  // The first readable source, in the creator's order, is what the preview and
  // the observed fields show. Every source is still what the draft reads.
  const primary = plan.readable[0]!.evidence

  /*
    The claim. Only one composition moves the session to `analyzing`, and a
    retry that set it back to `pending` meanwhile makes the late composition's
    final write match nothing, so the newer one wins.
  */
  const { data: claimed } = await admin
    .from("product_imports")
    .update({
      status: "analyzing",
      evidence: toJson(primary),
      content_hash: plan.hash,
      resolved_url: primary.resolvedUrl ?? null,
      retrieved_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    })
    .eq("id", importId)
    .eq("workspace_id", workspaceId)
    .in("status", ["pending", "retrieving"])
    .select("id")
    .maybeSingle()
  if (!claimed) return

  if (plan.action === "reuse") {
    await settleReady(admin, workspaceId, importId, {})
    return
  }

  const labelled: LabelledEvidence[] = plan.readable.map(({ row, evidence }) => ({
    label: row.display_name,
    evidence,
  }))
  const conflicts = detectConflicts(labelled)
  const unreadableNames = plan.unreadable.map((row) => row.display_name)

  try {
    const composed = await composeDraftFromSources(labelled, conflicts, unreadableNames, {
      provider: deps.provider,
    })
    await settleReady(admin, workspaceId, importId, {
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
    })
  } catch (error) {
    /*
      The sources were read and the evidence is saved. A missing model is not a
      failed import: the creator writes the listing from evidence Fanwise did
      gather, so the session settles `ready` with the reason recorded.
    */
    const normalized = normalizeImportError(error)
    if (normalized.code === "ai_unavailable") {
      await settleReady(admin, workspaceId, importId, {
        suggestions: toJson({ draft: { missingInformation: [] }, withheld: [], unavailable: true }),
      })
      return
    }
    await admin
      .from("product_imports")
      .update({
        status: statusForImportError(normalized.code),
        error_code: normalized.code,
        error_message: normalized.userMessage,
      })
      .eq("id", importId)
      .eq("workspace_id", workspaceId)
      .eq("status", "analyzing")
  }
}

async function settleReady(
  admin: Admin,
  workspaceId: string,
  importId: string,
  columns: {
    suggestions?: ReturnType<typeof toJson>
    prompt_version?: string
    schema_version?: string
  },
): Promise<void> {
  await admin
    .from("product_imports")
    .update({ status: "ready", analyzed_at: new Date().toISOString(), ...columns })
    .eq("id", importId)
    .eq("workspace_id", workspaceId)
    .eq("status", "analyzing")
}

/* ----------------------------------------------------------------- assets */

/**
 * Fetches the pictures a source advertised into the product's own assets.
 *
 * Each one is a URL a stranger chose, so each goes through the same outbound
 * boundary and the same signature and dimension checks; an asset that fails any
 * of them is recorded with the reason rather than dropped.
 *
 * The product's first picture becomes the cover and the rest previews. With
 * several sources, "first" is decided by what the product already holds, so a
 * second source never takes the cover from the first.
 */
async function attachAssets(
  admin: Admin,
  workspaceId: string,
  importId: string,
  evidence: ProductSourceEvidence,
): Promise<ProductSourceEvidence> {
  if (evidence.previewAssets.length === 0) return evidence

  const { data: session } = await admin
    .from("product_imports")
    .select("product_id")
    .eq("id", importId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (!session) return evidence
  const productId = session.product_id

  const { count } = await admin
    .from("product_assets")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .in("asset_type", ["cover_image", "preview_image"])

  const attached: SourceAsset[] = []
  let kept = count ?? 0

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
    // The default stands. The storage path is built from ids.
  }
  return `${stem}.${extension}`
}

/** Evidence from a row, for anything reading an import back. */
export function evidenceOf(row: { evidence: unknown }): ProductSourceEvidence | null {
  return parseEvidence(row.evidence)
}
