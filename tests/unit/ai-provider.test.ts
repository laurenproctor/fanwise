import { describe, expect, it, vi } from "vitest"
import { createAnthropicProvider, estimateCost } from "@/lib/ai/providers/anthropic"
import { AiError } from "@/lib/ai/types"
import { LISTING_OUTPUT_JSON_SCHEMA } from "@/lib/ai/output"

/**
 * The provider, with the network replaced by a fetch that answers from a
 * script. What these prove is Fanwise's side of the wire: the request carries
 * the schema, the effort, and a cache marker on the profile block; the
 * response's usage becomes a cost; and every failure reaches the caller as a
 * normalized AiError with no vendor sentence in it.
 */

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text: JSON.stringify({ title: "Aster" }) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 900,
      output_tokens: 400,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  }
}

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) })
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

const request = {
  system: [{ text: "RULES" }, { text: "PROFILE", cacheBoundary: true }],
  user: "facts",
  outputSchema: LISTING_OUTPUT_JSON_SCHEMA,
  maxOutputTokens: 1024,
}

describe("the workspace header", () => {
  it("names the workspace when one is configured, and nothing otherwise", async () => {
    const withId = fakeFetch(200, message())
    await createAnthropicProvider({
      apiKey: "sk-test",
      workspaceId: "wrkspc_1",
      fetch: withId.fetchImpl,
    }).generate(request)
    const sent = (withId.fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!
    const headers = new Headers((sent[1] as RequestInit).headers)
    expect(headers.get("anthropic-workspace-id")).toBe("wrkspc_1")

    const without = fakeFetch(200, message())
    await createAnthropicProvider({
      apiKey: "sk-test",
      workspaceId: null,
      fetch: without.fetchImpl,
    }).generate(request)
    const plain = (without.fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!
    expect(new Headers((plain[1] as RequestInit).headers).get("anthropic-workspace-id")).toBeNull()
  })
})

describe("the request", () => {
  it("carries the schema, low effort, and a cache marker on the boundary block", async () => {
    const { fetchImpl, calls } = fakeFetch(200, message())
    const provider = createAnthropicProvider({ apiKey: "sk-test", fetch: fetchImpl })

    const response = await provider.generate(request)

    expect(calls).toHaveLength(1)
    const body = calls[0]!.body
    expect(body.model).toBe("claude-sonnet-5")
    expect(body.output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: LISTING_OUTPUT_JSON_SCHEMA },
    })
    expect(body.system).toEqual([
      { type: "text", text: "RULES" },
      { type: "text", text: "PROFILE", cache_control: { type: "ephemeral" } },
    ])
    expect(body.messages).toEqual([{ role: "user", content: "facts" }])
    expect(body.thinking).toBeUndefined()

    expect(response.output).toEqual({ title: "Aster" })
    expect(response.usage).toEqual({
      inputTokens: 900,
      outputTokens: 400,
      cacheReadInputTokens: 2000,
      cacheCreationInputTokens: 0,
    })
    expect(response.provider).toBe("anthropic")
  })

  it("shows an image before the text when the request carries one, and a plain string otherwise", async () => {
    const { fetchImpl, calls } = fakeFetch(200, message())
    const provider = createAnthropicProvider({ apiKey: "sk-test", fetch: fetchImpl })

    await provider.generate({ ...request, images: [{ mediaType: "image/jpeg", data: "AAAA" }] })

    expect(calls[0]!.body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
          { type: "text", text: "facts" },
        ],
      },
    ])
  })

  it("never puts the key anywhere but the header", async () => {
    const { fetchImpl, calls } = fakeFetch(200, message())
    const provider = createAnthropicProvider({ apiKey: "sk-secret-value", fetch: fetchImpl })
    await provider.generate(request)
    expect(JSON.stringify(calls[0]!.body)).not.toContain("sk-secret-value")
  })

  it("refuses to be created without a key", () => {
    expect(() =>
      createAnthropicProvider({ apiKey: "", fetch: fakeFetch(200, {}).fetchImpl }),
    ).toThrow(AiError)
  })
})

describe("cost", () => {
  it("prices cached input at the cache rate", () => {
    // 900 uncached input, 2000 cached, 400 output, decision 12 rates.
    const cost = estimateCost({
      inputTokens: 900,
      outputTokens: 400,
      cacheReadInputTokens: 2000,
      cacheCreationInputTokens: 0,
    })
    expect(cost).toBeCloseTo(900 * 2e-6 + 400 * 10e-6 + 2000 * 0.2e-6, 6)
  })
})

describe("failures", () => {
  async function failure(status: number, body: unknown, overrides = {}) {
    const { fetchImpl } = fakeFetch(status, body)
    const provider = createAnthropicProvider({ apiKey: "sk-test", fetch: fetchImpl, ...overrides })
    try {
      await provider.generate(request)
    } catch (error) {
      return error as AiError
    }
    throw new Error("expected a failure")
  }

  const vendorError = {
    type: "error",
    error: { type: "authentication_error", message: "invalid x-api-key" },
  }

  it("normalizes a rejected credential without repeating the vendor's words", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = await failure(401, vendorError)
    expect(error).toBeInstanceOf(AiError)
    expect(error.code).toBe("credentials_invalid")
    expect(error.userMessage).not.toContain("x-api-key")
    spy.mockRestore()
  })

  it("normalizes a refusal", async () => {
    const error = await failure(200, message({ stop_reason: "refusal", content: [] }))
    expect(error.code).toBe("refused")
  })

  it("normalizes a truncated answer", async () => {
    const error = await failure(200, message({ stop_reason: "max_tokens" }))
    expect(error.code).toBe("invalid_output")
  })

  it("normalizes an answer that is not JSON", async () => {
    const error = await failure(200, message({ content: [{ type: "text", text: "not json" }] }))
    expect(error.code).toBe("invalid_output")
  })
})
