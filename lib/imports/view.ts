import type { ProductAsset, ProductType } from "@/lib/products/types"
import { PRODUCT_TYPES } from "@/lib/products/types"
import { IMPORT_ERROR_RECOVERIES } from "./errors"
import { licenseEntry } from "./licenses"
import { parseEvidence, type ProductSourceEvidence } from "./evidence"
import { SOURCE_LABELS, descriptorFor } from "./sources/registry"
import type { ImportRecord } from "./queries"
import type { AnalyzingStage, ImportState } from "./machine"
import { detectConflicts, type FactConflict } from "./conflicts"
import {
  OBSERVATION_ORIGINS,
  isContentSourceKind,
  type ImportSourceType,
  type ObservationOrigin,
  type BuyerDeliverable,
  FieldOrigin,
  LicenseSelection,
  ListingDraft,
  RecoveryOption,
  RightsAttestation,
  SourceSnapshot,
} from "./types"

/**
 * Turning a stored import into the state the screen already renders.
 *
 * The screen's vocabulary was fixed in the previous phase and its components
 * are tested against it; this is the one place that knows both that vocabulary
 * and the database's, so neither had to bend to the other. Every mapping
 * decision that matters is here and is one function long.
 *
 * The important one is `originFor`. A value on the canonical product, a value
 * read from the page and a value a model proposed are three different things,
 * and the screen draws them differently. Getting this wrong in the direction of
 * "creator" would quietly launder an inference into something Fanwise says the
 * creator wrote, which is exactly what architecture invariant 5 forbids.
 */

const RECOVERY_LABELS: Record<RecoveryOption["action"], { label: string; description: string }> = {
  publish_public_link: {
    label: "Publish a public link",
    description: "Publish the page, then paste the public link it gives you.",
  },
  replace_link: {
    label: "Paste a different link",
    description: "Swap in a link anyone can open without signing in.",
  },
  paste_code: {
    label: "Paste the text instead",
    description:
      "Copy the words, or the code, and paste them. Fanwise reads what you paste and never runs it.",
  },
  upload_files: {
    label: "Upload a ZIP or project",
    description: "Add the files directly. Fanwise stores them, and never unpacks or runs them.",
  },
  continue_manually: {
    label: "Continue manually",
    description: "Skip the source and write the listing yourself.",
  },
  retry: {
    label: "Try again",
    description: "Nothing was changed. The same link is read again.",
  },
}

/** Which analyzing stage a stored status is showing. */
const STAGE_FOR_STATUS: Record<string, AnalyzingStage> = {
  pending: "connecting",
  retrieving: "reading",
  analyzing: "extracting",
}

/**
 * The recoveries for a code, with the source's own advice folded in.
 *
 * `publish_public_link` is the one recovery whose wording depends on where the
 * link came from, because "use Share to publish it" is only true of a source
 * that has a Share. The descriptor supplies that sentence and the generic one
 * stands in where it does not.
 */
/** Recoveries that only mean something for a link. A file has no link to swap or publish. */
const LINK_ONLY_RECOVERIES: readonly RecoveryOption["action"][] = [
  "publish_public_link",
  "replace_link",
]

export function recoveriesFor(record: ImportRecord): RecoveryOption[] {
  if (!record.errorCode) return []
  const provider = record.row.provider
  const hint = provider === "composed" ? null : descriptorFor(provider).publishHint
  // Link-only recoveries need a link.
  const content = !record.row.source_url

  const actions = IMPORT_ERROR_RECOVERIES[record.errorCode].filter(
    (action) => !(content && LINK_ONLY_RECOVERIES.includes(action)),
  )

  return actions.map((action) => {
    const base = RECOVERY_LABELS[action]
    if (action === "publish_public_link" && hint) {
      return { action, label: base.label, description: hint }
    }
    return { action, ...base }
  })
}

/** The evidence, as the snapshot the preview component renders. */
export function snapshotFor(record: ImportRecord): SourceSnapshot | null {
  const evidence = record.evidence
  if (!evidence) return null

  return {
    sourceKind: evidence.provider,
    url: evidence.resolvedUrl ?? sourceLabelFor(record),
    capturedAt: evidence.retrievedAt,
    title: evidence.title?.value ?? null,
    description: evidence.summary?.value ?? null,
    previews: evidence.visibleFeatures.value.slice(0, 4).map((caption, index) => ({
      id: `feature-${index}`,
      alt: index === 0 ? "Text captured from the source page" : "Also shown on the page",
      caption,
    })),
    facts: [
      isContentSourceKind(evidence.provider)
        ? {
            id: "visibility",
            label:
              evidence.pageCount !== undefined
                ? `${evidence.pageCount} page${evidence.pageCount === 1 ? "" : "s"}, kept private`
                : "Kept private",
            origin: "document" as const,
          }
        : {
            id: "visibility",
            label: evidence.publicDemoAvailable ? "Readable without signing in" : "Not public",
            origin: "header" as const,
          },
      ...(evidence.previewAssets.some((asset) => asset.assetId)
        ? [
            {
              id: "pictures",
              label: `${evidence.previewAssets.filter((asset) => asset.assetId).length} picture(s) saved`,
              origin: "dom" as const,
            },
          ]
        : []),
    ],
  }
}

/**
 * What to call a source on screen, where a link would show its address.
 *
 * The file's own name when there is one, so a creator recognises what they
 * uploaded; the kind of thing it was when there is not, which is every paste.
 */
export function sourceLabelFor(record: ImportRecord): string {
  const sources = record.sources ?? []
  if (sources.length > 1) return `${sources.length} sources`
  if (record.row.source_url) return record.row.source_url
  if (sources.length === 1) return sources[0]!.display_name
  if (record.row.source_filename) return record.row.source_filename
  const provider = record.row.provider
  if (provider === "composed") return "Your sources"
  return provider === "html_document" ? "Pasted HTML" : SOURCE_LABELS[provider]
}

/**
 * Whether the screen talks about a link or about sources.
 *
 * A single link keeps the wording it always had, so an import made before the
 * composer reads exactly as it did. Anything else — a file, a paste, or several
 * sources together — is "your sources".
 */
export function sourceModeFor(record: ImportRecord): "link" | "content" {
  const sources = record.sources ?? []
  return record.row.source_url && sources.length <= 1 ? "link" : "content"
}

/* ------------------------------------------------------------ the sources */

export interface SourceSummary {
  id: string
  type: ImportSourceType
  label: string
  /** The word on screen, beside a dot. */
  statusWord: string
  tone: "ok" | "busy" | "bad"
  /** Written by Fanwise, when the source did not read. */
  message: string | null
  /** A try-again button is offered only where trying again could help. */
  retryable: boolean
}

export const SOURCE_TYPE_LABELS: Record<ImportSourceType, string> = {
  public_url: "Link",
  pasted_text: "Pasted text",
  pdf: "PDF",
  html: "HTML",
  audio: "Recording",
}

function statusWordFor(type: ImportSourceType, status: string): string {
  if (status === "ready") return type === "audio" ? "Transcribed" : "Read"
  if (status === "failed" || status === "unavailable") return "Needs attention"
  if (status === "transcribing") return "Transcribing"
  if (status === "reading") return "Reading"
  return "Waiting"
}

export function sourcesFor(record: ImportRecord): SourceSummary[] {
  return (record.sources ?? []).map((source) => {
    const bad = source.status === "failed" || source.status === "unavailable"
    return {
      id: source.id,
      type: source.source_type,
      label: source.display_name,
      statusWord: statusWordFor(source.source_type, source.status),
      tone: source.status === "ready" ? "ok" : bad ? "bad" : "busy",
      message: bad ? source.error_message : null,
      retryable: source.status === "failed",
    }
  })
}

/** Where the readable sources disagree, from their evidence. Pure. */
export function conflictsFor(record: ImportRecord): FactConflict[] {
  const readable = (record.sources ?? []).flatMap((source) =>
    source.status === "ready" && source.evidence
      ? [{ label: source.display_name, evidence: source.evidence }]
      : [],
  )
  return readable.length < 2 ? [] : detectConflicts(readable)
}

export function stateFor(record: ImportRecord): ImportState {
  const url = sourceLabelFor(record)

  switch (record.row.status) {
    case "pending":
    case "retrieving":
    case "analyzing":
      return {
        status: "analyzing",
        url,
        stage: STAGE_FOR_STATUS[record.row.status] ?? "connecting",
      }

    case "ready": {
      const snapshot = snapshotFor(record)
      if (!snapshot) return { status: "empty", url, error: null }
      return { status: "analyzed", url, snapshot, draft: draftFor(record) }
    }

    case "unavailable": {
      const code = record.errorCode ?? "internal"
      const message = record.errorMessage ?? ""
      const recoveries = recoveriesFor(record)
      const locked = code === "login_required" || code === "organization_only"
      if (locked) return { status: "private", url, reason: "login_required", message, recoveries }
      if (
        code === "unsupported_source" ||
        code === "not_html" ||
        code === "too_large" ||
        code === "unreadable_file" ||
        code === "no_text"
      ) {
        return { status: "unsupported", url, message, recoveries }
      }
      return { status: "notFound", url, reason: "not_found", message, recoveries }
    }

    case "failed":
      return {
        status: "failed",
        url,
        message: record.errorMessage ?? "",
        recoveries: recoveriesFor(record),
      }

    case "discarded":
      return { status: "empty", url: "", error: null }
  }
}

/**
 * Where a field's current value came from.
 *
 * Order is the whole rule. A creator's settled decision wins over everything;
 * a value the product already carries that nobody settled is still theirs,
 * because only they can have put it there; a value the page stated is observed;
 * a value only a model proposed is suggested, and unreviewed until it appears
 * in `accepted`.
 */
function originFor(
  field: string,
  fromProduct: boolean,
  fromEvidence: { origin: string } | null,
  fromSuggestion: boolean,
  accepted: Record<string, unknown>,
): FieldOrigin {
  if (field in accepted) {
    // Settled by a person. The marker they saw when they settled it is kept,
    // so provenance survives acceptance rather than being erased by it.
    const settled = accepted[field]
    if (typeof settled === "object" && settled !== null && "origin" in settled) {
      const origin = (settled as { origin: unknown }).origin
      if (origin === "suggested") return { kind: "suggested", reviewed: true }
      if (origin === "observed" && fromEvidence) {
        return { kind: "observed", from: evidenceOrigin(fromEvidence.origin) }
      }
    }
    return { kind: "creator" }
  }

  if (fromProduct) return { kind: "creator" }
  if (fromEvidence) return { kind: "observed", from: evidenceOrigin(fromEvidence.origin) }
  if (fromSuggestion) return { kind: "suggested", reviewed: false }
  return { kind: "creator" }
}

/** The evidence origins the screen knows, with the rest folded into `dom`. */
function evidenceOrigin(origin: string): ObservationOrigin {
  return (OBSERVATION_ORIGINS as readonly string[]).includes(origin)
    ? (origin as ObservationOrigin)
    : "dom"
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The listing draft, assembled from three sources in one order.
 *
 * The product's own column is the value whenever it holds one, because that is
 * what a save wrote and what every other surface in Fanwise reads. Evidence
 * fills a gap the creator has not filled. A suggestion fills a gap neither did.
 */
export function draftFor(record: ImportRecord): ListingDraft {
  const product = record.product
  const evidence = record.evidence
  const draft = record.draft
  const accepted = (record.row.accepted ?? {}) as Record<string, unknown>

  const titleValue =
    nonEmpty(product.canonical_title) ??
    evidence?.title?.value ??
    draft?.title?.value ??
    product.name

  const descriptionValue =
    nonEmpty(product.canonical_description) ??
    draft?.longDescription?.value ??
    evidence?.summary?.value ??
    ""

  const priceValue =
    product.base_price !== null ? String(product.base_price) : suggestedPrice(draft)

  const typeValue: ProductType | null = productTypeOf(product.product_type, draft)

  return {
    title: {
      value: titleValue,
      origin: originFor(
        "title",
        nonEmpty(product.canonical_title) !== null,
        evidence?.title ?? null,
        Boolean(draft?.title),
        accepted,
      ),
    },
    productType: {
      value: typeValue,
      origin: originFor(
        "productType",
        product.product_type !== "other",
        null,
        Boolean(draft?.productType),
        accepted,
      ),
    },
    price: {
      value: priceValue,
      origin: originFor(
        "price",
        product.base_price !== null,
        null,
        Boolean(draft?.priceGuidance?.value.amount ?? null),
        accepted,
      ),
    },
    currency: { value: product.currency, origin: { kind: "creator" } },
    description: {
      value: descriptionValue,
      origin: originFor(
        "description",
        nonEmpty(product.canonical_description) !== null,
        // A description taken from the page is observed; one written by a
        // model from that page is not, and the product column decides which
        // was used above.
        nonEmpty(product.canonical_description) === null && !draft?.longDescription
          ? (evidence?.summary ?? null)
          : null,
        Boolean(draft?.longDescription),
        accepted,
      ),
    },
    tags: {
      value: draft?.tags?.value ?? [],
      origin: originFor("tags", false, null, Boolean(draft?.tags), accepted),
    },
  }
}

function suggestedPrice(draft: Partial<import("./draft-output").DraftOutput> | null): string {
  const amount = draft?.priceGuidance?.value.amount
  return typeof amount === "number" ? String(amount) : ""
}

function productTypeOf(
  current: ProductType,
  draft: Partial<import("./draft-output").DraftOutput> | null,
): ProductType | null {
  // `other` is the placeholder the import action writes before anything is
  // known, so it is treated as "unset" and a suggestion may fill it.
  if (current !== "other") return current
  const suggested = draft?.productType?.value
  return suggested && PRODUCT_TYPES.includes(suggested) ? suggested : null
}

/** The product's stored deliverables, in the shape readiness measures. */
export function deliverablesFor(assets: readonly ProductAsset[]): BuyerDeliverable[] {
  return assets.map((asset) => ({
    id: asset.id,
    filename: asset.filename,
    byteSize: asset.byte_size ?? 0,
    state: asset.asset_state,
  }))
}

/**
 * The product's licence, when it carries one.
 *
 * Keyed on `license_id` rather than on the summary being non-empty. A summary
 * with no key is a licence that reached the column by some other path — the
 * product form has always allowed free text — and it should not read as a
 * choice this screen recorded.
 */
export function licenseFor(record: ImportRecord): LicenseSelection | null {
  const product = record.product
  const summary = nonEmpty(product.license_summary)
  if (!product.license_id || !summary) return null

  const entry = licenseEntry(product.license_id)
  return {
    id: product.license_id,
    name: entry?.name ?? "Your own terms",
    summary,
    version: product.license_version ?? undefined,
  }
}

/** The rights attestation, when one has been recorded. */
export function rightsFor(record: ImportRecord): RightsAttestation | null {
  const product = record.product
  const at = product.rights_confirmed_at
  const by = product.rights_confirmed_by
  const version = product.rights_attestation_version
  if (!at || !by || !version) return null

  return {
    attestedAt: at,
    attestedBy: by,
    attestationVersion: version,
    thirdPartyDeclaredAt: product.third_party_declared_at,
    thirdPartyComponents: product.third_party_components,
  }
}

/* ----------------------------------------------------------- what changed */

export interface EvidenceChange {
  field: "title" | "summary" | "features" | "pictures"
  label: string
  before: string | null
  after: string | null
}

/**
 * What a re-read of the source turned up that the previous one did not.
 *
 * Shown before a creator accepts any of it, which is the whole point: a swapped
 * link that silently rewrote a listing would be the worst thing this screen
 * could do, and the reason it cannot is that suggestions never reach `products`
 * without a save. This is the visible half of that guarantee — the creator sees
 * the difference and decides, rather than discovering it later.
 *
 * Returns an empty list when there is nothing to compare against, which is
 * every import that has only ever been read once.
 */
export function evidenceChanges(record: ImportRecord): EvidenceChange[] {
  const now = record.evidence
  const before = parseEvidence(record.row.previous_evidence)
  if (!now || !before) return []

  const changes: EvidenceChange[] = []

  const compare = (
    field: EvidenceChange["field"],
    label: string,
    a: string | null,
    b: string | null,
  ) => {
    if ((a ?? "") !== (b ?? "")) changes.push({ field, label, before: a, after: b })
  }

  compare("title", "Title", before.title?.value ?? null, now.title?.value ?? null)
  compare("summary", "Description", before.summary?.value ?? null, now.summary?.value ?? null)
  compare(
    "features",
    "Headings and list items",
    before.visibleFeatures.value.join(" · ") || null,
    now.visibleFeatures.value.join(" · ") || null,
  )

  const pictures = (evidence: ProductSourceEvidence) =>
    String(evidence.previewAssets.filter((asset) => asset.assetId).length)
  compare("pictures", "Pictures saved", pictures(before), pictures(now))

  return changes
}

export { SOURCE_LABELS }
