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
import { sourceKindFor } from "./sources/registry"
import { normalizeSourceUrl, validateSourceUrl } from "./url"
import { looksLikeCode } from "./retrieval/plain-text"
import { sanitizeText } from "./retrieval/html"
import { removeStoredSource } from "./source-storage"
import type { ContentSourceKind } from "./types"

/**
 * Starting an import, as the signed-in member.
 *
 * Every row is inserted through RLS, so a member who cannot insert is a member
 * who may not import into this workspace, and that is the database's judgement
 * rather than the page's.
 *
 * **Re-importing a link opens the import that already exists.** The partial
 * unique index on `(workspace_id, normalized_url)` is what makes that true
 * under a double click and two tabs rather than only under a happy path: the
 * second insert loses at the database, and losing is handled by reading the
 * winner and going there. "You already have this, here it is" is a destination.
 *
 * The product is created here rather than when the page has been read, and that
 * is deliberate. `product_assets.product_id` is a composite foreign key, so
 * there is no such thing as an asset without a product, and the pictures a page
 * offers are fetched by the job. What the product gets at this point is a
 * provisional name derived from the URL and nothing else: no title, no price,
 * no description, because none of those have been read yet and a value on the
 * canonical record is a value the FactSheet will let a model restate.
 */

const UNIQUE_VIOLATION = "23505"
const MAX_SLUG_ATTEMPTS = 5

export type StartImportOutcome =
  | { kind: "started"; importId: string; productSlug: string }
  | { kind: "existing"; importId: string; productSlug: string }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string }

/**
 * A first name for the product, from the address the creator pasted.
 *
 * Provisional and visibly so. The last path segment reads better than a host —
 * `/products/aster-grotesk` is the product and `example.com` is the shop — and
 * where there is no segment the host is all there is. This is not inference
 * about the product: it is the creator's own URL, rearranged, and the real name
 * arrives with the evidence for them to accept.
 */
export function provisionalName(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).pop() ?? ""
  const cleaned = decodeURIComponent(segment)
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  // A uuid or a hash is a segment, and it is not a name. Anything without a
  // letter, or long and unbroken, reads better as the host.
  const looksLikeAName = /[a-z]/i.test(cleaned) && cleaned.length <= 60 && cleaned.length >= 3
  const base = looksLikeAName ? cleaned : url.hostname.replace(/^www\./, "")

  return titleCase(base)
}

function titleCase(base: string): string {
  return (
    base
      .split(" ")
      // The first word is always capitalized, and short words after it are not:
      // "a Product" is what title-casing by length alone produces, and it reads
      // like a bug rather than like a name.
      .map((word, index) =>
        index === 0 || word.length > 2 ? (word[0] ?? "").toUpperCase() + word.slice(1) : word,
      )
      .join(" ")
      .slice(0, 200)
  )
}

export async function startImport(params: {
  supabase: SupabaseClient<Database>
  workspaceId: string
  userId: string
  rawUrl: string
  /** Test seam. Production hands off to the configured queue. */
  queue?: JobQueue
}): Promise<StartImportOutcome> {
  const { supabase, workspaceId, userId, rawUrl, queue = jobs } = params

  const checked = validateSourceUrl(rawUrl)
  if (!checked.ok) return { kind: "invalid", message: checked.message }

  const url = new URL(checked.url)
  const normalizedUrl = normalizeSourceUrl(checked.url)
  const provider = sourceKindFor(url)

  const existing = await findLiveImport(supabase, workspaceId, normalizedUrl)
  if (existing) return { kind: "existing", ...existing }

  const created = await createProduct(supabase, workspaceId, provisionalName(url))
  if (!created) return { kind: "error", message: "That product could not be created. Try again." }

  const { data, error } = await supabase
    .from("product_imports")
    .insert({
      workspace_id: workspaceId,
      product_id: created.id,
      provider,
      source_url: checked.url,
      normalized_url: normalizedUrl,
      requested_by: userId,
      status: "pending",
    })
    .select("id")
    .single()

  if (error || !data) {
    /*
      Losing the unique index means somebody else — another tab, a double
      click — created this import between the read above and here. The product
      just made is now an orphan with nothing pointing at it, so it is removed
      and the winner is opened. Deleting a product created moments ago by this
      same call is the one delete this path performs, and it is scoped by id and
      workspace.
    */
    await supabase.from("products").delete().eq("id", created.id).eq("workspace_id", workspaceId)

    if (error?.code === UNIQUE_VIOLATION) {
      const winner = await findLiveImport(supabase, workspaceId, normalizedUrl)
      if (winner) return { kind: "existing", ...winner }
    }
    console.error("[imports] could not create the import", { error })
    return { kind: "error", message: "That import could not be started. Try again." }
  }

  await queue.enqueue(
    "import_source",
    { workspaceId, importId: data.id },
    // The delivery key, per lib/publishing/start.ts: one hand-off per row.
    { idempotencyKey: `${data.id}:0` },
  )

  return { kind: "started", importId: data.id, productSlug: created.slug }
}

/**
 * A first name for a product made from something handed over.
 *
 * The file's name without its extension, when there is a file; the first line
 * of a paste, when it reads like a name; otherwise what the thing was. Like
 * `provisionalName`, this is the creator's own material rearranged and never an
 * inference, and it is replaced when they accept a title.
 */
export function provisionalContentName(params: {
  kind: ContentSourceKind
  filename: string | null
  firstLine: string | null
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

  return params.kind === "pdf_document"
    ? "Imported document"
    : params.kind === "html_document"
      ? "Imported HTML"
      : "Pasted text"
}

/**
 * Starting an import from a paste or an upload that is already in storage.
 *
 * The object was written before this runs — by the server for a paste, by the
 * browser through a signed URL for a file — and measured, so what is recorded
 * here is a fact about bytes that exist. There is no dedupe: a paste has no
 * stable identity the way a link does, and pasting again is how a creator
 * tries again.
 *
 * If the product or the row cannot be made, the stored object is removed, so a
 * failed start leaves nothing behind that nothing points at.
 */
export async function startContentImport(params: {
  supabase: SupabaseClient<Database>
  workspaceId: string
  userId: string
  kind: ContentSourceKind
  sourcePath: string
  filename: string | null
  byteSize: number
  firstLine: string | null
  queue?: JobQueue
}): Promise<StartImportOutcome> {
  const { supabase, workspaceId, userId, kind, sourcePath, queue = jobs } = params

  const name = provisionalContentName({
    kind,
    filename: params.filename,
    firstLine: params.firstLine,
  })
  const created = await createProduct(supabase, workspaceId, name)
  if (!created) {
    await removeStoredSource(sourcePath).catch(() => undefined)
    return { kind: "error", message: "That product could not be created. Try again." }
  }

  const { data, error } = await supabase
    .from("product_imports")
    .insert({
      workspace_id: workspaceId,
      product_id: created.id,
      provider: kind,
      source_path: sourcePath,
      source_filename: params.filename,
      source_byte_size: params.byteSize,
      requested_by: userId,
      status: "pending",
    })
    .select("id")
    .single()

  if (error || !data) {
    await supabase.from("products").delete().eq("id", created.id).eq("workspace_id", workspaceId)
    await removeStoredSource(sourcePath).catch(() => undefined)
    console.error("[imports] could not create the content import", { error })
    return { kind: "error", message: "That import could not be started. Try again." }
  }

  await queue.enqueue(
    "import_source",
    { workspaceId, importId: data.id },
    { idempotencyKey: `${data.id}:0` },
  )

  return { kind: "started", importId: data.id, productSlug: created.slug }
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

async function createProduct(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  name: string,
): Promise<{ id: string; slug: string } | null> {
  const base = avoidReserved(
    ensureMinimumLength(slugify(name), randomSuffix()),
    RESERVED_PRODUCT_SLUGS,
    randomSuffix(),
  )
  let slug = base

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase
      .from("products")
      .insert({
        workspace_id: workspaceId,
        name,
        slug,
        // The coarse A2 enum, and the honest default: nothing has been read
        // yet, so nothing is known about what kind of thing this is.
        product_type: "other",
        metadata: emptyMetadataFor("other"),
      })
      .select("id, slug")
      .single()

    if (!error && data) return data
    if (error?.code !== UNIQUE_VIOLATION) {
      console.error("[imports] could not create the product", { error })
      return null
    }
    slug = withSuffix(base, randomSuffix())
  }

  return null
}
