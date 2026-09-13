import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { createClient } from "@/lib/supabase/server"
import { createAvatarUrl } from "@/lib/public/avatars"
import { loadBuilderContext, readDraft } from "@/lib/public/draft-store"
import { normalizeHandleInput } from "@/lib/public/handles"
import { arrange } from "@/lib/public/product-arrangement"
import { loadProductCandidates } from "@/lib/public/product-candidates"
import { checkDetailsStep } from "@/lib/public/profile-draft"
import { presentationFromDraft } from "@/lib/public/profile-presentation"
import { appOrigin } from "@/lib/channels/oauth"
import { routes } from "@/lib/routes"
import { BuilderHeader } from "../builder-header"
import { ManageProductsStep } from "../manage-products-step"

export const metadata = { title: "Public profile · Fanwise" }

/**
 * Step 2 of the builder: manage products.
 *
 * Reachable only once step 1 is complete, because this step's preview is the
 * profile step 1 built: a draft that was never saved, or whose details no
 * longer validate, is sent back there rather than previewed half-made.
 *
 * The arrangement is computed here, on the server, from the stored draft and
 * the workspace's own products, so the first render is already correct and
 * a refresh shows exactly the stored order.
 */
export default async function ProfileBuilderProductsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, workspace.slug)
  if (!ctx) redirect(routes.publicProfileBuilder(workspace.slug))

  const { draft, stored } = await readDraft(supabase, ctx.profile)
  if (!stored || Object.keys(checkDetailsStep(draft.fields)).length > 0) {
    redirect(routes.publicProfileBuilder(workspace.slug))
  }

  const [candidates, avatarUrl] = await Promise.all([
    loadProductCandidates(supabase, ctx, workspace.slug),
    draft.avatarPath ? createAvatarUrl(draft.avatarPath) : Promise.resolve(null),
  ])

  const rows = arrange(draft.products, candidates)
  const listed = new Set(rows.map((row) => row.product.id))
  const unlistedCount = candidates.filter(
    (candidate) => !listed.has(candidate.id) && !candidate.eligibility.eligible,
  ).length

  const identity = presentationFromDraft(draft.fields, {
    handle: normalizeHandleInput(draft.fields.handle),
    avatarUrl,
    products: [],
  })

  return (
    <div className="flex w-full flex-col gap-10 pb-24">
      <BuilderHeader workspaceSlug={workspace.slug} current={2} />
      <ManageProductsStep
        workspaceSlug={workspace.slug}
        origin={appOrigin()}
        published={ctx.profile.status === "published"}
        identity={identity}
        initial={{
          rows,
          revision: draft.revision,
          stored,
          arranged: draft.products.length > 0,
        }}
        unlistedCount={unlistedCount}
      />
    </div>
  )
}
