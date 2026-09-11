import { createAdminClient } from "@/lib/supabase/admin"
import { findAdapter } from "@/lib/channels/registry"
import type { AdapterSubject, ChannelListing } from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"
import { applyCopy, outputToColumns } from "./apply"
import { buildFactSheet, factSheetHash } from "./factsheet"
import { describeViolations, validateFactuality } from "./factuality"
import {
  LISTING_OUTPUT_JSON_SCHEMA,
  fieldOutputJsonSchema,
  fieldOutputSchema,
  listingFieldSchema,
  listingOutputSchema,
  onlyField,
  type ListingOutput,
} from "./output"
import { buildPrompt } from "./prompt"
import { getProvider } from "./providers"
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
    .select("id, product_id, channel_listing_id, generation_type, field")
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
  claimed: {
    product_id: string
    channel_listing_id: string
    generation_type: "listing" | "field"
    field: string | null
  },
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

  // One field or the whole listing. The prefix is the same either way; only
  // the ask and the schema narrow.
  const field = claimed.generation_type === "field" ? listingFieldSchema.parse(claimed.field) : null
  const prompt = buildPrompt(adapter, sheet, field ?? undefined)
  const outputSchema = field === null ? LISTING_OUTPUT_JSON_SCHEMA : fieldOutputJsonSchema(field)

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
      outputSchema,
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

  const parsed =
    field === null
      ? listingOutputSchema.safeParse(response.output)
      : fieldOutputSchema(field).safeParse(response.output)
  if (!parsed.success) {
    await finish({
      status: "failed",
      ...usageFields,
      error_code: "invalid_output",
      error_message: "The composed listing came back in the wrong shape. Try again.",
    })
    return
  }
  const output = parsed.data as Partial<ListingOutput>

  // A field is validated on its own. The other fields were validated when
  // they were produced, or were written by the creator, and are not the
  // model's to answer for here.
  const toValidate =
    field === null
      ? (output as ListingOutput)
      : onlyField(field, output[field] as string | string[])
  const verdict = validateFactuality(toValidate, sheet)
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
    field === null && listing.price === null && fresh.price !== null
      ? { price: fresh.price, currency: fresh.currency }
      : {}
  const categoryFill =
    field === null && listing.category === null && fresh.category !== null
      ? { category: fresh.category }
      : {}

  const applied = await applyCopy({
    client: admin,
    workspaceId,
    listing,
    channel,
    adapter,
    subject,
    columns: { ...outputToColumns(output), ...priceFill, ...categoryFill },
    snapshot: {
      type: "generate",
      record: {
        id: generationId,
        field,
        provider: response.provider,
        model: response.model,
        promptVersion: prompt.promptVersion,
        factsheetHash: sheetHash,
      },
    },
  })

  if (!applied.ok) {
    await finish({
      status: "failed",
      ...usageFields,
      structured_output: output,
      error_code: "unknown",
      error_message: "The listing was composed but could not be saved. Try again.",
    })
    return
  }

  await finish({
    status: "succeeded",
    ...usageFields,
    structured_output: output,
    applied_at: applied.at,
  })
}
