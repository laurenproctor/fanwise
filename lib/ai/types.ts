/**
 * The provider abstraction.
 *
 * lib/ai talks to a model through this and nothing else. Which vendor is
 * behind it is decided in lib/ai/providers/index.ts by which credentials the
 * deployment carries, and no vendor name appears outside that folder: a unit
 * test reads the tree for one the same way it reads for a marketplace's.
 *
 * The request is deliberately narrow. One system prompt in blocks, one user
 * message, one JSON schema the answer must satisfy. That is every listing
 * generation B1 makes, and a provider that offers more is not asked for it.
 */

export interface PromptBlock {
  text: string
  /**
   * True on the block that ends the stable prefix. Everything up to and
   * including it is the same bytes on every generation for a channel and a
   * provider that supports prefix caching should cache through it. Decision 12
   * in docs/decisions/0002 priced the step on this being true.
   */
  cacheBoundary?: boolean
}

export interface GenerationRequest {
  system: readonly PromptBlock[]
  user: string
  /** JSON Schema the provider must constrain the answer to. */
  outputSchema: Record<string, unknown>
  maxOutputTokens: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

export interface GenerationResponse {
  /** The provider's answer, parsed from JSON but not yet validated by Zod. */
  output: unknown
  usage: TokenUsage
  /** USD, from the provider's published rates. An estimate. */
  estimatedCost: number
  provider: string
  model: string
}

export interface AiProvider {
  readonly name: string
  readonly model: string
  generate(request: GenerationRequest): Promise<GenerationResponse>
}

/**
 * Normalized failure codes. Rule 8, applied to a model vendor: the code and
 * message reach the creator, the original reaches a log the browser cannot see.
 */
export const AI_ERROR_CODES = [
  /** No provider is configured on this deployment. */
  "not_configured",
  /** The provider rejected the credential. */
  "credentials_invalid",
  /** Throttled. Retryable by a person, not silently. */
  "rate_limited",
  /** The provider is down or erroring. */
  "provider_unavailable",
  /** The request never reached the provider. */
  "network",
  /** The provider declined to answer. */
  "refused",
  /** The answer did not satisfy the output schema. */
  "invalid_output",
  /** Anything else. */
  "unknown",
] as const

export type AiErrorCode = (typeof AI_ERROR_CODES)[number]

export class AiError extends Error {
  readonly code: AiErrorCode
  /** Shown to a creator. Never a status code, a URL, a token or a stack. */
  readonly userMessage: string

  constructor(code: AiErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage, cause === undefined ? undefined : { cause })
    this.name = "AiError"
    this.code = code
    this.userMessage = userMessage
  }
}

/**
 * The fallback for anything that escapes a provider un-normalized.
 *
 * Keeps nothing of the original beyond its name: a thrown value from an HTTP
 * client can carry the request, and the request carried an API key.
 */
export function normalizeAiError(error: unknown): AiError {
  if (error instanceof AiError) return error
  const name = error instanceof Error ? error.name : "unknown"
  return new AiError(
    "unknown",
    "The listing could not be composed. Nothing was changed, and the error has been recorded.",
    { name },
  )
}
