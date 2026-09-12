import { z } from "zod"
import { TranscriptionError, type TranscriptionProvider } from "../../types"
import type { CloudflareTranscriptionConfig } from "./config"

/**
 * Transcription through Cloudflare Workers AI, Whisper large-v3-turbo.
 *
 * One REST call per recording, from the background job. The request carries the
 * audio, base64-encoded, and nothing else: no product, no workspace, no file
 * name. Cloudflare's Workers AI data-usage terms say customer content is not
 * used to train models and is not stored unless a storage product is used,
 * which this does not.
 *
 * The response is validated before anything reads it (rule 6), and every
 * failure leaves here as a normalized `TranscriptionError`. The status, the
 * body and the token never reach a log line from this file.
 */

export const CLOUDFLARE_WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo"

const TIMEOUT_MS = 120_000

const responseSchema = z.object({
  success: z.boolean(),
  result: z
    .object({
      text: z.string(),
      transcription_info: z
        .object({ duration: z.number().nonnegative().optional() })
        .partial()
        .optional(),
    })
    .nullable()
    .optional(),
})

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export function createCloudflareTranscriber(
  config: CloudflareTranscriptionConfig,
  fetchImpl: FetchLike = fetch,
): TranscriptionProvider {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${CLOUDFLARE_WHISPER_MODEL}`

  return {
    name: "cloudflare",
    async transcribe({ audio }) {
      let response: Response
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            audio: Buffer.from(audio).toString("base64"),
            task: "transcribe",
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (error) {
        throw new TranscriptionError("provider_unavailable", { name: (error as Error)?.name })
      }

      if (response.status === 401 || response.status === 403) {
        // A revoked or mis-scoped token. Nothing a creator can do about it, and
        // retrying will not help; the deployment needs fixing.
        throw new TranscriptionError("not_configured", { status: response.status })
      }
      if (response.status === 400 || response.status === 413 || response.status === 422) {
        throw new TranscriptionError("unreadable_audio", { status: response.status })
      }
      if (!response.ok) {
        throw new TranscriptionError("provider_unavailable", { status: response.status })
      }

      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new TranscriptionError("unknown", { reason: "not_json" })
      }

      const parsed = responseSchema.safeParse(body)
      if (!parsed.success || !parsed.data.success || !parsed.data.result) {
        throw new TranscriptionError("unknown", { reason: "invalid_response" })
      }

      const seconds = parsed.data.result.transcription_info?.duration
      return {
        text: parsed.data.result.text,
        durationMs: typeof seconds === "number" ? Math.round(seconds * 1000) : null,
        provider: "cloudflare",
        model: CLOUDFLARE_WHISPER_MODEL,
      }
    },
  }
}
