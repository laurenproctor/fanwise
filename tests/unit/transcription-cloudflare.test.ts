import { describe, expect, it } from "vitest"
import { getTranscriptionProvider } from "@/lib/ai/transcription"
import { TranscriptionError } from "@/lib/ai/transcription/types"
import {
  CLOUDFLARE_WHISPER_MODEL,
  createCloudflareTranscriber,
} from "@/lib/ai/transcription/providers/cloudflare"
import { readCloudflareConfig } from "@/lib/ai/transcription/providers/cloudflare/config"
import { transcribeAudio } from "@/lib/imports/transcribe"

/**
 * The Cloudflare Workers AI transcription adapter, against a scripted fetch.
 *
 * No request leaves the machine. What is proven: the request carries the audio
 * and nothing else, the response is validated, and every failure becomes a
 * normalized code the composer can explain.
 */

const ACCOUNT = "0123456789abcdef0123456789abcdef"
const CONFIG = { accountId: ACCOUNT, apiToken: "test-token" }
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])

function scripted(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status })
  }
  return { calls, fetchImpl }
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof TranscriptionError) return error.code
    throw error
  }
  throw new Error("expected a failure")
}

describe("configuration", () => {
  it("needs both values, and an account id of the right shape", () => {
    expect(readCloudflareConfig({})).toBeNull()
    expect(readCloudflareConfig({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT })).toBeNull()
    expect(
      readCloudflareConfig({ CLOUDFLARE_ACCOUNT_ID: "../../x", CLOUDFLARE_AI_API_TOKEN: "t" }),
    ).toBeNull()
    expect(
      readCloudflareConfig({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_AI_API_TOKEN: " t " }),
    ).toEqual({ accountId: ACCOUNT, apiToken: "t" })
  })

  it("is the deployment's provider when configured, and nothing is when it is not", () => {
    const provider = getTranscriptionProvider({
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      CLOUDFLARE_AI_API_TOKEN: "t",
    })
    expect(provider?.name).toBe("cloudflare")
    expect(getTranscriptionProvider({})).toBeNull()
  })
})

describe("a transcription request", () => {
  it("sends the audio, base64, to the model, with the token as a bearer and nothing else", async () => {
    const { calls, fetchImpl } = scripted(200, {
      success: true,
      result: { text: "A canvas tote.", transcription_info: { duration: 84.2 } },
    })
    const result = await createCloudflareTranscriber(CONFIG, fetchImpl).transcribe({
      audio: WEBM,
      mimeType: "audio/webm",
    })

    expect(result).toEqual({
      text: "A canvas tote.",
      durationMs: 84_200,
      provider: "cloudflare",
      model: CLOUDFLARE_WHISPER_MODEL,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${CLOUDFLARE_WHISPER_MODEL}`,
    )
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer test-token")
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(Object.keys(body).sort()).toEqual(["audio", "task"])
    expect(Buffer.from(body.audio, "base64")).toEqual(Buffer.from(WEBM))
  })

  it("reports no duration when the provider gives none", async () => {
    const { fetchImpl } = scripted(200, { success: true, result: { text: "Hi" } })
    const result = await createCloudflareTranscriber(CONFIG, fetchImpl).transcribe({
      audio: WEBM,
      mimeType: "audio/webm",
    })
    expect(result.durationMs).toBeNull()
  })
})

describe("failures, normalized", () => {
  const transcribe = (status: number, body: unknown) =>
    createCloudflareTranscriber(CONFIG, scripted(status, body).fetchImpl).transcribe({
      audio: WEBM,
      mimeType: "audio/webm",
    })

  it("reads a refused token as not configured", async () => {
    expect(await codeOf(transcribe(401, { success: false }))).toBe("not_configured")
    expect(await codeOf(transcribe(403, { success: false }))).toBe("not_configured")
  })

  it("reads a rejected upload as unreadable audio", async () => {
    expect(await codeOf(transcribe(400, { success: false }))).toBe("unreadable_audio")
    expect(await codeOf(transcribe(413, "too big"))).toBe("unreadable_audio")
  })

  it("reads throttling and outages as the provider being unavailable", async () => {
    expect(await codeOf(transcribe(429, {}))).toBe("provider_unavailable")
    expect(await codeOf(transcribe(503, "down"))).toBe("provider_unavailable")
    const offline = createCloudflareTranscriber(CONFIG, async () => {
      throw new TypeError("fetch failed")
    })
    expect(await codeOf(offline.transcribe({ audio: WEBM, mimeType: "audio/webm" }))).toBe(
      "provider_unavailable",
    )
  })

  it("refuses a response that does not match the documented shape", async () => {
    expect(await codeOf(transcribe(200, "<html>"))).toBe("unknown")
    expect(await codeOf(transcribe(200, { success: false, result: null }))).toBe("unknown")
    expect(await codeOf(transcribe(200, { success: true, result: { words: 3 } }))).toBe("unknown")
  })

  it("reaches the composer as sentences Fanwise wrote, never the provider's", async () => {
    const provider = createCloudflareTranscriber(CONFIG, scripted(401, {}).fetchImpl)
    expect((await transcribeAudio(WEBM, provider)).errorCode).toBe("transcription_unavailable")
    const down = createCloudflareTranscriber(CONFIG, scripted(503, {}).fetchImpl)
    expect(await transcribeAudio(WEBM, down)).toEqual({
      status: "failed",
      text: null,
      errorCode: "provider_error",
    })
  })
})
