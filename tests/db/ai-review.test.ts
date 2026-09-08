import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminClient, createActor, destroyActor, type Actor } from "./harness"
import { startGeneration } from "@/lib/ai/start"
import { runGeneration } from "@/lib/ai/runner"
import { restoreGeneration } from "@/lib/ai/restore"
import { approveListing } from "@/lib/ai/approve"
import { awaitingReview } from "@/lib/ai/review"
import type { AiProvider, GenerationResponse } from "@/lib/ai/types"
import type { JobQueue } from "@/lib/jobs"

/**
 * B2 against real Postgres with the model scripted: a field regenerates on
 * its own and lands in its one column; an earlier generation restores as the
 * signed-in user; approval is a separate act from saving, and Publish's guard
 * reads the two stamps in the order that keeps composed copy unread off a
 * marketplace.
 */

let alice: Actor
let channelId: string
let listingId: string
let productId: string

const parkingQueue: JobQueue = {
  async enqueue(name, payload, options) {
    return { id: "parked", name, payload, enqueuedAt: new Date(), ...options }
  },
}

function scripted(output: unknown): AiProvider {
  return {
    name: "scripted",
    model: "scripted-1",
    async generate(): Promise<GenerationResponse> {
      return {
        output,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        estimatedCost: 0.001,
        provider: "scripted",
        model: "scripted-1",
      }
    },
  }
}

async function generate(provider: AiProvider, field?: "title" | "description" | "tags") {
  const outcome = await startGeneration({
    supabase: alice.client,
    workspaceId: alice.workspaceId,
    productId,
    listingId,
    userId: alice.userId,
    ...(field ? { field } : {}),
    queue: parkingQueue,
  })
  if (outcome.kind !== "started") throw new Error(`unexpected outcome ${outcome.kind}`)
  await runGeneration(
    { workspaceId: alice.workspaceId, generationId: outcome.generationId },
    { provider },
  )
  return outcome.generationId
}

async function listingRow() {
  const { data } = await adminClient()
    .from("channel_listings")
    .select("*")
    .eq("id", listingId)
    .single()
  return data!
}

async function generationRow(id: string) {
  const { data } = await adminClient().from("ai_generations").select("*").eq("id", id).single()
  return data!
}

beforeAll(async () => {
  const { data: channels } = await adminClient().from("channels").select("id, key")
  channelId = channels!.find((c) => c.key === "mock_api")!.id
  alice = await createActor("review")

  const { data: product } = await alice.client
    .from("products")
    .insert({
      workspace_id: alice.workspaceId,
      name: "Aster Grotesk",
      slug: "aster-grotesk",
      product_type: "font",
      canonical_description: "A grotesque in nine weights.",
      base_price: 48,
      currency: "USD",
      metadata: { kind: "font", styleCount: 9 },
    })
    .select("id")
    .single()
  productId = product!.id

  const { data: connection } = await alice.client
    .from("channel_connections")
    .insert({
      workspace_id: alice.workspaceId,
      channel_id: channelId,
      external_account_id: "review-shop",
      status: "active",
    })
    .select("id")
    .single()

  const { data: listing } = await alice.client
    .from("channel_listings")
    .insert({
      workspace_id: alice.workspaceId,
      product_id: productId,
      channel_id: channelId,
      channel_connection_id: connection!.id,
      title: "Hand-written title",
      description: "Hand-written description, which the creator typed and vouches for.",
      price: 48,
      currency: "USD",
    })
    .select("id")
    .single()
  listingId = listing!.id
})

afterAll(async () => {
  await destroyActor(alice)
})

let wholeId: string
let titleId: string

describe("regenerating one field", () => {
  it("writes that column and leaves the rest alone", async () => {
    wholeId = await generate(
      scripted({
        title: "Aster Grotesk, nine weights",
        description: "Nine weights for running text.",
        shortDescription: "Nine weights.",
        seoTitle: "",
        seoDescription: "",
        tags: ["grotesque"],
      }),
    )
    expect((await generationRow(wholeId)).status).toBe("succeeded")

    titleId = await generate(scripted({ title: "Aster Grotesk for long text" }), "title")
    const row = await generationRow(titleId)
    expect(row.status).toBe("succeeded")
    expect(row.generation_type).toBe("field")
    expect(row.field).toBe("title")
    expect(row.structured_output).toEqual({ title: "Aster Grotesk for long text" })

    const listing = await listingRow()
    expect(listing.title).toBe("Aster Grotesk for long text")
    expect(listing.description).toBe("Nine weights for running text.")
    expect(listing.tags).toEqual(["grotesque"])
  })

  it("is refused on its own field and touches nothing", async () => {
    const before = await listingRow()
    const id = await generate(
      scripted({ description: "Twelve weights and free updates." }),
      "description",
    )
    const row = await generationRow(id)
    expect(row.status).toBe("rejected")
    expect(row.error_message).toContain("Twelve")
    expect((await listingRow()).description).toBe(before.description)
  })

  it("does not fill price or category, which only a whole compose does", async () => {
    await adminClient().from("channel_listings").update({ category: null }).eq("id", listingId)
    await generate(scripted({ tags: ["sans", "grotesque"] }), "tags")
    expect((await listingRow()).category).toBeNull()
  })
})

describe("restoring", () => {
  it("puts an earlier whole generation back, as the signed-in user, with a restore snapshot", async () => {
    const outcome = await restoreGeneration({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      generationId: wholeId,
    })
    expect(outcome.kind).toBe("restored")

    const listing = await listingRow()
    expect(listing.title).toBe("Aster Grotesk, nine weights")
    expect(listing.tags).toEqual(["grotesque"])

    const { data: snapshots } = await adminClient()
      .from("listing_snapshots")
      .select("payload")
      .eq("channel_listing_id", listingId)
      .eq("snapshot_type", "restore")
    expect(snapshots).toHaveLength(1)
    const restore = (snapshots![0]!.payload as Record<string, unknown>).restore as Record<
      string,
      unknown
    >
    expect(restore.generationId).toBe(wholeId)
  })

  it("restores one field from a field generation", async () => {
    const outcome = await restoreGeneration({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      generationId: titleId,
    })
    expect(outcome).toMatchObject({ kind: "restored", field: "title" })
    const listing = await listingRow()
    expect(listing.title).toBe("Aster Grotesk for long text")
    expect(listing.tags).toEqual(["grotesque"])
  })

  it("refuses a rejected generation", async () => {
    const { data: rejected } = await adminClient()
      .from("ai_generations")
      .select("id")
      .eq("channel_listing_id", listingId)
      .eq("status", "rejected")
      .limit(1)
      .single()
    const outcome = await restoreGeneration({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      generationId: rejected!.id,
    })
    expect(outcome.kind).toBe("error")
  })

  it("cannot restore onto another workspace's listing", async () => {
    const bob = await createActor("review-bob")
    try {
      const outcome = await restoreGeneration({
        supabase: bob.client,
        workspaceId: bob.workspaceId,
        generationId: wholeId,
      })
      expect(outcome.kind).toBe("error")
    } finally {
      await destroyActor(bob)
    }
  })
})

describe("approving", () => {
  it("is what clears the review, and a save is not", async () => {
    const before = await listingRow()
    expect(awaitingReview(before)).toBe(true)

    // A save, as updateListingAction performs it: columns only.
    await alice.client
      .from("channel_listings")
      .update({ description: "Edited by hand after the restore." })
      .eq("id", listingId)
    expect(awaitingReview(await listingRow())).toBe(true)

    const outcome = await approveListing({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId,
    })
    expect(outcome.kind).toBe("approved")
    const after = await listingRow()
    expect(after.approved_at).not.toBeNull()
    expect(awaitingReview(after)).toBe(false)
  })

  it("is undone by the next generation landing", async () => {
    await generate(scripted({ tags: ["display"] }), "tags")
    expect(awaitingReview(await listingRow())).toBe(true)
  })

  it("cannot be done from another workspace", async () => {
    const bob = await createActor("review-bob2")
    try {
      const outcome = await approveListing({
        supabase: bob.client,
        workspaceId: bob.workspaceId,
        listingId,
      })
      expect(outcome.kind).toBe("error")
    } finally {
      await destroyActor(bob)
    }
  })
})
