import type { ProductType } from "@/lib/products/types"

/**
 * Importing a product from a link: the vocabulary.
 *
 * Everything in `lib/imports` is pure and has no network, no database and no
 * React. The UI renders it, the tests drive it directly, and the day real
 * ingestion is wired the service boundary in `service.ts` is the only file that
 * changes shape.
 *
 * The distinction this module exists to hold is between **a fact the source
 * stated** and **a value a model proposed**. Architecture invariant 5 says AI
 * may never introduce a factual claim absent from the FactSheet, and the
 * FactSheet is derived from the canonical product. So a model-proposed value
 * that reached `products` unreviewed would become a fact Fanwise is willing to
 * restate on every other channel — having invented it here. `FieldOrigin` is
 * what keeps the two apart, and `readiness.ts` is what makes the difference
 * cost something.
 */

/**
 * Which kind of thing a link points at.
 *
 * The keys are generic; which real provider each one means lives in
 * `sources/registry.ts` and nowhere else, the way `lib/channels/registry.ts`
 * holds the channel keys. Code outside that directory branches on the kind, not
 * on a provider's name.
 */
export const SOURCE_KINDS = ["hosted_artifact", "webpage"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/**
 * Where in a document an observed fact was read.
 *
 * Kept because "the page said so" is not specific enough to defend. A title
 * from an `og:title` was authored for sharing; a title scraped from `<title>`
 * may be the site's name with the page's name appended. The UI names the origin
 * so a creator can judge the value rather than trust it.
 */
export const OBSERVATION_ORIGINS = ["og", "twitter", "meta", "dom", "header"] as const
export type ObservationOrigin = (typeof OBSERVATION_ORIGINS)[number]

export const OBSERVATION_ORIGIN_LABELS: Record<ObservationOrigin, string> = {
  og: "Open Graph tag",
  twitter: "Twitter card",
  meta: "Meta tag",
  dom: "Page content",
  header: "Response header",
}

/**
 * Where one field's current value came from.
 *
 * Three kinds, not a boolean, because a boolean would have to be re-read as
 * "trusted" by the next person and there is no such thing here. `observed` is
 * what the source said. `suggested` is what a model proposed from it, and it
 * carries whether a person has looked at it. `creator` is typed by a human and
 * needs no marker beyond its absence.
 */
export type FieldOrigin =
  | { readonly kind: "observed"; readonly from: ObservationOrigin }
  | { readonly kind: "suggested"; readonly reviewed: boolean }
  | { readonly kind: "creator" }

export interface DraftField<T> {
  readonly value: T
  readonly origin: FieldOrigin
}

/**
 * The fields of the master listing this screen edits.
 *
 * A deliberate subset of `updateProductSchema`. The import screen is the first
 * ten minutes, not the product page, and a form that asked for every canonical
 * column here would be the product page with a worse heading.
 */
export const LISTING_FIELD_KEYS = [
  "title",
  "productType",
  "price",
  "currency",
  "description",
  "tags",
] as const
export type ListingFieldKey = (typeof LISTING_FIELD_KEYS)[number]

export interface ListingDraft {
  readonly title: DraftField<string>
  readonly productType: DraftField<ProductType | null>
  /** A string, as `updateProductSchema` takes it. Parsed, never stored as a number here. */
  readonly price: DraftField<string>
  readonly currency: DraftField<string>
  readonly description: DraftField<string>
  readonly tags: DraftField<readonly string[]>
}

/**
 * One tile in the source preview.
 *
 * **No remote image is loaded, now or later.** The production CSP admits images
 * from this origin, `data:`, `blob:` and the storage host only, so a remote
 * `og:image` would not render even if something tried. When ingestion is wired,
 * an image is fetched server-side into `product_assets` and served from storage
 * like every other asset; until then a tile renders the text it captured and
 * says that is what it is.
 */
export interface SourcePreview {
  readonly id: string
  /** Alt text. Describes the tile, never repeats the caption verbatim. */
  readonly alt: string
  /** Text read from the source and rendered typographically. Never markup. */
  readonly caption: string | null
}

/** One row of evidence under the preview: what the source is, and when it was read. */
export interface SourceFact {
  readonly id: string
  readonly label: string
  readonly origin: ObservationOrigin
}

/**
 * What one read of a source produced. Immutable: a second read is a second
 * snapshot, never an edit of this one.
 */
export interface SourceSnapshot {
  readonly sourceKind: SourceKind
  /** The normalized URL that was read. Never the raw paste. */
  readonly url: string
  /** ISO 8601. Fixed by the service so a render is deterministic. */
  readonly capturedAt: string
  readonly title: string | null
  readonly description: string | null
  readonly previews: readonly SourcePreview[]
  readonly facts: readonly SourceFact[]
}

/**
 * Why a source could not be read.
 *
 * A closed set, because the recovery a creator is offered is chosen from it. An
 * open string would let a new failure reach the screen with no way out of it.
 */
export const UNAVAILABLE_REASONS = [
  "private",
  "login_required",
  "organization_only",
  "expired",
  "not_found",
] as const
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

/** What a creator can do instead, when a source will not open. */
export const RECOVERY_ACTIONS = [
  "publish_public_link",
  "replace_link",
  "paste_code",
  "upload_files",
  "continue_manually",
  "retry",
] as const
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number]

export interface RecoveryOption {
  readonly action: RecoveryAction
  readonly label: string
  readonly description: string
}

/**
 * The outcome of asking the service to read a link.
 *
 * Four shapes rather than a nullable snapshot with an error beside it: every
 * unhappy outcome carries the way out of itself, so no caller has to decide
 * what to offer, and no screen can reach a dead end by forgetting to.
 */
export type SourceAnalysis =
  | {
      readonly outcome: "analyzed"
      readonly snapshot: SourceSnapshot
      readonly draft: ListingDraft
    }
  | {
      readonly outcome: "unavailable"
      readonly reason: UnavailableReason
      /** Written by Fanwise. A raw provider error never reaches a creator (rule 8). */
      readonly message: string
      readonly recoveries: readonly RecoveryOption[]
    }
  | {
      readonly outcome: "unsupported"
      readonly message: string
      readonly recoveries: readonly RecoveryOption[]
    }
  | {
      readonly outcome: "failed"
      readonly message: string
      readonly recoveries: readonly RecoveryOption[]
    }

/**
 * What the creator has attached to the draft besides the source.
 *
 * Not yet persisted anywhere: this phase is the UI foundation, and the
 * migration that gives these a home is phase 2 of `docs/product-link-import.md`.
 * They are modelled now because readiness reads them, and a readiness that
 * counted imaginary steps would be the hard-coded indicator this screen exists
 * to avoid.
 */
export interface BuyerDeliverable {
  readonly id: string
  readonly filename: string
  readonly byteSize: number
  /** Only a measured file counts. A pending upload is a promise, not a file. */
  readonly state: "pending" | "ready" | "failed"
}

/**
 * An approved way to deliver a product that is not a file Fanwise holds.
 *
 * **The canonical product model has no such type today.** `ASSET_TYPES` and
 * `PRODUCT_TYPES` in `lib/products/types.ts` describe files and taxonomy, and
 * neither carries an external-delivery member. This type exists so that the
 * readiness rule reads as the conditional it actually is, rather than as
 * `count > 0` that somebody has to rewrite when a delivery type arrives. It is
 * always null until the product model says otherwise.
 */
export interface ExternalDeliveryApproval {
  readonly kind: string
  readonly approvedAt: string
}

export interface LicenseSelection {
  readonly id: string
  readonly name: string
  /** The summary that lands on `products.license_summary`. Never empty. */
  readonly summary: string
}

export interface RightsAttestation {
  /** ISO 8601. The timestamp is the part with value, whatever the wording. */
  readonly attestedAt: string
  /** The authenticated creator who attested. Never inferred, never a model. */
  readonly attestedBy: string
}
