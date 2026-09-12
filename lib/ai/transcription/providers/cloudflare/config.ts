/**
 * Cloudflare Workers AI credentials, read server-side only.
 *
 * Two values, both required: the account the model runs under and an API token
 * scoped to Workers AI. Neither is logged, returned to a browser, or placed in
 * any request but the one to Cloudflare. Read from process.env rather than
 * lib/env.ts, as the model provider's key is: transcription is optional, and a
 * deployment without it is valid.
 */

export interface CloudflareTranscriptionConfig {
  accountId: string
  apiToken: string
}

export function readCloudflareConfig(
  env: Record<string, string | undefined> = process.env,
): CloudflareTranscriptionConfig | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = env.CLOUDFLARE_AI_API_TOKEN?.trim()
  if (!accountId || !apiToken) return null
  // An account id is 32 hex characters. Anything else is a misconfiguration,
  // and treating it as "not configured" keeps it out of a request URL.
  if (!/^[0-9a-f]{32}$/i.test(accountId)) return null
  return { accountId, apiToken }
}
