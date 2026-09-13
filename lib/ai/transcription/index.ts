import type { TranscriptionProvider } from "./types"
import { createCloudflareTranscriber } from "./providers/cloudflare"
import { readCloudflareConfig } from "./providers/cloudflare/config"

/**
 * Which transcription provider this deployment has.
 *
 * Chosen by credentials, like the model provider: Cloudflare Workers AI
 * (Whisper large-v3-turbo) when `CLOUDFLARE_ACCOUNT_ID` and
 * `CLOUDFLARE_AI_API_TOKEN` are both set, and none otherwise — in which case
 * the composer says transcription is not available, and a recording is never
 * shown as transcribed. The vendor's name lives in `./providers` and nowhere
 * else; callers receive a `TranscriptionProvider`.
 *
 * The end-to-end suite needs a recording to reach "Transcribed" without a
 * microphone or a vendor. It is switched on by an explicit variable, and only
 * against a local database, so a deployment cannot turn it on by accident.
 */

export function getTranscriptionProvider(
  env: Record<string, string | undefined> = process.env,
): TranscriptionProvider | null {
  if (isTestTranscriptionEnabled(env)) return testTranscriptionProvider
  const cloudflare = readCloudflareConfig(env)
  if (cloudflare) return createCloudflareTranscriber(cloudflare)
  return null
}

export function isTranscriptionConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getTranscriptionProvider(env) !== null
}

export function isTestTranscriptionEnabled(env: Record<string, string | undefined>): boolean {
  return (
    env.FANWISE_E2E_FAKE_TRANSCRIPTION === "1" &&
    /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "")
  )
}

/** Deterministic words for the suite. Never selected outside it. */
export const TEST_TRANSCRIPT =
  "Canvas tote in natural cotton. Printed by hand in small batches. Holds a laptop and a notebook."

const testTranscriptionProvider: TranscriptionProvider = {
  name: "test",
  async transcribe() {
    return { text: TEST_TRANSCRIPT, durationMs: null, provider: "test", model: "fixed" }
  },
}
