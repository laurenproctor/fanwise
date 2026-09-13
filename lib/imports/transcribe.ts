import { createAdminClient } from "@/lib/supabase/admin"
import { getTranscriptionProvider } from "@/lib/ai/transcription"
import { TranscriptionError, type TranscriptionProvider } from "@/lib/ai/transcription/types"
import type { ImportErrorCode } from "./errors"
import { IMPORT_ERROR_MESSAGES } from "./errors"
import { sniffAudio } from "./file-signature"
import { IMPORT_LIMITS } from "./limits"
import { isSourcePathFor, readStoredSource } from "./source-storage"

/**
 * One recording, transcribed.
 *
 * Runs in a background job with the service role, scoped to the workspace in
 * the payload. The row is claimed by compare-and-swap on `transcribing`, so a
 * redelivery transcribes nothing twice.
 *
 * What the provider receives is the audio and its sniffed type. Not the product,
 * not the other sources, not the workspace, not a file name.
 *
 * Every outcome is written to the row. A recording that was not transcribed is
 * never marked as if it had been: the composer shows `Transcribed` only for a
 * row this function moved back to `staged` with text on it.
 */

export interface TranscriptionOutcome {
  status: "staged" | "failed" | "unavailable"
  text: string | null
  errorCode: ImportErrorCode | null
}

/** The decision, without the database. Pure apart from the provider call. */
export async function transcribeAudio(
  audio: Uint8Array,
  provider: TranscriptionProvider | null,
): Promise<TranscriptionOutcome> {
  if (!provider) return refusal("transcription_unavailable", "unavailable")
  if (audio.byteLength > IMPORT_LIMITS.maxAudioBytes) return refusal("too_large", "unavailable")

  const sniffed = sniffAudio(audio)
  if (!sniffed) return refusal("unsupported_file", "unavailable")

  try {
    const result = await provider.transcribe({ audio, mimeType: sniffed.mimeType })
    if (result.durationMs !== null && result.durationMs > IMPORT_LIMITS.maxAudioMs) {
      return refusal("audio_too_long", "unavailable")
    }
    const text = result.text
      .replace(/\r\n?/g, "\n")
      .trim()
      .slice(0, IMPORT_LIMITS.maxPasteCharacters)
    if (text.length === 0) return refusal("no_text", "unavailable")
    return { status: "staged", text, errorCode: null }
  } catch (error) {
    const code = error instanceof TranscriptionError ? error.code : "unknown"
    // The provider's own words stay in the log, keyed by the normalized code.
    console.error("[imports] transcription failed", { code })
    if (code === "not_configured") return refusal("transcription_unavailable", "unavailable")
    if (code === "unreadable_audio") return refusal("unsupported_file", "unavailable")
    return refusal(code === "provider_unavailable" ? "provider_error" : "internal", "failed")
  }
}

function refusal(code: ImportErrorCode, status: "failed" | "unavailable"): TranscriptionOutcome {
  return { status, text: null, errorCode: code }
}

export async function runTranscription(
  payload: { workspaceId: string; sourceId: string },
  deps: {
    provider?: TranscriptionProvider | null
    readSource?: (path: string) => Promise<Uint8Array>
  } = {},
): Promise<void> {
  const admin = createAdminClient()
  const { data: row } = await admin
    .from("product_import_sources")
    .select("id, storage_path, source_type, status")
    .eq("id", payload.sourceId)
    .eq("workspace_id", payload.workspaceId)
    .eq("status", "transcribing")
    .maybeSingle()
  if (!row || row.source_type !== "audio") return

  let outcome: TranscriptionOutcome
  if (!row.storage_path || !isSourcePathFor(payload.workspaceId, row.storage_path)) {
    outcome = refusal("internal", "failed")
  } else {
    try {
      const audio = await (deps.readSource ?? readStoredSource)(row.storage_path)
      outcome = await transcribeAudio(
        audio,
        deps.provider === undefined ? getTranscriptionProvider() : deps.provider,
      )
    } catch {
      outcome = refusal("internal", "failed")
    }
  }

  await admin
    .from("product_import_sources")
    .update({
      // A transcript is ready to be read; the source joins an import as staged.
      status: outcome.status === "staged" ? "staged" : "failed",
      text_content: outcome.text,
      error_code: outcome.status === "staged" ? null : outcome.errorCode,
      error_message:
        outcome.status === "staged" || !outcome.errorCode
          ? null
          : IMPORT_ERROR_MESSAGES[outcome.errorCode],
      processed_at: new Date().toISOString(),
    })
    .eq("id", payload.sourceId)
    .eq("workspace_id", payload.workspaceId)
    .eq("status", "transcribing")
}
