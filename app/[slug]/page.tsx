import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { loadCatalog } from "@/lib/catalog/queries"
import { matchesFilter, matchesSearch, parseFilter } from "@/lib/catalog/summary"
import { ButtonLink } from "@/components/ui/button"
import { FirstRun } from "@/components/onboarding/first-run"
import { routes } from "@/lib/routes"
import { CatalogControls } from "./catalog-controls"
import { CatalogList, toRow } from "./catalog-list"

export const metadata = { title: "Products · Fanwise" }

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const entries = await loadCatalog(workspace.id)

  // No products is a creator's first visit, or a return before the first one
  // exists. Both get the first-run screen, decided by the catalog itself rather
  // than by a flag or a query parameter, so it stays exactly as long as it is
  // true.
  //
  // Decided before the search parameters are read, and from the same load the
  // populated view uses. A workspace with products and a search that matches
  // none of them is a different screen entirely, and showing the first-run
  // hero there would tell a creator with twelve products that they have none.
  if (entries.length === 0) return <FirstRun workspaceSlug={slug} />

  const { q, status } = await searchParams
  const query = q ?? ""
  const filter = parseFilter(status)

  /*
   * Filtered here rather than in SQL, on the one load the page already made.
   *
   * The status filter has no choice: every concern it groups on is derived at
   * read time from listings, manual steps and the adapters' own rules, and none
   * of it is a column to put in a WHERE clause. Searching in SQL and filtering
   * in memory would then be two passes over the same catalog with two different
   * notions of which rows exist. A creator's catalog is tens of products, not
   * millions; when that stops being true the fix is a paged query, not a second
   * source of truth.
   */
  const rows = entries
    .map((entry) => toRow(entry, slug))
    .filter(
      (row) =>
        matchesSearch({ name: row.name, typeLabel: row.typeLabel }, query) &&
        matchesFilter(filter, row.concern),
    )

  const filtering = query.trim() !== "" || filter !== "all"

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex flex-col gap-2">
          <span className="label-mono">Catalog</span>
          <h1 className="font-display text-4xl font-extralight tracking-[-0.03em]">Products</h1>
          <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
            Build once. Prepare every marketplace version.
          </p>
        </div>
        {/*
          The page's only primary action. The rows offer links, never buttons,
          so that this is the one thing on the screen with a filled background.
        */}
        <ButtonLink href={routes.newProduct(slug)}>Add product</ButtonLink>
      </div>

      <div className="flex flex-col gap-4">
        <CatalogControls
          basePath={routes.workspace(slug)}
          query={query}
          filter={filter}
          showClear={filtering}
        />

        {/*
          Announced on a client-side navigation, which is what a search here is.
          Silent when nothing is narrowing the list: a count read out on every
          visit to an unfiltered catalog is noise, and the rows say it already.
        */}
        <p
          role="status"
          className={`text-[13px] text-[var(--color-ink-2)] ${filtering ? "" : "sr-only"}`}
        >
          {filtering ? countSentence(rows.length, entries.length) : ""}
        </p>
      </div>

      {rows.length === 0 ? <NoResults workspaceSlug={slug} /> : <CatalogList rows={rows} />}
    </div>
  )
}

function countSentence(shown: number, total: number): string {
  if (shown === 0) return `No products match. ${total} in the catalog.`
  return shown === 1 ? `Showing 1 of ${total} products.` : `Showing ${shown} of ${total} products.`
}

/**
 * A search that found nothing, which is not an empty catalog.
 *
 * Deliberately small, and deliberately not the first-run hero: the workspace
 * has products, and offering to create the first one here would be answering a
 * question nobody asked. One way out, back to the whole catalog.
 */
function NoResults({ workspaceSlug }: { workspaceSlug: string }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-[14px] border border-dashed border-[var(--color-rule)] px-6 py-10">
      <p className="font-display text-[20px] font-light tracking-[-0.02em]">
        No products match those filters.
      </p>
      <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
        Every product is still here. Try a different word, or a wider filter — the search looks at a
        product&rsquo;s name and its type.
      </p>
      <ButtonLink href={routes.workspace(workspaceSlug)} variant="secondary">
        Show all products
      </ButtonLink>
    </div>
  )
}
