import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { ImportChrome } from "@/components/imports/import-chrome"
import { SourcePlaceholder } from "@/components/imports/source-placeholder"
import { FileSourceForm } from "./file-form"
import { PasteForm } from "./paste-form"
import { SourceTabs, importFromParam } from "./source-tabs"
import { PastedSourceForm } from "./text-form"

export const metadata = { title: "Import a product · Fanwise" }

/**
 * Importing a product: the empty state.
 *
 * The tenancy check is repeated here rather than trusted from the layout, per
 * docs/security.md rule 7 and exactly as `app/[slug]/new/page.tsx` does it.
 * `getWorkspaceBySlug` returns null for a workspace belonging to somebody else,
 * which is indistinguishable from one that does not exist, so a probe cannot
 * confirm a slug is real.
 *
 * Four ways in — a link, pasted text, a PDF, an HTML file — chosen by `?from=`.
 * Every one of them creates an import and redirects to `[importId]`, where the
 * reading is happening, and the same review screen takes it from there. The id
 * is in the URL so that closing the tab and coming back lands on the import
 * rather than on an empty field. The route keeps its name from when a link was
 * the only way in; renaming it would break every address already handed out.
 */
export default async function ImportProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ from?: string | string[] }>
}) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const from = importFromParam((await searchParams).from)

  return (
    <ImportChrome workspaceSlug={workspace.slug}>
      <SourceTabs workspaceSlug={workspace.slug} current={from} />

      <div className="max-w-[760px]">
        {from === "link" ? <PasteForm workspaceSlug={workspace.slug} /> : null}
        {from === "text" ? (
          <PastedSourceForm key="text" workspaceSlug={workspace.slug} kind="pasted_text" />
        ) : null}
        {from === "pdf" ? (
          <FileSourceForm key="pdf" workspaceSlug={workspace.slug} kind="pdf_document" />
        ) : null}
        {from === "html" ? (
          <div className="flex flex-col gap-10">
            <FileSourceForm key="html-file" workspaceSlug={workspace.slug} kind="html_document" />
            <div className="flex flex-col gap-3 border-t border-[var(--color-rule)] pt-8">
              <p className="text-[14px] text-[var(--color-ink-2)]">Or paste the markup instead.</p>
              <PastedSourceForm
                key="html-paste"
                workspaceSlug={workspace.slug}
                kind="html_document"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-10 max-w-[640px]">
        <SourcePlaceholder mode={from === "link" ? "link" : "content"} />
      </div>
    </ImportChrome>
  )
}
