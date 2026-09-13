import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import { jobs, type JobQueue } from "@/lib/jobs"
import {
  RESERVED_PRODUCT_SLUGS,
  avoidReserved,
  ensureMinimumLength,
  randomSuffix,
  slugify,
  withSuffix,
} from "@/lib/slug"
import { emptyMetadataFor } from "@/lib/products/metadata"
import { toJson } from "./json"
import { linkLabel } from "./composer"
import { IMPORT_LIMITS } from "./limits"
import { looksLikeCode } from "./retrieval/plain-text"
import { sanitizeText } from "./retrieval/html"
import { sourceKindFor } from "./sources/registry"
import { normalizeSourceUrl, validateSourceUrl } from "./url"
import { isContentSourceKind, type LinkSourceKind } from "./types"

/** A link's kind. Only link importers claim URLs, so a content kind cannot come back. */
export function linkKindFor(url: URL): LinkSourceKind {
  const kind = sourceKindFor(url)
  return isContentSourceKind(kind) ? "webpage" : kind
}

/**
 * Starting an import session, as the signed-in member.
 *
 * One write: `create_import_session`, a security-invoker function, inserts the
 * draft product, the session and its link and text sources, and attaches the
 * files and recordings the composer staged beforehand — or does none of it.
 * RLS applies to every statement inside, so a member who could not make these
 * rows one at a time cannot make them together.
 *
 * **The same submission twice is the same session.** The composer mints a
 * submission id when it opens, and the function returns the session that id
 * already made. A double click, a retried request and a redelivered action
 * produce one product.
 *
 * **Re-importing a link opens the import that already exists.** The partial
 * unique index on `(workspace_id, normalized_url)` refuses the second session,
 * the transaction rolls back whole, and the caller is sent to the winner. When
 * the creator also handed over files, going there silently would lose them, so
 * that case is refused with a way to the existing import instead.
 *
 * What the product gets at this point is a provisional name from the creator's
 * own material and nothing else, because nothing has been read yet and a value
 * on the canonical record is a value the FactSheet will let a model restate.
 */

const UNIQUE_VIOLATION = "23505"
const STAGED_UNAVAILABLE = "P0002"
const MAX_SLUG_ATTEMPTS = 5

type SessionArgs = Database["public"]["Functions"]["create_import_session"]["Args"]
/**
 * The function's arguments as Postgres actually takes them. `supabase gen
 * types` marks every plpgsql parameter non-null, and four of these are null by
 * design — a session without a link has no URL. The single cast at the call is
 * the price of that generator limitation, and it widens nothing else.
 */
type NullableArgs = {
  [K in keyof SessionArgs]: SessionArgs[K] | null
}

export type StartImportOutcome =
  | { kind: "started"; importId: string; productSlug: string }
  | { kind: "existing"; importId: string; productSlug: string }
  /** The link is already being imported, and this submission carried more than the link. */
  | { kind: "link_in_use"; importId: string; productSlug: string; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string }

/**
 * A first name for the product, from the address the creator pasted.
 *
 * The last path segment reads better than a host, and where there is no segment
 * the host is all there is. This is the creator's own URL, rearranged.
 */
export function provisionalName(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).pop() ?? ""
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // A malformed escape is still a segment; use it as it is.
  }
  const cleaned = decoded
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  // A uuid or a hash is a segment, and it is not a name.
  const looksLikeAName = /[a-z]/i.test(cleaned) && cleaned.length <= 60 && cleaned.length >= 3
  const base = looksLikeAName ? cleaned : url.hostname.replace(/^www\./, "")

  return titleCase(base)
}

function titleCase(base: string): string {
  return (
    base
      .split(" ")
      // The first word is always capitalized, and short words after it are not.
      .map((word, index) =>
        index === 0 || word.length > 2 ? (word[0] ?? "").toUpperCase() + word.slice(1) : word,
      )
      .join(" ")
      .slice(0, 200)
  )
}

/**
 * A first name for a product made from handed-over material: a file's name, a
 * first line that reads like a name, or what the material was.
 */
export function provisionalContentName(params: {
  filename: string | null
  firstLine: string | null
  fallback?: string
}): string {
  if (params.filename) {
    const stem = sanitizeText(
      params.filename.replace(/\.[A-Za-z0-9]{1,8}$/, "").replace(/[-_+]+/g, " "),
      200,
    )
    if (/[a-z]/i.test(stem) && stem.length >= 3) return titleCase(stem).slice(0, 200)
  }

  const line = params.firstLine ? sanitizeText(params.firstLine.replace(/^#+\s*/, ""), 200) : ""
  if (line.length >= 3 && line.length <= 80 && /[a-z]/i.test(line) && !looksLikeCode(line)) {
    return line
  }

  return params.fallback ?? "Imported product"
}

export interface SessionSourcesInput {
  /** As typed. Validated and normalized here. */
  rawUrl: string | null
  pastedText: string | null
  /** Staged files and recordings, in the order the creator added them. */
  staged: readonly { id: string; displayName: string }[]
}

export async function createImportSession(params: {
  supabase: SupabaseClient<Database>
  workspaceId: string
  submissionId: string
  sources: SessionSourcesInput
  /** Test seam. Production hands off to the configured queue. */
  queue?: JobQueue
}): Promise<StartImportOutcome> {
  const { supabase, workspaceId, submissionId, sources, queue = jobs } = params

  let url: { checked: string; normalized: string; provider: LinkSourceKind } | null = null
  if (sources.rawUrl !== null) {
    const checked = validateSourceUrl(sources.rawUrl)
    if (!checked.ok) return { kind: "invalid", message: checked.message }
    url = {
      checked: checked.url,
      normalized: normalizeSourceUrl(checked.url),
      provider: linkKindFor(new URL(checked.url)),
    }
  }

  const text =
    sources.pastedText !== null && sources.pastedText.trim().length > 0 ? sources.pastedText : null
  if (text !== null && text.length > IMPORT_LIMITS.maxPasteCharacters) {
    return {
      kind: "invalid",
      message: `Pasted text is limited to ${IMPORT_LIMITS.maxPasteCharacters.toLocaleString("en-US")} characters.`,
    }
  }

  const count = (url ? 1 : 0) + (text ? 1 : 0) + sources.staged.length
  if (count === 0)
    return { kind: "invalid", message: "Add a link, some text, a file or a recording." }
  if (count > IMPORT_LIMITS.maxSources) {
    return {
      kind: "invalid",
      message: `An import takes up to ${IMPORT_LIMITS.maxSources} sources.`,
    }
  }

  // A link-only resubmission of a link already being imported goes straight to
  // it, before a product is even named.
  if (url && count === 1) {
    const existing = await findLiveImport(supabase, workspaceId, url.normalized)
    if (existing) return { kind: "existing", ...existing }
  }

  const name = url
    ? provisionalName(new URL(url.checked))
    : provisionalContentName({
        filename: sources.staged[0]?.displayName ?? null,
        firstLine: text?.trim().split("\n")[0] ?? null,
      })

  const base = avoidReserved(
    ensureMinimumLength(slugify(name), randomSuffix()),
    RESERVED_PRODUCT_SLUGS,
    randomSuffix(),
  )
  let slug = base

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const args: NullableArgs = {
      p_workspace_id: workspaceId,
      p_submission_id: submissionId,
      p_product_name: name,
      p_product_slug: slug,
      p_product_metadata: toJson(emptyMetadataFor("other")),
      p_provider: url ? url.provider : "composed",
      p_source_url: url?.checked ?? null,
      p_normalized_url: url?.normalized ?? null,
      p_url_display_name: url ? linkLabel(url.checked) : null,
      p_pasted_text: text,
      p_staged_source_ids: sources.staged.map((source) => source.id),
    }
    const { data, error } = await supabase
      .rpc("create_import_session", args as SessionArgs)
      .single()

    if (!error && data) {
      const row = data as { import_id: string; product_slug: string; existing: boolean }
      if (row.existing)
        return { kind: "existing", importId: row.import_id, productSlug: row.product_slug }
      await queue.enqueue(
        "import_source",
        { workspaceId, importId: row.import_id },
        // The delivery key, per lib/publishing/start.ts: one hand-off per session.
        { idempotencyKey: `${row.import_id}:0` },
      )
      return { kind: "started", importId: row.import_id, productSlug: row.product_slug }
    }

    if (error?.code === UNIQUE_VIOLATION) {
      if (url && /normalized_url|workspace_url/.test(`${error.message} ${error.details ?? ""}`)) {
        const winner = await findLiveImport(supabase, workspaceId, url.normalized)
        if (winner) {
          return count === 1
            ? { kind: "existing", ...winner }
            : {
                kind: "link_in_use",
                ...winner,
                message:
                  "That link is already being imported. Open that import, or remove the link to make a new draft from your other sources.",
              }
        }
      }
      // Otherwise the slug was taken. Try another.
      slug = withSuffix(base, randomSuffix())
      continue
    }

    if (error?.code === STAGED_UNAVAILABLE) {
      return {
        kind: "invalid",
        message: "One of your files is no longer available. Remove it and add it again.",
      }
    }

    console.error("[imports] could not create the import session", { code: error?.code })
    return { kind: "error", message: "That draft could not be created. Try again." }
  }

  return { kind: "error", message: "That draft could not be created. Try again." }
}

/**
 * A link, and nothing else. The entry point the link importer has always had,
 * kept for its callers; it is a session with one source.
 */
export async function startImport(params: {
  supabase: SupabaseClient<Database>
  workspaceId: string
  userId: string
  rawUrl: string
  submissionId?: string
  queue?: JobQueue
}): Promise<StartImportOutcome> {
  const checked = validateSourceUrl(params.rawUrl)
  if (!checked.ok) return { kind: "invalid", message: checked.message }
  return createImportSession({
    supabase: params.supabase,
    workspaceId: params.workspaceId,
    submissionId: params.submissionId ?? crypto.randomUUID(),
    sources: { rawUrl: params.rawUrl, pastedText: null, staged: [] },
    ...(params.queue ? { queue: params.queue } : {}),
  })
}

async function findLiveImport(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  normalizedUrl: string,
): Promise<{ importId: string; productSlug: string } | null> {
  const { data, error } = await supabase
    .from("product_imports")
    .select("id, products!inner(slug)")
    .eq("workspace_id", workspaceId)
    .eq("normalized_url", normalizedUrl)
    .neq("status", "discarded")
    .maybeSingle()

  if (error || !data) return null
  const product = data.products as unknown as { slug: string } | null
  if (!product) return null
  return { importId: data.id, productSlug: product.slug }
}
