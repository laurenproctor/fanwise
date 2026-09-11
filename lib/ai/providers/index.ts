import type { AiProvider } from "@/lib/ai/types"
import { createAnthropicProvider } from "./anthropic"
import { readApiKey } from "./anthropic/config"

/**
 * Which provider this deployment has.
 *
 * Chosen by credentials, like the queue and the credentials keyring: the first
 * vendor whose key is present is the provider, and a deployment with no key has
 * none. This file is inside lib/ai/providers so that it may name vendors; the
 * caller receives an AiProvider and learns the vendor only from the row it
 * writes.
 */

export function isAiConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readApiKey(env) !== null
}

export function getProvider(): AiProvider | null {
  if (!isAiConfigured()) return null
  return createAnthropicProvider()
}
