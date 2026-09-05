import type { ChannelAdapter, ListingNumberField, ListingTextField, RequirementSpec } from "./types"

/**
 * Field limits, derived from the requirement specs rather than restated.
 *
 * A character counter that disagrees with the rule which blocks publication is
 * worse than no counter at all: it teaches the creator a limit that is not the
 * real one. So the editor reads its hints from exactly the specs the evaluator
 * walks, and there is no second list to drift.
 *
 * These are hints for the UI only. Nothing here decides whether a listing is
 * publishable; `evaluateRequirements` does that, on the server, at save.
 */

export interface TextConstraint {
  minLength?: number
  maxLength?: number
  /** True when an empty value blocks publication. */
  required: boolean
  allowed?: readonly string[]
}

export interface NumberConstraint {
  min?: number
  max?: number
  required: boolean
}

export interface TagsConstraint {
  minCount?: number
  maxCount?: number
  maxTagLength?: number
  required: boolean
}

export interface ChannelConstraints {
  text: Partial<Record<ListingTextField, TextConstraint>>
  number: Partial<Record<ListingNumberField, NumberConstraint>>
  tags: TagsConstraint | null
}

/**
 * Merges every spec touching a field into one constraint.
 *
 * A channel may declare more than one rule per field, and when it does the
 * tightest limit is the one that matters: a title passing a 120 character rule
 * and failing an 80 character rule is a title that gets rejected. Taking the
 * strictest bound keeps the counter honest about the first wall the creator
 * will hit.
 */
export function constraintsFor(adapter: ChannelAdapter): ChannelConstraints {
  const constraints: ChannelConstraints = { text: {}, number: {}, tags: null }

  for (const spec of adapter.requirements) {
    const required = spec.severity === "error"

    switch (spec.kind) {
      case "text": {
        const existing = constraints.text[spec.field]
        constraints.text[spec.field] = {
          minLength: tightestMin(existing?.minLength, spec.minLength),
          maxLength: tightestMax(existing?.maxLength, spec.maxLength),
          required: (existing?.required ?? false) || required,
          allowed: existing?.allowed,
        }
        break
      }

      case "enum": {
        const existing = constraints.text[spec.field]
        constraints.text[spec.field] = {
          minLength: existing?.minLength,
          maxLength: existing?.maxLength,
          required: (existing?.required ?? false) || required,
          allowed: spec.allowed,
        }
        break
      }

      case "number": {
        const existing = constraints.number[spec.field]
        constraints.number[spec.field] = {
          min: tightestMin(existing?.min, spec.min),
          max: tightestMax(existing?.max, spec.max),
          required: (existing?.required ?? false) || required,
        }
        break
      }

      case "tags": {
        const existing = constraints.tags
        constraints.tags = {
          minCount: tightestMin(existing?.minCount, spec.minCount),
          maxCount: tightestMax(existing?.maxCount, spec.maxCount),
          maxTagLength: tightestMax(existing?.maxTagLength, spec.maxTagLength),
          required: (existing?.required ?? false) || required,
        }
        break
      }

      // An asset rule is about files, not fields, and a custom rule is opaque
      // by construction. Neither yields a limit the editor could render, and
      // both still block through the evaluator.
      case "asset":
      case "custom":
        break
    }
  }

  return constraints
}

/** The larger lower bound is the stricter one. */
function tightestMin(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

/** The smaller upper bound is the stricter one. */
function tightestMax(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

/** A short human summary of a channel's shape, for the listing table. */
export function summarize(adapter: ChannelAdapter): string {
  const c = constraintsFor(adapter)
  const parts: string[] = []

  const title = c.text.title
  if (title?.maxLength !== undefined) parts.push(`${title.maxLength} char title`)

  if (c.tags?.maxCount !== undefined) parts.push(`${c.tags.maxCount} tags`)
  else if (c.tags?.minCount !== undefined) parts.push(`${c.tags.minCount}+ tags`)

  const assetCounts = (adapter.requirements as readonly RequirementSpec[])
    .filter((s) => s.kind === "asset")
    .reduce((total, s) => total + (s.kind === "asset" ? s.minCount : 0), 0)
  if (assetCounts > 0) parts.push(`${assetCounts} files`)

  return parts.join(" · ")
}
