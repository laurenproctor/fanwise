"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { jobs } from "@/lib/jobs"
import { routes } from "@/lib/routes"
import { isTranscriptionConfigured } from "@/lib/ai/transcription"
import { IMPORT_ERROR_MESSAGES, type ImportErrorCode } from "./errors"
import { sniff, type AudioExtension } from "./file-signature"
import { IMPORT_LIMITS } from "./limits"
import { isWholeHtmlDocument } from "./paste"
import {
  createSourceUploadUrl,
  measureStoredSource,
  readStoredSource,
  removeStoredSource,
  sourcePathFor,
  storePastedSource,
} from "./source-storage"
import { createImportSession } from "./start"

/**
 * What the composer asks the server to do.
 *
 * Every action re-establishes who the caller is and which workspace they act
 * in before it touches anything, and every row is written through the caller's
 * RLS. The service role is used for exactly two things, both on paths the
 * server built itself: reading back an object to measure and sniff it, and
 * removing one.
 *
 * Files and recordings are staged before "Create draft", which is what lets a
 * pill say `Ready` or `Transcribed` truthfully: by then the bytes are in private
 * storage, measured, and checked to be what their name says. A staged source
 * belongs to the workspace and to no import until the session is created.
 */

async function requireWorkspace(workspaceSlug: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle()

  if (error) throw error
  if (!workspace) redirect("/")
  return { supabase, user, workspace }
}

/* ------------------------------------------------------------ staging */

const AUDIO_EXTENSIONS: Record<string, AudioExtension> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
}

const stageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.enum(["pdf", "html"]),
    filename: z.string().trim().min(1).max(255),
    byteSize: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("audio"),
    label: z.string().trim().min(1).max(255),
    /** The recorder's container, used only to name the stored object. */
    mimeType: z.string().max(100),
    byteSize: z.number().int().positive(),
    durationMs: z.number().int().nonnegative(),
  }),
])

export type StageResult = { sourceId: string; signedUrl: string } | { error: string }

/**
 * Ask to upload one file or recording.
 *
 * Refuses early on the browser's name and size, then records a row in
 * `uploading` and mints a signed URL for a path the server builds. The row is
 * what a retry or a removal names; nothing it says about the file is trusted
 * until `confirmStagedSourceAction` has read the bytes.
 */
export async function stageSourceAction(
  workspaceSlug: string,
  input: unknown,
): Promise<StageResult> {
  const parsed = stageSchema.safeParse(input)
  if (!parsed.success) return { error: "That file cannot be added." }
  const data = parsed.data

  if (data.type === "audio") {
    if (data.byteSize > IMPORT_LIMITS.maxAudioBytes)
      return { error: IMPORT_ERROR_MESSAGES.too_large }
    if (data.durationMs > IMPORT_LIMITS.maxAudioMs)
      return { error: IMPORT_ERROR_MESSAGES.audio_too_long }
  } else {
    const lower = data.filename.toLowerCase()
    const extensionOk =
      data.type === "pdf"
        ? lower.endsWith(".pdf")
        : lower.endsWith(".html") || lower.endsWith(".htm")
    if (!extensionOk) return { error: `${data.filename} is not a PDF or HTML file.` }
    const max = data.type === "pdf" ? IMPORT_LIMITS.maxPdfBytes : IMPORT_LIMITS.maxHtmlBytes
    if (data.byteSize > max) return { error: `${data.filename} is larger than Fanwise reads.` }
  }

  const { supabase, user, workspace } = await requireWorkspace(workspaceSlug)
  const sourceId = crypto.randomUUID()
  const kind =
    data.type === "pdf"
      ? "pdf_document"
      : data.type === "html"
        ? "html_document"
        : "audio_recording"
  const extension =
    data.type === "audio"
      ? (AUDIO_EXTENSIONS[data.mimeType.split(";")[0]!.trim()] ?? "webm")
      : undefined
  const path = sourcePathFor(workspace.id, sourceId, kind, extension)

  const { error } = await supabase.from("product_import_sources").insert({
    id: sourceId,
    workspace_id: workspace.id,
    source_type: data.type,
    status: "uploading",
    display_name: data.type === "audio" ? data.label : data.filename.split(/[\\/]/).pop()!,
    storage_path: path,
    duration_ms: data.type === "audio" ? data.durationMs : null,
    requested_by: user.id,
  })
  if (error) {
    console.error("[imports] could not stage a source", { code: error.code })
    return { error: "That file could not be added. Try again." }
  }

  try {
    return { sourceId, signedUrl: await createSourceUploadUrl(path) }
  } catch {
    return { error: "That upload could not be started. Try again." }
  }
}

export interface StagedSourceStatus {
  sourceId: string
  status: "uploading" | "staged" | "transcribing" | "failed" | "removed" | "attached"
  /** For a recording: whether the text is there. */
  transcribed: boolean
  message: string | null
}

async function statusOf(
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"],
  workspaceId: string,
  sourceId: string,
): Promise<StagedSourceStatus | null> {
  const { data } = await supabase
    .from("product_import_sources")
    .select("id, status, import_id, source_type, text_content, error_message")
    .eq("id", sourceId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (!data) return null
  const status =
    data.import_id !== null
      ? "attached"
      : data.status === "unavailable" || data.status === "failed"
        ? "failed"
        : (data.status as StagedSourceStatus["status"])
  return {
    sourceId: data.id,
    status,
    transcribed: data.source_type === "audio" && data.text_content !== null,
    message: data.error_message,
  }
}

async function failStaged(
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"],
  workspaceId: string,
  sourceId: string,
  code: ImportErrorCode,
): Promise<StagedSourceStatus> {
  await supabase
    .from("product_import_sources")
    .update({ status: "failed", error_code: code, error_message: IMPORT_ERROR_MESSAGES[code] })
    .eq("id", sourceId)
    .eq("workspace_id", workspaceId)
    .is("import_id", null)
  return { sourceId, status: "failed", transcribed: false, message: IMPORT_ERROR_MESSAGES[code] }
}

/**
 * The browser says the bytes are up. Check what actually arrived.
 *
 * Measured from storage, sniffed from the first bytes. A file that is not what
 * its row says is refused here, its object removed. A recording goes on to be
 * transcribed in a background job — or, on a deployment with no transcription
 * provider, is refused now with a sentence that says so.
 */
export async function confirmStagedSourceAction(
  workspaceSlug: string,
  sourceId: string,
): Promise<StagedSourceStatus | { error: string }> {
  if (!z.uuid().safeParse(sourceId).success) return { error: "That file could not be found." }
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: row } = await supabase
    .from("product_import_sources")
    .select("id, source_type, status, storage_path")
    .eq("id", sourceId)
    .eq("workspace_id", workspace.id)
    .is("import_id", null)
    .maybeSingle()
  if (!row || !row.storage_path) return { error: "That file could not be found." }
  if (row.status !== "uploading") {
    return (
      (await statusOf(supabase, workspace.id, sourceId)) ?? {
        error: "That file could not be found.",
      }
    )
  }
  if (row.source_type !== "pdf" && row.source_type !== "html" && row.source_type !== "audio") {
    return { error: "That file could not be found." }
  }

  const size = await measureStoredSource(row.storage_path)
  if (size === null) return failStaged(supabase, workspace.id, sourceId, "upload_incomplete")

  const max =
    row.source_type === "pdf"
      ? IMPORT_LIMITS.maxPdfBytes
      : row.source_type === "html"
        ? IMPORT_LIMITS.maxHtmlBytes
        : IMPORT_LIMITS.maxAudioBytes
  if (size > max) {
    await removeStoredSource(row.storage_path).catch(() => undefined)
    return failStaged(supabase, workspace.id, sourceId, "too_large")
  }

  let sniffed: ReturnType<typeof sniff>
  try {
    sniffed = sniff(row.source_type, await readStoredSource(row.storage_path))
  } catch {
    return failStaged(supabase, workspace.id, sourceId, "upload_incomplete")
  }
  if (!sniffed) {
    await removeStoredSource(row.storage_path).catch(() => undefined)
    return failStaged(supabase, workspace.id, sourceId, "unsupported_file")
  }

  if (row.source_type === "audio" && !isTranscriptionConfigured()) {
    await supabase
      .from("product_import_sources")
      .update({ byte_size: size, mime_type: sniffed.mimeType })
      .eq("id", sourceId)
      .eq("workspace_id", workspace.id)
    return failStaged(supabase, workspace.id, sourceId, "transcription_unavailable")
  }

  const next = row.source_type === "audio" ? "transcribing" : "staged"
  const { error } = await supabase
    .from("product_import_sources")
    .update({ status: next, byte_size: size, mime_type: sniffed.mimeType })
    .eq("id", sourceId)
    .eq("workspace_id", workspace.id)
    .eq("status", "uploading")
  if (error) return { error: "That file could not be checked. Try again." }

  if (next === "transcribing") {
    await jobs.enqueue(
      "transcribe_import_source",
      { workspaceId: workspace.id, sourceId },
      { idempotencyKey: `transcribe:${sourceId}` },
    )
  }

  return { sourceId, status: next, transcribed: false, message: null }
}

/** Where the composer's staged sources are now. Polled while one is transcribing. */
export async function stagedSourceStatusesAction(
  workspaceSlug: string,
  sourceIds: string[],
): Promise<StagedSourceStatus[]> {
  const ids = sourceIds
    .filter((id) => z.uuid().safeParse(id).success)
    .slice(0, IMPORT_LIMITS.maxSources)
  if (ids.length === 0) return []
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)
  const statuses = await Promise.all(ids.map((id) => statusOf(supabase, workspace.id, id)))
  return statuses.filter((status): status is StagedSourceStatus => status !== null)
}

/**
 * Take a staged source out of the composer.
 *
 * `removed` rather than a delete, as for every import row, and only while it
 * belongs to no import. The object goes too, best effort: a private object left
 * behind wastes space and nothing else.
 */
export async function removeStagedSourceAction(
  workspaceSlug: string,
  sourceId: string,
): Promise<{ error: string | null }> {
  if (!z.uuid().safeParse(sourceId).success) return { error: null }
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data } = await supabase
    .from("product_import_sources")
    .update({ status: "removed", error_code: null, error_message: null })
    .eq("id", sourceId)
    .eq("workspace_id", workspace.id)
    .is("import_id", null)
    .select("storage_path")
    .maybeSingle()

  if (data?.storage_path) await removeStoredSource(data.storage_path).catch(() => undefined)
  return { error: null }
}

/* ------------------------------------------------------------ creating */

const createSchema = z.object({
  submissionId: z.uuid(),
  url: z.string().max(2048).nullable(),
  text: z
    .string()
    .max(IMPORT_LIMITS.maxPasteCharacters + 1)
    .nullable(),
  stagedSourceIds: z.array(z.uuid()).max(IMPORT_LIMITS.maxSources),
})

/**
 * Ids, never addresses. The browser builds the address to go to from a route
 * helper and an id it has checked is a uuid, so nothing it navigates to is a
 * string that came back over the network.
 */
export type CreateDraftResult = { error: string; existingImportId?: string } | { importId: string }

/**
 * "Create draft".
 *
 * Pasted text that is a whole HTML document is stored and staged as an HTML
 * source, so markup is read as markup. Everything else is one call to
 * `createImportSession`, and the answer is where to go next.
 */
export async function createImportDraftAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CreateDraftResult> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { error: "That draft could not be created. Check your sources." }
  const { submissionId, url } = parsed.data
  let { text } = parsed.data
  const staged = [...parsed.data.stagedSourceIds]

  if (text !== null && text.length > IMPORT_LIMITS.maxPasteCharacters) {
    return {
      error: `Pasted text is limited to ${IMPORT_LIMITS.maxPasteCharacters.toLocaleString("en-US")} characters.`,
    }
  }

  const { supabase, user, workspace } = await requireWorkspace(workspaceSlug)

  const { data: stagedRows } = staged.length
    ? await supabase
        .from("product_import_sources")
        .select("id, display_name")
        .eq("workspace_id", workspace.id)
        .in("id", staged)
    : { data: [] as { id: string; display_name: string }[] }
  const names = new Map((stagedRows ?? []).map((row) => [row.id, row.display_name]))

  if (text !== null && isWholeHtmlDocument(text)) {
    const htmlId = crypto.randomUUID()
    const path = sourcePathFor(workspace.id, htmlId, "html_document")
    try {
      const byteSize = await storePastedSource(path, text)
      const { error } = await supabase.from("product_import_sources").insert({
        id: htmlId,
        workspace_id: workspace.id,
        source_type: "html",
        status: "staged",
        display_name: "Pasted HTML",
        storage_path: path,
        byte_size: byteSize,
        mime_type: "text/html",
        requested_by: user.id,
      })
      if (error) throw error
      staged.unshift(htmlId)
      names.set(htmlId, "Pasted HTML")
      text = null
    } catch {
      return { error: "That could not be saved. Try again." }
    }
  }

  const outcome = await createImportSession({
    supabase,
    workspaceId: workspace.id,
    submissionId,
    sources: {
      rawUrl: url,
      pastedText: text,
      staged: staged.map((id) => ({ id, displayName: names.get(id) ?? "Source" })),
    },
  })

  if (outcome.kind === "invalid" || outcome.kind === "error") return { error: outcome.message }
  if (outcome.kind === "link_in_use") {
    return {
      error: outcome.message,
      existingImportId: outcome.importId,
    }
  }

  revalidatePath(routes.workspace(workspaceSlug))
  return { importId: outcome.importId }
}
