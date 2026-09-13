import { classifyHandle } from "./handles"
import { isShown, type ArrangementRow, type Ineligibility } from "./product-arrangement"
import { LINK_PARSERS, type ProfileLinkKind } from "./profile-links"
import {
  checkDetailsStep,
  type DetailsField,
  type DraftProduct,
  type ProfileDraftFields,
} from "./profile-draft"

/**
 * Whether a draft can be published, and exactly what publishing it would write.
 *
 * Pure, so the rule is the same in three places that must agree: the step 3
 * page deciding whether Publish is enabled, the publish action deciding again
 * on the server just before it writes, and the tests. Nothing here reads the
 * network; the two facts that need it — whether the address is free, whether
 * the image object still exists — are passed in.
 *
 * Every blocking issue names the step and the field it lives on, so the screen
 * can send the creator to the one place that fixes it instead of describing
 * the problem from a distance.
 */

const INELIGIBLE_REASONS: Record<Ineligibility, string> = {
  archived: "it's archived.",
  not_live: "it isn't live in a connected shop right now.",
}

export type IssueField = DetailsField | "image" | "products"

export interface ReadinessIssue {
  step: 1 | 2
  field: IssueField
  message: string
}

export type HandleStatus = "available" | "unavailable" | "invalid" | "reserved" | "unknown"

/** The values `publish_public_profile()` writes, in its own column names. */
export interface PublishValues {
  handle: string
  display_name: string
  short_bio: string
  website_url: string
  instagram_url: string
  behance_url: string
}

export interface PublishPlan {
  values: PublishValues
  /** Shown, eligible products, in the draft's order. */
  productIds: string[]
}

export type Readiness =
  | { ready: true; plan: PublishPlan; issues: [] }
  | { ready: false; plan: null; issues: ReadinessIssue[] }

export function evaluateReadiness(input: {
  fields: ProfileDraftFields
  avatar: { path: string | null; resolvable: boolean }
  handleStatus: HandleStatus
  draftProducts: readonly DraftProduct[]
  rows: readonly ArrangementRow[]
}): Readiness {
  const issues: ReadinessIssue[] = []

  const details = checkDetailsStep(input.fields)
  for (const [field, message] of Object.entries(details) as Array<[DetailsField, string]>) {
    issues.push({ step: 1, field, message })
  }

  if (!details.handle) {
    if (input.handleStatus === "unavailable") {
      issues.push({
        step: 1,
        field: "handle",
        message: "That address is now taken. Choose another.",
      })
    } else if (input.handleStatus === "reserved") {
      issues.push({
        step: 1,
        field: "handle",
        message: "That address is reserved. Choose another.",
      })
    } else if (input.handleStatus === "invalid") {
      issues.push({
        step: 1,
        field: "handle",
        message: "That address can't be used. Choose another.",
      })
    } else if (input.handleStatus === "unknown") {
      issues.push({
        step: 1,
        field: "handle",
        message: "We couldn't confirm your address is still available. Try again in a moment.",
      })
    }
  }

  if (input.avatar.path !== null && !input.avatar.resolvable) {
    issues.push({
      step: 1,
      field: "image",
      message: "Your profile image couldn't be found. Choose it again, or remove it.",
    })
  }

  const hasEligible = input.rows.some((row) => row.product.eligibility.eligible)
  if (input.draftProducts.length === 0 && hasEligible) {
    issues.push({ step: 2, field: "products", message: "Choose which products to show." })
  }

  for (const row of input.rows) {
    if (row.visible && !row.product.eligibility.eligible) {
      issues.push({
        step: 2,
        field: "products",
        message: `${row.product.title} is selected, but ${INELIGIBLE_REASONS[row.product.eligibility.reason]} Turn it off in Manage products to continue.`,
      })
    }
  }

  if (issues.length > 0) return { ready: false, plan: null, issues }

  const handle = classifyHandle(input.fields.handle)
  if (handle.kind !== "valid") {
    // Unreachable: checkDetailsStep refuses every other kind above.
    return {
      ready: false,
      plan: null,
      issues: [{ step: 1, field: "handle", message: "Choose your studio address." }],
    }
  }

  return {
    ready: true,
    issues: [],
    plan: {
      values: {
        handle: handle.value,
        display_name: input.fields.displayName.trim(),
        short_bio: input.fields.shortBio.trim(),
        website_url: linkUrl("website", input.fields.website),
        instagram_url: linkUrl("instagram", input.fields.instagram),
        behance_url: linkUrl("behance", input.fields.behance),
      },
      productIds: input.rows.filter(isShown).map((row) => row.product.id),
    },
  }
}

function linkUrl(kind: ProfileLinkKind, raw: string): string {
  const parsed = LINK_PARSERS[kind](raw)
  return parsed.kind === "valid" ? parsed.url : ""
}

/**
 * The snapshot `publish_public_profile()` records, built the same way, so the
 * screen can tell "live is exactly this draft" from "there are changes to
 * publish" without asking the database to compare.
 */
export function snapshotOf(plan: PublishPlan, avatarPath: string | null) {
  const orNull = (value: string) => (value === "" ? null : value)
  return {
    handle: plan.values.handle,
    display_name: plan.values.display_name,
    short_bio: orNull(plan.values.short_bio),
    website_url: orNull(plan.values.website_url),
    instagram_url: orNull(plan.values.instagram_url),
    behance_url: orNull(plan.values.behance_url),
    avatar_path: avatarPath,
    product_ids: plan.productIds,
  }
}

export function sameSnapshot(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    )
  }
  return value
}

/** Where an issue is fixed. The step 1 link names the field so that page can focus it. */
export function issueHref(
  issue: ReadinessIssue,
  routes: { details: string; products: string },
): string {
  return issue.step === 1 ? `${routes.details}?field=${issue.field}` : routes.products
}
