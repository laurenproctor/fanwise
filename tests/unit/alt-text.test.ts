import { readFile } from "node:fs/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AiProvider, GenerationRequest } from "@/lib/ai/types"

/*
  The alt text job, run for real, with the database and storage replaced and
  the model scripted. What is under test is the contract of ADR 0014: the model
  is shown the picture and the FactSheet, its sentence passes the same
  factuality validator every listing does, a refusal is retried once with the
  refused values named, and the words land on the asset's metadata as a
  labelled suggestion that never overwrites a creator's own.
*/

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  downloads: 0,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = []
      const matching = () =>
        (state.rows[table] ?? []).filter((row) => filters.every(([k, v]) => row[k] === v))
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters.push([key, value])
          return builder
        },
        order: async () => ({ data: matching(), error: null }),
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        update: (patch: Record<string, unknown>) => {
          const chain = {
            eq: (key: string, value: unknown) => {
              filters.push([key, value])
              return chain
            },
            then: (resolve: (v: { error: null }) => void) => {
              for (const row of matching()) Object.assign(row, patch)
              state.updates.push({ table, patch })
              resolve({ error: null })
            },
          }
          return chain
        },
      }
      return builder
    },
  }),
}))
vi.mock("@/lib/products/storage", () => ({
  downloadObject: async () => {
    state.downloads += 1
    return readFile("tests/fixtures/small-800x600.png")
  },
}))

import { buildAltTextPrompt, clipAltText, describeImage } from "@/lib/ai/alt-text"

const payload = { workspaceId: "ws-1", assetId: "img-1" }

function image(overrides: Record<string, unknown> = {}) {
  return {
    id: "img-1",
    workspace_id: "ws-1",
    product_id: "product-1",
    asset_type: "cover_image",
    asset_state: "ready",
    storage_path: "ws-1/product-1/img-1.png",
    filename: "aster-cover.png",
    mime_type: "image/png",
    byte_size: 1000,
    checksum: "sum",
    sort_order: 0,
    derived_from: null,
    spec_hash: null,
    failure_reason: null,
    metadata: { width: 800, height: 600 },
    created_at: "2026-09-17T00:00:00Z",
    ...overrides,
  }
}

const product = {
  id: "product-1",
  workspace_id: "ws-1",
  name: "Aster Grotesk",
  slug: "aster-grotesk",
  product_type: "font",
  canonical_title: "Aster Grotesk",
  canonical_description: "A grotesque drawn for long text.",
  short_description: null,
  brand_name: "Aster Type",
  base_price: 48,
  currency: "USD",
  metadata: { kind: "font" },
  version: null,
  license_summary: null,
  support_url: null,
  documentation_url: null,
}

function scripted(answers: unknown[]): AiProvider & { requests: GenerationRequest[] } {
  const requests: GenerationRequest[] = []
  return {
    name: "test",
    model: "test-model",
    requests,
    async generate(request) {
      requests.push(request)
      const output = answers.shift()
      return {
        output,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        estimatedCost: 0,
        provider: "test",
        model: "test-model",
      }
    },
  }
}

beforeEach(() => {
  state.rows = { product_assets: [image()], products: [product] }
  state.updates = []
  state.downloads = 0
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("describe_image", () => {
  it("shows the model the picture and the facts, and writes its sentence as a suggestion", async () => {
    const provider = scripted([{ altText: "Aster Grotesk set large in white on a black card." }])

    const outcome = await describeImage(payload, { provider })

    expect(outcome).toEqual({
      status: "written",
      altText: "Aster Grotesk set large in white on a black card.",
    })
    const request = provider.requests[0]!
    expect(request.images).toHaveLength(1)
    expect(request.images![0]!.mediaType).toBe("image/jpeg")
    expect(request.user).toContain("=== VERIFIED PRODUCT FACTS ===")
    expect(request.user).toContain("Product name: Aster Grotesk")
    expect(request.user).toContain("This is the cover image")
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]!.patch.metadata).toEqual({
      width: 800,
      height: 600,
      altText: "Aster Grotesk set large in white on a black card.",
      altTextSource: "generated",
    })
  })

  it("refuses a sentence that states what the facts do not, names the values, and takes the second answer", async () => {
    const provider = scripted([
      { altText: "A specimen sheet showing nine weights with Cyrillic and Greek." },
      { altText: "A specimen sheet of Aster Grotesk in a range of weights on white." },
    ])

    const outcome = await describeImage(payload, { provider })

    expect(outcome.status).toBe("written")
    expect(provider.requests).toHaveLength(2)
    expect(provider.requests[1]!.user).toContain("A previous answer was refused")
    expect(provider.requests[1]!.user).toContain("nine")
    expect(provider.requests[1]!.user.toLowerCase()).toContain("cyrillic")
    expect(provider.requests[1]!.system).toEqual(provider.requests[0]!.system)
  })

  it("leaves the field empty after a second refusal rather than writing a claim", async () => {
    const provider = scripted([
      { altText: "Nine weights of Aster." },
      { altText: "Supports Cyrillic, Greek and Latin." },
    ])

    const outcome = await describeImage(payload, { provider })

    expect(outcome.status).toBe("rejected")
    expect(state.updates).toHaveLength(0)
  })

  it("never overwrites what a creator wrote", async () => {
    state.rows.product_assets = [image({ metadata: { altText: "Mine." } })]
    const provider = scripted([{ altText: "Theirs." }])

    const outcome = await describeImage(payload, { provider })

    expect(outcome).toEqual({ status: "skipped", reason: "already described" })
    expect(provider.requests).toHaveLength(0)
    expect(state.downloads).toBe(0)
  })

  it("describes only ready source pictures that are product images", async () => {
    const provider = scripted([])
    state.rows.product_assets = [image({ asset_state: "pending" })]
    expect((await describeImage(payload, { provider })).status).toBe("skipped")
    state.rows.product_assets = [image({ derived_from: "other" })]
    expect((await describeImage(payload, { provider })).status).toBe("skipped")
    state.rows.product_assets = [image({ asset_type: "deliverable", mime_type: "application/zip" })]
    expect((await describeImage(payload, { provider })).status).toBe("skipped")
    state.rows.product_assets = [image({ mime_type: "image/svg+xml" })]
    expect((await describeImage(payload, { provider })).status).toBe("skipped")
    expect(provider.requests).toHaveLength(0)
  })

  it("clips an answer that ran long at a sentence, under the cap", () => {
    const long = `${"A specimen sheet of Aster Grotesk on white. ".repeat(4)}Then a very long tail ${"x".repeat(200)}`
    const clipped = clipAltText(long)
    expect(clipped.length).toBeLessThanOrEqual(250)
    expect(clipped.endsWith(".")).toBe(true)
    expect(clipAltText("Short.")).toBe("Short.")
  })

  it("tells the model which image this is, and that the filename is a hint rather than a fact", () => {
    const prompt = buildAltTextPrompt({
      facts: "Product name: Aster",
      position: 2,
      total: 5,
      filename: "aster_weights.png",
    })
    expect(prompt.user).toContain("This is image 3 of 5.")
    expect(prompt.user).toContain('"aster_weights.png"')
    expect(prompt.user).toContain("never a fact about the picture")
    expect(prompt.system[0]!.cacheBoundary).toBe(true)
  })
})
