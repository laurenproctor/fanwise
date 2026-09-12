import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import type { Product, ProductAsset } from "@/lib/products/types"
import { parseEvidence, type ProductSourceEvidence } from "./evidence"
import { draftOutputSchema, type DraftField, type DraftOutput } from "./draft-output"
import { IMPORT_ERROR_MESSAGES, type ImportErrorCode } from "./errors"

/**
 * Reading an import back.
 *
 * Every query here goes through the caller's client, so RLS is the tenancy
 * boundary and a member of another workspace gets nothing — indistinguishable
 * from an import that does not exist, which is the answer that stops a probe
 * confirming an id is real.
 *
 * Both jsonb columns are parsed rather than trusted. They were written by an
 * earlier version of this code and will one day have been written by an older
 * one still; a shape that no longer validates is treated as absent, which every
 * screen already knows how to render, instead of reaching a component as
 * `undefined` and taking the page down.
 */

export type ProductImportRow = Database["public"]["Tables"]["product_imports"]["Row"]
export type ImportSourceRow = Database["public"]["Tables"]["product_import_sources"]["Row"]

/** One source of an import, with its evidence parsed. */
export interface ImportSourceRecord extends Omit<ImportSourceRow, "evidence" | "text_content"> {
  evidence: ProductSourceEvidence | null
  /** Whether the row holds text. The text itself is not sent to the screen. */
  hasText: boolean
}

export interface ImportRecord {
  row: ProductImportRow
  product: Product
  evidence: ProductSourceEvidence | null
  /** The suggestions that survived the claims check, or null. */
  draft: Partial<DraftOutput> | null
  /** Fields a model proposed and the claims check withheld. */
  withheld: DraftField[]
  /** True when the page was read but no model was configured to draft from it. */
  aiUnavailable: boolean
  missingInformation: string[]
  errorCode: ImportErrorCode | null
  errorMessage: string | null
  /** Every source that was not removed, in the creator's order. */
  sources: ImportSourceRecord[]
}

/**
 * The suggestions column, as the runner writes it.
 *
 * Parsed field by field rather than whole: a draft whose `tags` no longer
 * validate should still offer its title. `draftOutputSchema` is strict about
 * each field and this is deliberately forgiving about the set of them.
 */
function parseSuggestions(value: unknown): {
  draft: Partial<DraftOutput> | null
  withheld: DraftField[]
  aiUnavailable: boolean
  missingInformation: string[]
} {
  const empty = { draft: null, withheld: [], aiUnavailable: false, missingInformation: [] }
  if (typeof value !== "object" || value === null) return empty

  const record = value as Record<string, unknown>
  const aiUnavailable = record.unavailable === true
  const rawDraft = record.draft

  const withheld = Array.isArray(record.withheld)
    ? record.withheld.filter((field): field is DraftField => typeof field === "string")
    : []

  if (typeof rawDraft !== "object" || rawDraft === null) {
    return { ...empty, withheld, aiUnavailable }
  }

  const draftRecord = rawDraft as Record<string, unknown>
  const missingInformation = Array.isArray(draftRecord.missingInformation)
    ? draftRecord.missingInformation.filter((item): item is string => typeof item === "string")
    : []

  const draft: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(draftRecord)) {
    if (key === "missingInformation") continue
    const field = draftOutputSchema.shape[key as keyof typeof draftOutputSchema.shape]
    if (!field) continue
    const parsed = field.safeParse(entry)
    if (parsed.success) draft[key] = parsed.data
  }

  return {
    draft: Object.keys(draft).length > 0 ? (draft as Partial<DraftOutput>) : null,
    withheld,
    aiUnavailable,
    missingInformation,
  }
}

function knownErrorCode(value: string | null): ImportErrorCode | null {
  if (value === null) return null
  return value in IMPORT_ERROR_MESSAGES ? (value as ImportErrorCode) : "internal"
}

export async function getImport(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  importId: string,
): Promise<ImportRecord | null> {
  const { data, error } = await supabase
    .from("product_imports")
    .select("*, products!inner(*)")
    .eq("id", importId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (error || !data) return null

  const { products, ...row } = data as ProductImportRow & { products: Product }
  const suggestions = parseSuggestions(row.suggestions)

  const { data: sourceRows } = await supabase
    .from("product_import_sources")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("import_id", importId)
    .neq("status", "removed")
    .order("position", { ascending: true })

  return {
    row,
    product: products,
    evidence: parseEvidence(row.evidence),
    ...suggestions,
    errorCode: knownErrorCode(row.error_code),
    errorMessage: row.error_message,
    sources: (sourceRows ?? []).map(({ evidence, text_content, ...source }) => ({
      ...source,
      evidence: parseEvidence(evidence),
      hasText: text_content !== null,
    })),
  }
}

/** The import attached to a product, when there is one. */
export async function getImportForProduct(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  productId: string,
): Promise<ImportRecord | null> {
  const { data, error } = await supabase
    .from("product_imports")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .maybeSingle()

  if (error || !data) return null
  return getImport(supabase, workspaceId, data.id)
}

/** The product's ready deliverables, for the buyer-files readiness step. */
export async function listDeliverables(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  productId: string,
): Promise<ProductAsset[]> {
  const { data, error } = await supabase
    .from("product_assets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .in("asset_type", ["deliverable", "archive", "source_file"])
    .order("created_at", { ascending: true })

  if (error || !data) return []
  return data
}
