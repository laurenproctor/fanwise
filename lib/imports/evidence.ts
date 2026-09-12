import { createHash } from "node:crypto"
import { z } from "zod"
import { SOURCE_KINDS } from "./types"

/**
 * What a read of a public page produced, as a persisted, validated shape.
 *
 * Stored in `product_imports.evidence` and validated with Zod every time it is
 * read back, not only when it is written. It is jsonb, so nothing but this
 * schema stands between a column and the code that trusts it, and a row written
 * by an older version of this file is exactly the case that would otherwise
 * reach a screen as `undefined`.
 *
 * **The word for everything in here is "observed".** Each value carries where
 * it was read from, and a value nobody could read is absent rather than
 * guessed. What a model proposes from this lives in `suggestions`, in a
 * different column with a different schema, and the two are never merged before
 * a person has looked (architecture invariant 5).
 *
 * Nothing in this file fetches, parses or renders. `retrieval/` reads a page
 * and produces one of these; `sources/` decides which adapter does the reading.
 */

/** Where a value was read. Ordered loosely by how much the author meant it. */
export const EVIDENCE_ORIGINS = ["og", "twitter", "meta", "jsonld", "dom", "header"] as const
export type EvidenceOrigin = (typeof EVIDENCE_ORIGINS)[number]

export const evidenceOriginSchema = z.enum(EVIDENCE_ORIGINS)

/**
 * A value the page stated, and where.
 *
 * `provenance` is always `observed` in this file. The literal is kept rather
 * than dropped so that an evidence value and a suggested value have the same
 * shape on screen and a component cannot forget which it is holding.
 */
export interface ObservedValue<T> {
  value: T
  provenance: "observed"
  origin: EvidenceOrigin
}

function observed<T extends z.ZodType>(inner: T) {
  return z.object({
    value: inner,
    provenance: z.literal("observed"),
    origin: evidenceOriginSchema,
  })
}

/**
 * A picture the page offered.
 *
 * `sourceUrl` is where it was advertised and is never rendered: the production
 * CSP admits images from this origin, `data:`, `blob:` and the storage host
 * only, and a remote `og:image` is a URL a stranger chose. `storagePath` is
 * filled in once the bytes have been fetched server-side, measured, and written
 * to the product's own asset row — and until then the asset is a claim, not a
 * picture.
 */
export const sourceAssetSchema = z.object({
  sourceUrl: z.string().max(2048),
  origin: evidenceOriginSchema,
  /** Set by the fetcher after the bytes were read and sniffed. Never trusted from the page. */
  mimeType: z.string().max(120).optional(),
  byteSize: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** The product_assets row that now holds the bytes, if one was made. */
  assetId: z.uuid().optional(),
  /** Why this asset has no bytes, when it has none. */
  skipped: z.enum(["blocked", "too_large", "not_an_image", "unreachable", "limit"]).optional(),
})

export type SourceAsset = z.infer<typeof sourceAssetSchema>

export const productSourceEvidenceSchema = z.object({
  provider: z.enum(SOURCE_KINDS),
  /** As the creator pasted it, after the shape check. Provenance, never a deliverable. */
  originalUrl: z.string().max(2048),
  /** Where the body came from, after every redirect was re-validated. */
  resolvedUrl: z.string().max(2048),
  retrievedAt: z.iso.datetime(),

  title: observed(z.string().trim().min(1).max(500)).optional(),
  summary: observed(z.string().trim().min(1).max(4000)).optional(),
  /**
   * Headings and list items the page shows, in document order.
   *
   * Named for what it is. These are strings a page displayed, not features of a
   * product Fanwise has verified, and the draft prompt is told so in as many
   * words.
   */
  visibleFeatures: observed(z.array(z.string().trim().min(1).max(300)).max(40)),
  /** The page's own words for what it is. Never mapped to the product enum here. */
  productType: observed(z.string().trim().min(1).max(120)).optional(),
  previewAssets: z.array(sourceAssetSchema).max(12),
  /**
   * Whether the page itself is something a buyer could look at without signing
   * in. True only when the read succeeded anonymously, which is the only way
   * Fanwise ever reads.
   */
  publicDemoAvailable: z.boolean(),
  /** The language the page declared, when it declared one. */
  language: z.string().max(35).optional(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
})

export type ProductSourceEvidence = z.infer<typeof productSourceEvidenceSchema>

/**
 * The hash that decides whether a page has changed.
 *
 * Over the extracted evidence rather than the raw bytes, and that is the point:
 * a page whose analytics blob, CSRF token or rendered timestamp differs on
 * every request would never hash the same twice, and a re-import would compose
 * a new draft each time and overwrite work. What is hashed is what Fanwise
 * actually uses, so the hash changes when the answer would change.
 *
 * `retrievedAt` and `contentHash` are excluded for the obvious reason, and the
 * asset list is reduced to the URLs it advertised: whether a fetch succeeded is
 * about Fanwise's afternoon, not about the page.
 */
export function hashEvidence(
  evidence: Omit<ProductSourceEvidence, "contentHash" | "retrievedAt">,
): string {
  const material = {
    provider: evidence.provider,
    resolvedUrl: evidence.resolvedUrl,
    title: evidence.title?.value ?? null,
    summary: evidence.summary?.value ?? null,
    visibleFeatures: evidence.visibleFeatures.value,
    productType: evidence.productType?.value ?? null,
    assets: evidence.previewAssets.map((asset) => asset.sourceUrl).sort(),
    language: evidence.language ?? null,
  }
  return createHash("sha256").update(JSON.stringify(material)).digest("hex")
}

/**
 * Evidence read back from the column, or null.
 *
 * Null rather than a throw: a row whose evidence cannot be parsed is a row the
 * screen should treat as having none, which it already knows how to render. A
 * throw here would take out the page instead.
 */
export function parseEvidence(value: unknown): ProductSourceEvidence | null {
  const parsed = productSourceEvidenceSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
