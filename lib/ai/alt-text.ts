import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { downloadObject } from "@/lib/products/storage"
import { renderDerivative, type ImageSpec } from "@/lib/products/derivatives"
import { isDerivableImage } from "@/lib/products/sniff"
import { ALT_TEXT_MAX, readAltText } from "@/lib/products/image-metadata"
import type { Product, ProductAsset } from "@/lib/products/types"
import { toJson } from "@/lib/imports/json"
import { buildFactSheet, renderFactSheet } from "./factsheet"
import { describeViolations, validateFactuality } from "./factuality"
import { onlyField } from "./output"
import { getProvider } from "./providers"
import {
  AiError,
  normalizeAiError,
  type AiProvider,
  type ImageInput,
  type PromptBlock,
} from "./types"

/**
 * Alt text for one product image, written by the model from the image itself.
 *
 * This is the one place the model is shown a picture (ADR 0014). Everything
 * else in lib/ai works from the FactSheet alone and is told it cannot see the
 * product, because copy that describes how a typeface looks is a claim about
 * the product. Alt text is different in kind: it is a description of a
 * picture, for a buyer who cannot see the picture, and the only honest source
 * for that is the picture. The image is a fact source for the sentence that
 * describes it, and for nothing else: nothing seen here becomes a product
 * fact, reaches the FactSheet, or is stated anywhere but this asset's alt.
 *
 * The rule of the whole AI layer still applies to the words. The factuality
 * validator runs on the answer against the product's FactSheet, so a model
 * that counts the weights on a specimen sheet, or names the scripts it can
 * read there, is refused unless the creator has stated those facts. One
 * retry names the refused values; a second refusal leaves the field empty for
 * the creator, who sees the readiness nudge exactly as before.
 *
 * Runs as a job, after an image finalizes and on request from the editor.
 * Writes `metadata.altText` with `altTextSource: "generated"`, and only onto
 * an image that has none, so it never overwrites what a creator typed.
 */

export interface DescribeImagePayload {
  workspaceId: string
  assetId: string
}

export interface DescribeImageDeps {
  /** Test seam. Production resolves the configured provider. */
  provider?: AiProvider
}

export type DescribeImageOutcome =
  | { status: "written"; altText: string }
  | { status: "skipped"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "failed"; reason: string }

/** Moves whenever the rules text or the assembly changes. */
export const ALT_RULES_VERSION = "2026-09-17.1"

const RULES = `You write alt text for product images, for independent creators who sell digital products: fonts, templates, graphics, photos, illustrations, icons, mockups, brushes, 3D assets and themes. You are shown one image and the VERIFIED PRODUCT FACTS about the product it belongs to.

Alt text is read aloud to a buyer who cannot see the image. Say what they would need to know: what kind of picture it is (a specimen sheet, a lockup, a poster, a mockup, a screenshot, a photograph), what is set or shown in it, the words that appear in it, quoted as they appear, and the ground it sits on when that matters. One or two plain sentences, at most 250 characters. No "image of" or "picture of", no filename, no marketing, no exclamation.

The rule, precisely:

- Describe only what is visible. Name the product by its name from the facts.
- State nothing about the product that is not both visible and in the facts. Not a count of anything: weights, styles, glyphs, files, pages, items. Not a format, a piece of software, a platform or a device. Not a language, a writing system or a script, unless the facts list it; describe such text as text. Not a license, a price, a year, a version or a promise. If you would need to count or estimate to say it, do not say it.
- Do not use numbers or number words, including "several", "many" or "a few". Describe what is shown without saying how many.
- Do not name the sales channel and do not say the text was written by a model.

Output is a single JSON object with one key, altText, whose value is the alt text as a string.`

const OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["altText"],
  properties: {
    altText: {
      type: "string",
      description: `The alt text, one or two sentences, at most ${ALT_TEXT_MAX} characters.`,
    },
  },
}

const outputSchema = z.object({
  altText: z
    .string()
    .trim()
    .min(1)
    .max(ALT_TEXT_MAX * 2),
})

const MAX_OUTPUT_TOKENS = 300

/**
 * What the model is shown. Scaled to fit 1568 on a side and re-encoded as
 * JPEG in memory, never stored: that is the size the provider reads at full
 * fidelity, and a 6000-pixel specimen sent whole would cost the same answer
 * many times over. A GIF contributes its first frame.
 */
const LOOK_SPEC: ImageSpec = {
  key: "look-1568",
  width: 1568,
  height: 1568,
  fit: "inside",
  format: "jpeg",
  quality: 80,
}

export function buildAltTextPrompt(input: {
  facts: string
  position: number
  total: number
  filename: string
  refused?: readonly string[]
}): { system: PromptBlock[]; user: string } {
  const where =
    input.position === 0
      ? "This is the cover image, the first a storefront shows."
      : `This is image ${input.position + 1} of ${input.total}.`
  const again =
    input.refused && input.refused.length > 0
      ? `\n\nA previous answer was refused because it stated something the facts do not support: ${input.refused.join(", ")}. Write it again without stating any of those, and without any count or quantity.`
      : ""
  return {
    system: [{ text: RULES, cacheBoundary: true }],
    user: `=== VERIFIED PRODUCT FACTS ===
${input.facts}
=== END OF VERIFIED PRODUCT FACTS ===

${where} The creator named the file "${input.filename}"; the name is a hint about intent, never a fact about the picture. Write the alt text now from what you can see. Respond with the JSON object and nothing else.${again}`,
  }
}

/** Trims an answer that ran long to a sentence, then a word, under the cap. */
export function clipAltText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= ALT_TEXT_MAX) return trimmed
  const head = trimmed.slice(0, ALT_TEXT_MAX)
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"))
  if (sentence > ALT_TEXT_MAX / 2) return head.slice(0, sentence + 1)
  const word = head.lastIndexOf(" ")
  return (word > 0 ? head.slice(0, word) : head).replace(/[,;:\s]+$/, "")
}

export async function describeImage(
  payload: DescribeImagePayload,
  deps: DescribeImageDeps = {},
): Promise<DescribeImageOutcome> {
  const admin = createAdminClient()

  const { data: asset, error } = await admin
    .from("product_assets")
    .select("*")
    .eq("id", payload.assetId)
    .eq("workspace_id", payload.workspaceId) // service role bypasses RLS; scope by hand
    .maybeSingle()
  if (error) throw error
  if (!asset) return { status: "skipped", reason: "asset not found" }

  const row = asset as ProductAsset
  if (row.asset_state !== "ready") return { status: "skipped", reason: "not ready" }
  if (row.derived_from !== null) return { status: "skipped", reason: "a rendition" }
  if (row.asset_type !== "cover_image" && row.asset_type !== "preview_image") {
    return { status: "skipped", reason: "not a product image" }
  }
  if (!row.mime_type || !isDerivableImage(row.mime_type)) {
    return { status: "skipped", reason: "not a picture the model can be shown" }
  }
  if (readAltText(row.metadata).trim().length > 0) {
    return { status: "skipped", reason: "already described" }
  }

  const provider = deps.provider ?? getProvider()
  if (!provider) return { status: "skipped", reason: "not configured" }

  const { data: product } = await admin
    .from("products")
    .select("*")
    .eq("id", row.product_id)
    .eq("workspace_id", payload.workspaceId)
    .maybeSingle()
  if (!product) return { status: "skipped", reason: "product not found" }

  const { data: assetRows } = await admin
    .from("product_assets")
    .select("*")
    .eq("product_id", row.product_id)
    .eq("workspace_id", payload.workspaceId)
    .order("sort_order", { ascending: true })
  const assets = (assetRows ?? []) as ProductAsset[]

  const sheet = buildFactSheet(product as Product, assets)
  const siblings = assets
    .filter(
      (candidate) =>
        candidate.derived_from === null &&
        candidate.asset_state === "ready" &&
        (candidate.asset_type === "cover_image" || candidate.asset_type === "preview_image"),
    )
    .sort(
      (a, b) =>
        Number(b.asset_type === "cover_image") - Number(a.asset_type === "cover_image") ||
        a.sort_order - b.sort_order ||
        a.created_at.localeCompare(b.created_at),
    )
  const position = Math.max(
    0,
    siblings.findIndex((candidate) => candidate.id === row.id),
  )

  let look: ImageInput
  try {
    const bytes = await downloadObject(row.storage_path)
    const rendered = await renderDerivative(bytes, LOOK_SPEC)
    look = { mediaType: "image/jpeg", data: rendered.data.toString("base64") }
  } catch (cause) {
    console.error("[ai] alt text: could not read the image", { assetId: row.id, cause })
    return { status: "failed", reason: "The image could not be read." }
  }

  const facts = renderFactSheet(sheet)
  let refused: string[] = []

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = buildAltTextPrompt({
      facts,
      position,
      total: siblings.length,
      filename: row.filename,
      refused,
    })

    let response
    try {
      response = await provider.generate({
        system: prompt.system,
        user: prompt.user,
        images: [look],
        outputSchema: OUTPUT_JSON_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
    } catch (cause) {
      const normalized = cause instanceof AiError ? cause : normalizeAiError(cause)
      console.error("[ai] alt text: provider call failed", {
        assetId: row.id,
        code: normalized.code,
      })
      return { status: "failed", reason: normalized.userMessage }
    }

    console.info("[ai] alt text", {
      assetId: row.id,
      attempt,
      provider: response.provider,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      estimatedCost: response.estimatedCost,
    })

    const parsed = outputSchema.safeParse(response.output)
    if (!parsed.success)
      return { status: "failed", reason: "The answer came back in the wrong shape." }
    const altText = clipAltText(parsed.data.altText)

    // The same validator, the same FactSheet. Alt text is checked as one
    // field of an otherwise empty listing, exactly as a regenerated field is.
    const verdict = validateFactuality(onlyField("shortDescription", altText), sheet)
    if (!verdict.ok) {
      refused = [...new Set(verdict.violations.map((violation) => violation.value))]
      if (attempt === 0) continue
      const reason = describeViolations(verdict.violations)
      console.warn("[ai] alt text refused twice", { assetId: row.id, reason })
      return { status: "rejected", reason }
    }

    // Re-read before writing: a creator may have typed their own meanwhile,
    // and theirs wins. `metadata` is outside the immutability trigger's reach.
    const { data: current } = await admin
      .from("product_assets")
      .select("metadata")
      .eq("id", row.id)
      .eq("workspace_id", payload.workspaceId)
      .maybeSingle()
    if (!current) return { status: "skipped", reason: "asset removed" }
    if (readAltText(current.metadata).trim().length > 0) {
      return { status: "skipped", reason: "described meanwhile" }
    }

    const { error: writeError } = await admin
      .from("product_assets")
      .update({
        metadata: toJson({
          ...((current.metadata as Record<string, unknown>) ?? {}),
          altText,
          altTextSource: "generated",
        }),
      })
      .eq("id", row.id)
      .eq("workspace_id", payload.workspaceId)
    if (writeError) throw writeError

    return { status: "written", altText }
  }

  return { status: "failed", reason: "No answer was produced." }
}
