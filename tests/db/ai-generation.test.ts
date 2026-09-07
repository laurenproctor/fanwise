import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminClient, createActor, destroyActor, type Actor } from "./harness"
import { startGeneration } from "@/lib/ai/start"
import { runGeneration } from "@/lib/ai/runner"
import type { AiProvider, GenerationRequest, GenerationResponse } from "@/lib/ai/types"
import { AiError } from "@/lib/ai/types"
import type { JobQueue } from "@/lib/jobs"

/**
 * A generation, end to end, against real Postgres with RLS on and the model
 * replaced by a script.
 *
 * The provider is the only thing faked. The row, the claim, the FactSheet,
 * the prompt, the validator, the listing write and the snapshot are all the
 * real ones, so what these prove is the part of B1 that never bends: a
 * fabricated claim leaves the listing untouched and says so, and a supported
 * one lands with a snapshot and a hash that traces it to its facts.
 */

let alice: Actor
let channelId: string
let listingId: string
let productId: string

const FACTS = {
  name: "Aster Grotesk",
  description: "A grotesque in nine weights, drawn for long text.",
}

function scripted(output: unknown): AiProvider {
  return {
    name: "scripted",
    model: "scripted-1",
    async generate(_request: GenerationRequest): Promise<GenerationResponse> {
      return {
        output,
        usage: {
          inputTokens: 1000,
          outputTokens: 300,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        estimatedCost: 0.005,
        provider: "scripted",
        model: "scripted-1",
      }
    },
  }
}

const failing: AiProvider = {
  name: "scripted",
  model: "scripted-1",
  async generate() {
    throw new AiError("rate_limited", "Composing is busy right now. Try again in a minute.")
  },
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250))
}

async function generationRow(id: string) {
  const { data } = await adminClient().from("ai_generations").select("*").eq("id", id).single()
  return data!
}

async function listingRow(id: string) {
  const { data } = await adminClient().from("channel_listings").select("*").eq("id", id).single()
  return data!
}

/**
 * A queue that records the hand-off and runs nothing, so the test decides
 * which provider runs the row. The in-process queue would start the real,
 * unconfigured provider on a microtask and win the claim; a run whose outcome
 * depends on microtask order is not a test of the validator.
 */
const parked: { name: string; payload: unknown }[] = []
const parkingQueue: JobQueue = {
  async enqueue(name, payload, options) {
    parked.push({ name, payload })
    return { id: `parked-${parked.length}`, name, payload, enqueuedAt: new Date(), ...options }
  },
}

/** Starts a generation and runs it with the given provider. */
async function generate(provider: AiProvider) {
  const outcome = await startGeneration({
    supabase: alice.client,
    workspaceId: alice.workspaceId,
    productId,
    listingId,
    userId: alice.userId,
    queue: parkingQueue,
  })
  if (outcome.kind !== "started") throw new Error(`unexpected outcome ${outcome.kind}`)
  await runGeneration(
    { workspaceId: alice.workspaceId, generationId: outcome.generationId },
    { provider },
  )
  await settle()
  return outcome.generationId
}

beforeAll(async () => {
  const { data: channels, error } = await adminClient().from("channels").select("id, key")
  if (error) throw new Error(`could not read channels: ${error.message}`)
  channelId = channels.find((c) => c.key === "mock_api")!.id

  alice = await createActor("gen")

  const { data: product, error: productError } = await alice.client
    .from("products")
    .insert({
      workspace_id: alice.workspaceId,
      name: FACTS.name,
      slug: "aster-grotesk",
      product_type: "font",
      canonical_description: FACTS.description,
      base_price: 48,
      currency: "USD",
      metadata: { kind: "font", styleCount: 9 },
    })
    .select("id")
    .single()
  if (productError) throw new Error(`product: ${productError.message}`)
  productId = product.id

  const { data: connection, error: connectionError } = await alice.client
    .from("channel_connections")
    .insert({
      workspace_id: alice.workspaceId,
      channel_id: channelId,
      external_account_id: "gen-shop",
      status: "active",
    })
    .select("id")
    .single()
  if (connectionError) throw new Error(`connection: ${connectionError.message}`)

  const { data: listing, error: listingError } = await alice.client
    .from("channel_listings")
    .insert({
      workspace_id: alice.workspaceId,
      product_id: productId,
      channel_id: channelId,
      channel_connection_id: connection.id,
      title: "Hand-written title",
      description: "Hand-written description that the creator typed.",
      price: 48,
      currency: "USD",
      category: "font",
    })
    .select("id")
    .single()
  if (listingError) throw new Error(`listing: ${listingError.message}`)
  listingId = listing.id
})

afterAll(async () => {
  await destroyActor(alice)
})

describe("a fabricated claim", () => {
  it("is rejected, recorded, and leaves the listing untouched", async () => {
    const id = await generate(
      scripted({
        title: "Aster Grotesk",
        description: "Twelve weights and 800 glyphs, with lifetime updates.",
        shortDescription: "",
        seoTitle: "",
        seoDescription: "",
        tags: ["grotesque"],
      }),
    )

    expect(parked.at(-1)).toEqual({
      name: "generate_listing",
      payload: { workspaceId: alice.workspaceId, generationId: id },
    })

    const row = await generationRow(id)
    expect(row.status).toBe("rejected")
    expect(row.error_message).toContain("Twelve")
    expect(row.error_message).toContain("800")
    expect(row.error_message).toContain("lifetime updates")
    expect(row.applied_at).toBeNull()
    expect(row.structured_output).not.toBeNull()
    expect(Array.isArray(row.violations)).toBe(true)
    expect(row.input_tokens).toBe(1000)
    expect(row.factsheet_hash).toMatch(/^[0-9a-f]{64}$/)

    const listing = await listingRow(listingId)
    expect(listing.title).toBe("Hand-written title")
    expect(listing.description).toBe("Hand-written description that the creator typed.")
    expect(listing.generated_at).toBeNull()

    const { data: snapshots } = await adminClient()
      .from("listing_snapshots")
      .select("id")
      .eq("channel_listing_id", listingId)
      .eq("snapshot_type", "generate")
    expect(snapshots).toHaveLength(0)
  })
})

describe("a supported listing", () => {
  let id: string

  it("lands on the listing, keeps price and category, and is traceable", async () => {
    id = await generate(
      scripted({
        title: "Aster Grotesk — a grotesque for long text",
        description: "Nine weights, drawn for running text. Priced at $48.",
        shortDescription: "Nine weights for long text.",
        seoTitle: "",
        seoDescription: "",
        tags: ["grotesque", "sans", "Grotesque"],
      }),
    )

    const row = await generationRow(id)
    expect(row.status).toBe("succeeded")
    expect(row.applied_at).not.toBeNull()
    expect(row.provider).toBe("scripted")
    expect(Number(row.estimated_cost)).toBeCloseTo(0.005, 6)

    const listing = await listingRow(listingId)
    expect(listing.title).toBe("Aster Grotesk — a grotesque for long text")
    expect(listing.tags).toEqual(["grotesque", "sans"])
    expect(listing.seo_title).toBeNull()
    // Not the model's to decide.
    expect(Number(listing.price)).toBe(48)
    expect(listing.category).toBe("font")
    expect(listing.generated_at).not.toBeNull()
    expect((listing.metadata as Record<string, unknown>).composedAt).toBeTruthy()
  })

  it("writes one immutable generate snapshot naming the generation", async () => {
    const { data } = await adminClient()
      .from("listing_snapshots")
      .select("payload")
      .eq("channel_listing_id", listingId)
      .eq("snapshot_type", "generate")
    expect(data).toHaveLength(1)
    const generation = (data![0]!.payload as Record<string, unknown>).generation as Record<
      string,
      unknown
    >
    expect(generation.id).toBe(id)
    expect(generation.factsheetHash).toBe((await generationRow(id)).factsheet_hash)
  })

  it("refuses a second generation while one is in flight", async () => {
    const { error } = await alice.client.from("ai_generations").insert({
      workspace_id: alice.workspaceId,
      product_id: productId,
      channel_listing_id: listingId,
      status: "pending",
    })
    expect(error).toBeNull()

    const outcome = await startGeneration({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      productId,
      listingId,
      userId: alice.userId,
      queue: parkingQueue,
    })
    expect(outcome.kind).toBe("already_running")

    // Clean up the deliberately stuck row so later tests can compose again.
    await adminClient()
      .from("ai_generations")
      .delete()
      .eq("channel_listing_id", listingId)
      .eq("status", "pending")
    await settle()
  })
})

describe("a provider failure", () => {
  it("is recorded as failed with the normalized message and nothing else", async () => {
    const before = await listingRow(listingId)
    const id = await generate(failing)
    const row = await generationRow(id)
    expect(row.status).toBe("failed")
    expect(row.error_code).toBe("rate_limited")
    expect(row.error_message).toBe("Composing is busy right now. Try again in a minute.")
    expect(row.structured_output).toBeNull()

    const after = await listingRow(listingId)
    expect(after.title).toBe(before.title)
    expect(after.updated_at).toBe(before.updated_at)
  })
})

describe("the record is the system's", () => {
  it("a member cannot rewrite a generation's outcome", async () => {
    const { data: rows } = await alice.client
      .from("ai_generations")
      .select("id, status")
      .eq("channel_listing_id", listingId)
    expect(rows!.length).toBeGreaterThan(0)

    const target = rows![0]!
    const { data, error } = await alice.client
      .from("ai_generations")
      .update({ status: "succeeded" })
      .eq("id", target.id)
      .select("id")
    // No update grant: refused before RLS is consulted.
    expect(error?.code).toBe("42501")
    expect(data).toBeNull()

    const { data: check } = await adminClient()
      .from("ai_generations")
      .select("status")
      .eq("id", target.id)
      .single()
    expect(check!.status).toBe(target.status)
  })
})
