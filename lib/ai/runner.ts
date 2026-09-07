import { createAdminClient } from "@/lib/supabase/admin"
import { evaluate, listingToDraft, snapshotPayload } from "@/lib/channels/listings"
import { listingImages } from "@/lib/channels/images"
import { findAdapter } from "@/lib/channels/registry"
import type { AdapterSubject, ChannelListing } from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"
import { buildFactSheet, factSheetHash } from "./factsheet"
import { describeViolations, validateFactuality } from "./factuality"
import { LISTING_OUTPUT_JSON_SCHEMA, listingOutputSchema } from "./output"
import { buildPrompt } from "./prompt"
import { getProvider } from "./providers"
import { COMPOSED_AT_KEY } from "./review"
import { AiError, normalizeAiError, type AiProvider } from "./types"

/**
 * One generation, run to a recorded end.
 *
 * Runs in a background job holding the service role, so every query scopes
 * `workspace_id` itself, per docs/security.md rule 4. The workspace comes from
 * the job payload, which came from a row an authorized member inserted through
 * RLS; nothing here trusts an argument beyond that.
 *
 * What a generation does, in order, and what each step writes:
 *
 *   1. claim the row                    pending -> running
 *   2. derive the FactSheet             factsheet_hash
 *   3. build the prompt                 prompt_version, input_hash
 *   4. call the provider                provider, model, tokens, cost
 *   5. parse the answer                 structured_output, or failed
 *   6. validate factuality              rejected, with violations
 *   7. apply to the listing             applied_at, and a snapshot
 *
 * Steps 6 and 7 are the ones that matter. A rejected generation leaves the
 * listing exactly as it was; the copy it produced is kept on the row so the
 * creator can be told what was claimed, and so B2 can show it beside the
 * verdict.
 *
 * Credentials never enter this file. The provider reads its own key; the
 * prompt is built from the product and the profile; nothing from
 * channel_connections or channel_connection_secrets is loaded.
 */

export interface RunGenerationPayload {
  workspaceId: string
  generationId: string
}

export interface RunGenerationDeps {
  /** Test seam. Production resolves the configured provider. */
  provider?: AiProvider
}

const MAX_OUTPUT_TOKENS = 4096

export async function runGeneration(
  payload: RunGenerationPayload,
  deps: RunGenerationDeps = {},
): Promise<void> {
  const { workspaceId, generationId } = payload
  const admin = createAdminClient()

  // Claim by compare-and-swap, so a redelivered job does nothing.
  const { data: claimed, error: claimError } = await admin
    .from("ai_generations")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", generationId)
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .select("id, product_id, channel_listing_id")
    .maybeSingle()

  if (claimError) {
    console.error("[ai] could not claim generation", { generationId, error: claimError })
    return
  }
  if (!claimed) return

  const finish = (fields: Record<string, unknown>) =>
    admin
      .from("ai_generations")
      .update({ completed_at: new Date().toISOString(), ...fields })
      .eq("id", generationId)
      .eq("workspace_id", workspaceId)

  try {
    await execute(admin, workspaceId, generationId, claimed, deps, finish)
  } catch (error) {
    // Nothing below may leave the row `running`: a generation stuck there
    // holds the in-flight index and the creator can never compose again.
    const normalized = normalizeAiError(error)
    console.error("[ai] generation failed outside normalization", {
      generationId,
      name: error instanceof Error ? error.name : "unknown",
    })
    await finish({
      status: "failed",
      error_code: normalized.code,
      error_message: normalized.userMessage,
    })
  }
}

async function execute(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  generationId: string,
  claimed: { product_id: string; channel_listing_id: string },
  deps: RunGenerationDeps,
  finish: (fields: Record<string, unknown>) => PromiseLike<unknown>,
): Promise<void> {
  const { data: listingRow, error: listingError } = await admin
    .from("channel_listings")
    .select("*, channel:channels(*)")
    .eq("id", claimed.channel_listing_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (listingError || !listingRow) {
    await finish({
      status: "failed",
      error_code: "unknown",
      error_message: "That listing no longer exists.",
    })
    return
  }

  const { channel, ...listing } = listingRow as ChannelListing & {
    channel: { id: string; key: string; name: string }
  }

  const adapter = findAdapter(channel.key)
  if (!adapter) {
    await finish({
      status: "failed",
      error_code: "unknown",
      error_message: "That channel is no longer available.",
    })
    return
  }

  const { data: product, error: productError } = await admin
    .from("products")
    .select("*")
    .eq("id", claimed.product_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (productError || !product) {
    await finish({
      status: "failed",
      error_code: "unknown",
      error_message: "That product no longer exists.",
    })
    return
  }

  const { data: assetRows } = await admin
    .from("product_assets")
    .select("*")
    .eq("product_id", claimed.product_id)
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })

  const assets = (assetRows ?? []) as ProductAsset[]
  const sheet = buildFactSheet(product as Product, assets)
  const sheetHash = factSheetHash(sheet)
  const prompt = buildPrompt(adapter, sheet)

  // Recorded before the call, so a call that never returns still leaves a row
  // that says what it was asked.
  await admin
    .from("ai_generations")
    .update({
      factsheet_hash: sheetHash,
      prompt_version: prompt.promptVersion,
      input_hash: prompt.inputHash,
    })
    .eq("id", generationId)
    .eq("workspace_id", workspaceId)

  const provider = deps.provider ?? getProvider()
  if (!provider) {
    await finish({
      status: "failed",
      error_code: "not_configured",
      error_message: "Composing is not configured on this deployment.",
    })
    return
  }

  let response
  try {
    response = await provider.generate({
      system: prompt.system,
      user: prompt.user,
      outputSchema: LISTING_OUTPUT_JSON_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
  } catch (error) {
    const normalized = error instanceof AiError ? error : normalizeAiError(error)
    await finish({
      status: "failed",
      provider: provider.name,
      model: provider.model,
      error_code: normalized.code,
      error_message: normalized.userMessage,
    })
    return
  }

  const usageFields = {
    provider: response.provider,
    model: response.model,
    input_tokens: response.usage.inputTokens,
    output_tokens: response.usage.outputTokens,
    cache_read_input_tokens: response.usage.cacheReadInputTokens,
    cache_creation_input_tokens: response.usage.cacheCreationInputTokens,
    estimated_cost: response.estimatedCost,
  }

  const parsed = listingOutputSchema.safeParse(response.output)
  if (!parsed.success) {
    await finish({
      status: "failed",
      ...usageFields,
      error_code: "invalid_output",
      error_message: "The composed listing came back in the wrong shape. Try again.",
    })
    return
  }
  const output = parsed.data

  const verdict = validateFactuality(output, sheet)
  if (!verdict.ok) {
    await finish({
      status: "rejected",
      ...usageFields,
      structured_output: output,
      violations: verdict.violations,
      error_code: null,
      error_message: describeViolations(verdict.violations),
    })
    return
  }

  const now = new Date().toISOString()
  const blank = (value: string) => (value.trim().length === 0 ? null : value.trim())

  const metadata = {
    ...((listing.metadata as Record<string, unknown>) ?? {}),
    [COMPOSED_AT_KEY]: now,
  }

  const subject: AdapterSubject = { product: product as Product, assets }

  /*
   * The fields the model does not write, filled where the listing has none.
   *
   * A listing built before the creator entered a price is born without one,
   * and nothing back-fills it: listings are independent rows and never a live
   * binding to the product. Composing is the moment the creator asks for a
   * finished listing, so it takes what a build would take now — the adapter's
   * own draft — for price, currency and category, and only where the listing
   * holds nothing. A price the creator set on the listing is theirs and stays.
   * Found on the first live generation, where the composed listing was
   * complete in every field but the one the model is forbidden to touch.
   */
  const fresh = adapter.buildListing(subject)
  const priceFill =
    listing.price === null && fresh.price !== null
      ? { price: fresh.price, currency: fresh.currency }
      : {}
  const categoryFill =
    listing.category === null && fresh.category !== null ? { category: fresh.category } : {}

  const { data: updated, error: updateError } = await admin
    .from("channel_listings")
    .update({
      title: blank(output.title),
      description: blank(output.description),
      short_description: blank(output.shortDescription),
      seo_title: blank(output.seoTitle),
      seo_description: blank(output.seoDescription),
      tags: output.tags,
      ...priceFill,
      ...categoryFill,
      generated_at: now,
      metadata: metadata as never,
    })
    .eq("id", listing.id)
    .eq("workspace_id", workspaceId)
    .select("*")
    .single()

  if (updateError || !updated) {
    console.error("[ai] could not apply generation", { generationId, error: updateError })
    await finish({
      status: "failed",
      ...usageFields,
      structured_output: output,
      error_code: "unknown",
      error_message: "The listing was composed but could not be saved. Try again.",
    })
    return
  }

  const draft = listingToDraft(updated as ChannelListing)
  const evaluation = evaluate(adapter, draft, subject)

  // Invariant 4, applied to a generation: the copy that landed, the verdict it
  // received, and which generation produced it.
  const { error: snapshotError } = await admin.from("listing_snapshots").insert({
    workspace_id: workspaceId,
    channel_listing_id: listing.id,
    product_id: listing.product_id,
    channel_id: channel.id,
    snapshot_type: "generate",
    payload: {
      ...snapshotPayload(draft, evaluation, listingImages(subject)),
      generation: {
        id: generationId,
        provider: response.provider,
        model: response.model,
        promptVersion: prompt.promptVersion,
        factsheetHash: sheetHash,
        at: now,
      },
    } as never,
  })

  if (snapshotError) {
    // A gap in the history, not a broken generation. The listing holds the copy
    // either way, and the ai_generations row still records what produced it.
    console.error("[ai] snapshot insert failed", snapshotError)
  }

  await finish({
    status: "succeeded",
    ...usageFields,
    structured_output: output,
    applied_at: now,
  })
}
