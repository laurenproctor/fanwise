import type {
  AdapterSubject,
  ChannelListingDraft,
  RequirementResult,
  RequirementSpec,
} from "./types"

/**
 * The requirement evaluator.
 *
 * One function walks every spec a channel declares. Adding a channel therefore
 * means writing data, not writing validation code, which is what makes a new
 * assisted channel a config file rather than a feature.
 *
 * Everything here is deterministic and synchronous. No model, no network, no
 * clock: the same product and the same draft always produce the same result,
 * which is the only reason a readiness number is worth showing to anyone.
 */

function textValue(draft: ChannelListingDraft, field: string): string {
  const raw = (draft as unknown as Record<string, unknown>)[field]
  return typeof raw === "string" ? raw.trim() : ""
}

/**
 * What an absent required value says.
 *
 * Named after the button it blocks, because "Title is empty" describes the
 * field and leaves the consequence to be inferred. The creator is looking at a
 * Publish button that will not move; the sentence should say why.
 *
 * Only an error blocks publishing, so only an error may claim to. A warning
 * saying "required" would be lying about a button it does not disable, and the
 * readiness bar renders both kinds in one list, where the two sentences sit
 * next to each other and the difference has to survive being read quickly.
 *
 * The label carries its own article — "A deliverable", "Title" — because the
 * adapters already write them that way and threading an article through would
 * mean every future requirement getting it right a second time.
 */
function requiredToPublish(label: string): string {
  return `${label} is required before you can publish your listing.`
}

function evaluateOne(
  spec: RequirementSpec,
  draft: ChannelListingDraft,
  subject: AdapterSubject,
): RequirementResult {
  const base = {
    key: spec.key,
    label: spec.label,
    description: spec.description,
    severity: spec.severity,
  }

  switch (spec.kind) {
    case "text": {
      const value = textValue(draft, spec.field)
      if (value.length === 0) {
        return {
          ...base,
          satisfied: false,
          message:
            spec.severity === "error" ? requiredToPublish(spec.label) : `${spec.label} is empty.`,
        }
      }
      if (spec.minLength !== undefined && value.length < spec.minLength) {
        return {
          ...base,
          satisfied: false,
          message: `${spec.label} needs at least ${spec.minLength} characters. It has ${value.length}.`,
        }
      }
      if (spec.maxLength !== undefined && value.length > spec.maxLength) {
        return {
          ...base,
          satisfied: false,
          message: `${spec.label} is ${value.length} characters, ${value.length - spec.maxLength} over the limit of ${spec.maxLength}.`,
        }
      }
      return { ...base, satisfied: true }
    }

    case "number": {
      const value = draft[spec.field]
      if (value === null || value === undefined || Number.isNaN(value)) {
        return {
          ...base,
          satisfied: false,
          message:
            spec.severity === "error" ? requiredToPublish(spec.label) : `${spec.label} is not set.`,
        }
      }
      if (spec.min !== undefined && value < spec.min) {
        return {
          ...base,
          satisfied: false,
          message: `${spec.label} is below the minimum of ${spec.min}.`,
        }
      }
      if (spec.max !== undefined && value > spec.max) {
        return {
          ...base,
          satisfied: false,
          message: `${spec.label} is above the maximum of ${spec.max}.`,
        }
      }
      return { ...base, satisfied: true }
    }

    case "tags": {
      const tags = draft.tags
      if (spec.minCount !== undefined && tags.length < spec.minCount) {
        return {
          ...base,
          satisfied: false,
          message: `Add at least ${spec.minCount} tags. There are ${tags.length}.`,
        }
      }
      if (spec.maxCount !== undefined && tags.length > spec.maxCount) {
        return {
          ...base,
          satisfied: false,
          message: `Remove ${tags.length - spec.maxCount} tags. The limit is ${spec.maxCount}.`,
        }
      }
      if (spec.maxTagLength !== undefined) {
        const overlong = tags.filter((tag) => tag.length > spec.maxTagLength!)
        if (overlong.length > 0) {
          return {
            ...base,
            satisfied: false,
            message: `These tags are over ${spec.maxTagLength} characters: ${overlong.join(", ")}.`,
          }
        }
      }
      return { ...base, satisfied: true }
    }

    case "enum": {
      const value = textValue(draft, spec.field)
      if (value.length === 0) {
        return { ...base, satisfied: false, message: `${spec.label} is not set.` }
      }
      if (!spec.allowed.includes(value)) {
        return {
          ...base,
          satisfied: false,
          message: `${value} is not one this channel accepts.`,
        }
      }
      return { ...base, satisfied: true }
    }

    case "asset": {
      // Only a ready asset counts. A pending row is a promise the finalize job
      // has not kept yet, and publishing against one would ship a listing whose
      // file may turn out to be missing or corrupt.
      const matching = subject.assets.filter(
        (asset) => asset.asset_state === "ready" && spec.assetTypes.includes(asset.asset_type),
      )
      if (matching.length < spec.minCount) {
        return {
          ...base,
          satisfied: false,
          message:
            spec.severity === "error" && matching.length === 0
              ? requiredToPublish(spec.label)
              : spec.minCount === 1
                ? `Add ${spec.label.toLowerCase()}.`
                : `Add ${spec.minCount - matching.length} more.`,
        }
      }
      return { ...base, satisfied: true }
    }

    case "custom": {
      const outcome = spec.evaluate(draft, subject)
      return { ...base, satisfied: outcome.satisfied, message: outcome.message }
    }
  }
}

export function evaluateRequirements(
  specs: readonly RequirementSpec[],
  draft: ChannelListingDraft,
  subject: AdapterSubject,
): RequirementResult[] {
  return specs.map((spec) => evaluateOne(spec, draft, subject))
}
