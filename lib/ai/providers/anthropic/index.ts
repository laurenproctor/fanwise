import Anthropic from "@anthropic-ai/sdk"
import type { AiProvider, GenerationRequest, GenerationResponse, TokenUsage } from "@/lib/ai/types"
import { AiError } from "@/lib/ai/types"
import { EFFORT, MODEL, PROVIDER_NAME, RATES, readApiKey } from "./config"

/**
 * The first provider.
 *
 * Everything vendor-shaped lives in this folder: the client, the request
 * shape, the error classes and the rates. lib/ai sees an AiProvider and a
 * normalized AiError, and a unit test reads the tree to make sure the vendor's
 * name stays here.
 *
 * The request is one non-streaming call with a JSON schema on the output and
 * a cache marker on the last system block. No tools, no thinking parameter
 * (the model decides), effort low per decision 12.
 */

export interface AnthropicProviderOptions {
  apiKey?: string
  /** Test seam: a fetch that answers without a network. */
  fetch?: typeof fetch
}

function usageOf(message: Anthropic.Message): TokenUsage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
  }
}

export function estimateCost(usage: TokenUsage): number {
  const cost =
    usage.inputTokens * RATES.input +
    usage.outputTokens * RATES.output +
    usage.cacheReadInputTokens * RATES.cacheRead +
    usage.cacheCreationInputTokens * RATES.cacheWrite
  return Math.round(cost * 1_000_000) / 1_000_000
}

/**
 * Rule 8 for a model vendor. The code and a sentence reach the row; the
 * original reaches the server log as a name and a status and nothing more,
 * because an HTTP error can carry the request that produced it.
 */
function normalize(error: unknown): AiError {
  if (error instanceof AiError) return error
  const fail = (code: AiError["code"], message: string) => {
    const status = error instanceof Anthropic.APIError ? error.status : undefined
    console.error("[ai] provider call failed", {
      name: error instanceof Error ? error.name : "unknown",
      status,
      code,
    })
    return new AiError(code, message)
  }

  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return fail("credentials_invalid", "Composing is not configured correctly on this deployment.")
  }
  if (error instanceof Anthropic.RateLimitError) {
    return fail("rate_limited", "Composing is busy right now. Try again in a minute.")
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return fail("network", "Composing could not reach the model. Try again.")
  }
  if (error instanceof Anthropic.InternalServerError) {
    return fail("provider_unavailable", "Composing is unavailable right now. Try again shortly.")
  }
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) {
    return fail("provider_unavailable", "Composing is unavailable right now. Try again shortly.")
  }
  return fail(
    "unknown",
    "The listing could not be composed. Nothing was changed, and the error has been recorded.",
  )
}

export function createAnthropicProvider(options: AnthropicProviderOptions = {}): AiProvider {
  const apiKey = options.apiKey ?? readApiKey()
  if (!apiKey) {
    throw new AiError("not_configured", "Composing is not configured on this deployment.")
  }

  const client = new Anthropic({
    apiKey,
    maxRetries: 2,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })

  return {
    name: PROVIDER_NAME,
    model: MODEL,

    async generate(request: GenerationRequest): Promise<GenerationResponse> {
      let message: Anthropic.Message
      try {
        message = await client.messages.create({
          model: MODEL,
          max_tokens: request.maxOutputTokens,
          system: request.system.map((block) => ({
            type: "text" as const,
            text: block.text,
            ...(block.cacheBoundary ? { cache_control: { type: "ephemeral" as const } } : {}),
          })),
          messages: [{ role: "user", content: request.user }],
          output_config: {
            effort: EFFORT,
            format: { type: "json_schema", schema: request.outputSchema },
          },
        })
      } catch (error) {
        throw normalize(error)
      }

      if (message.stop_reason === "refusal") {
        throw new AiError("refused", "The model declined to compose this listing.")
      }
      if (message.stop_reason === "max_tokens") {
        throw new AiError("invalid_output", "The composed listing ran too long to use. Try again.")
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")

      let output: unknown
      try {
        output = JSON.parse(text)
      } catch {
        throw new AiError("invalid_output", "The composed listing came back malformed. Try again.")
      }

      const usage = usageOf(message)
      return {
        output,
        usage,
        estimatedCost: estimateCost(usage),
        provider: PROVIDER_NAME,
        model: message.model,
      }
    },
  }
}
