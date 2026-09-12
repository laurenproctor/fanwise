import type { TranscriptionProvider } from "./types"

/**
 * Which transcription provider this deployment has.
 *
 * **None, today.** No vendor adapter is installed: the model provider this
 * application already uses does not transcribe audio, and choosing a second
 * vendor adds a processor of creators' voices to the privacy policy, which is a
 * decision for the founder rather than for a pull request. Until one exists the
 * composer says that transcription is not available, and a recording is never
 * shown as transcribed.
 *
 * An adapter, when one is chosen, goes in `./providers/<vendor>` and is
 * selected here by the presence of its key, the way `lib/ai/providers` selects
 * the model.
 *
 * The one exception is the end-to-end suite, which needs a recording to reach
 * "Transcribed" without a microphone or a vendor. It is switched on by an
 * explicit variable, and only against a local database, so a deployment cannot
 * turn it on by accident: a hosted project's URL fails the second check.
 */

export function getTranscriptionProvider(
  env: Record<string, string | undefined> = process.env,
): TranscriptionProvider | null {
  if (isTestTranscriptionEnabled(env)) return testTranscriptionProvider
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
