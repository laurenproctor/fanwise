import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { ImportScreen } from "./import-screen"

export const metadata = { title: "Import a product · Fanwise" }

/**
 * Importing a product from a link.
 *
 * The tenancy check is repeated here rather than trusted from the layout, per
 * docs/security.md rule 7 and exactly as `app/[slug]/new/page.tsx` does it.
 * `getWorkspaceBySlug` returns null for a workspace belonging to someone else,
 * which is indistinguishable from one that does not exist, so a probe cannot
 * confirm a slug is real.
 *
 * The route sits under `/new` on purpose. `new` is already in
 * `RESERVED_PRODUCT_SLUGS`, so nesting here reserves no new word in the
 * product-slug namespace, and it leaves `/[slug]/import` free for B12, which is
 * a different feature with the same English name (`docs/listing-import.md`).
 *
 * The screen asks for the whole window rather than the workspace's reading
 * column, which it does by marking its own root `data-workspace-canvas="full"`.
 * The shared header above `<main>` is untouched, here and everywhere else.
 */
export default async function ImportProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  return <ImportScreen workspaceSlug={workspace.slug} userId={user.id} />
}
