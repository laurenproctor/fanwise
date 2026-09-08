import { createHash } from "node:crypto"
import { constraintsFor } from "@/lib/channels/constraints"
import type { ChannelAdapter, MerchandisingProfile } from "@/lib/channels/types"
import { renderFactSheet, type FactSheet } from "./factsheet"
import type { PromptBlock } from "./types"

/**
 * The prompt, and the shape that makes decision 12's price true.
 *
 * Two system blocks and one user message:
 *
 *   1. RULES     the same bytes for every channel and every product
 *   2. PROFILE   the same bytes for every product on one channel
 *   3. user      the FactSheet, and nothing else that varies
 *
 * Blocks 1 and 2 are the stable prefix. The provider is told to cache through
 * the end of block 2, so a second generation on the same channel reads about
 * two thirds of its input from cache. Nothing that changes per request may
 * appear above the boundary: no product name, no timestamp, no id.
 *
 * The FactSheet is delimited from the instruction, as docs/ai-merchandising.md
 * asks, so the model can tell what it may state from what it is being told to
 * do. The factual rule is stated in the rules block and restated beside the
 * facts, because a rule that appears once is a rule that gets lost under a
 * long profile.
 */

/** Moves whenever the rules text or the assembly changes. */
export const RULES_VERSION = "2026-09-07.1"

const RULES = `You compose product listings for independent creators who sell digital products: fonts, templates, graphics, photos, illustrations, icons, mockups, brushes, 3D assets and themes. You write for one sales channel at a time, following that channel's profile.

You will be given VERIFIED PRODUCT FACTS. They are the only facts you may state. Everything you write about what the product is, what it contains, what it works with, how it is licensed, and how it is supported must come from those facts, in any words you choose.

The rule, precisely:

- You may transform positioning, tone, phrasing, structure, vocabulary and keywords freely.
- You may never introduce a factual claim that is not in the facts. Not a count of anything: styles, weights, glyphs, files, pages, items, images. Not a format. Not a piece of software, a platform or a device the product works with. Not a license term, a warranty, a guarantee, a refund, a support promise or an update promise. Not a year, a version number, a resolution, a size or a price. Not an award, a ranking or a customer count.
- If the facts do not say it, do not say it. Write around the gap. A description that says less and is true is correct; a description that says more and is invented is a defect.
- Do not use numbers you were not given, including number words. Do not name file formats you were not given. Do not name software you were not given.
- Do not mention the sales channel by name and do not mention that the listing was composed.

Output is a single JSON object with exactly these keys: title, description, shortDescription, seoTitle, seoDescription, tags. Every value is a string except tags, which is an array of strings. Use an empty string for a field the profile tells you to leave empty. The description is plain text: paragraphs separated by blank lines, no markdown headings, no bold, no links, no emoji.`

export interface BuiltPrompt {
  system: PromptBlock[]
  user: string
  /** RULES_VERSION and the profile's version, joined. Written to the row. */
  promptVersion: string
  /** SHA-256 of everything sent. */
  inputHash: string
}

function renderLimits(adapter: ChannelAdapter): string {
  const c = constraintsFor(adapter)
  const lines: string[] = []
  const text = (label: string, key: keyof typeof c.text) => {
    const t = c.text[key]
    if (!t) return
    const parts: string[] = []
    if (t.minLength !== undefined) parts.push(`at least ${t.minLength} characters`)
    if (t.maxLength !== undefined) parts.push(`at most ${t.maxLength} characters`)
    if (t.required) parts.push("required")
    if (parts.length > 0) lines.push(`- ${label}: ${parts.join(", ")}`)
  }
  text("title", "title")
  text("description", "description")
  text("shortDescription", "shortDescription")
  text("seoTitle", "seoTitle")
  text("seoDescription", "seoDescription")
  if (c.tags) {
    const parts: string[] = []
    if (c.tags.minCount !== undefined) parts.push(`at least ${c.tags.minCount}`)
    if (c.tags.maxCount !== undefined) parts.push(`at most ${c.tags.maxCount}`)
    if (c.tags.maxTagLength !== undefined)
      parts.push(`each at most ${c.tags.maxTagLength} characters`)
    if (parts.length > 0) lines.push(`- tags: ${parts.join(", ")}`)
  }
  return lines.length > 0 ? lines.join("\n") : "- no channel limits beyond the profile"
}

export function renderProfile(adapter: ChannelAdapter): string {
  const p: MerchandisingProfile = adapter.merchandising
  return `CHANNEL PROFILE

Audience: ${p.audience}

Voice: ${p.voice}

Structure: ${p.structure}

Field guidance:
- title: ${p.fields.title}
- description: ${p.fields.description}
- shortDescription: ${p.fields.shortDescription}
- seoTitle: ${p.fields.seoTitle}
- seoDescription: ${p.fields.seoDescription}
- tags: ${p.fields.tags}

Channel limits, which the channel enforces:
${renderLimits(adapter)}`
}

export function buildPrompt(adapter: ChannelAdapter, sheet: FactSheet): BuiltPrompt {
  const system: PromptBlock[] = [
    { text: RULES },
    { text: renderProfile(adapter), cacheBoundary: true },
  ]

  const user = `=== VERIFIED PRODUCT FACTS ===
${renderFactSheet(sheet)}
=== END OF VERIFIED PRODUCT FACTS ===

=== MERCHANDISING INSTRUCTIONS ===
Compose the listing now, following the channel profile in your instructions. State only what the verified facts state. Respond with the JSON object and nothing else.`

  const hash = createHash("sha256")
  for (const block of system) hash.update(block.text).update("\n---\n")
  hash.update(user)

  return {
    system,
    user,
    promptVersion: `${RULES_VERSION}+${adapter.merchandising.promptVersion}`,
    inputHash: hash.digest("hex"),
  }
}
