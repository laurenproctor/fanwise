import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { PasteForm } from "./paste-form"

export const metadata = { title: "Import a product · Fanwise" }

/**
 * Importing a product from a public link: the empty state.
 *
 * The tenancy check is repeated here rather than trusted from the layout, per
 * docs/security.md rule 7 and exactly as `app/[slug]/new/page.tsx` does it.
 * `getWorkspaceBySlug` returns null for a workspace belonging to somebody else,
 * which is indistinguishable from one that does not exist, so a probe cannot
 * confirm a slug is real.
 *
 * Pasting a link creates an import and redirects to `[importId]`, where the
 * reading is happening. The id is in the URL so that closing the tab and coming
 * back lands on the import rather than on an empty field.
 */
export default async function ImportProductPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  return <PasteForm workspaceSlug={workspace.slug} />
}
