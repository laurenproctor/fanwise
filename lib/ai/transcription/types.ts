/**
 * Turning a recording into text, behind an abstraction.
 *
 * The same rule as `lib/ai/types.ts`: application code talks to a
 * `TranscriptionProvider` and never learns whose it is. Which provider a
 * deployment has is decided in `./index.ts` by the credentials it carries, and
 * a vendor's name may appear only in a `providers` folder beside it.
 *
 * The request is the audio and its type, and nothing else. No product, no
 * workspace, no creator, no other source: a transcription provider is told
 * what was said and is asked what the words were.
 */

export interface TranscriptionRequest {
  audio: Uint8Array
  /** Sniffed from the bytes, never taken from the browser. */
  mimeType: string
}

export interface TranscriptionResult {
  text: string
  /** The recording's length as the provider measured it, when it reports one. */
  durationMs: number | null
  provider: string
  model: string
}

export interface TranscriptionProvider {
  readonly name: string
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>
}

export const TRANSCRIPTION_ERROR_CODES = [
  /** No provider is configured on this deployment. */
  "not_configured",
  /** The provider could not make sense of the audio. */
  "unreadable_audio",
  /** Throttled, down, or unreachable. Worth trying again later. */
  "provider_unavailable",
  "unknown",
] as const

export type TranscriptionErrorCode = (typeof TRANSCRIPTION_ERROR_CODES)[number]

/** A provider failure, normalized. The original goes to a server log only. */
export class TranscriptionError extends Error {
  constructor(
    readonly code: TranscriptionErrorCode,
    cause?: unknown,
  ) {
    super(`transcription failed: ${code}`, cause === undefined ? undefined : { cause })
    this.name = "TranscriptionError"
  }
}
