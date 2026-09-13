import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { createClient } from "@/lib/supabase/server"
import { loadBuilderContext } from "@/lib/public/draft-store"
import { checkDetailsStep } from "@/lib/public/profile-draft"
import { normalizeHandleInput } from "@/lib/public/handles"
import { loadPublishState } from "@/lib/public/publish-state"
import { appOrigin } from "@/lib/channels/oauth"
import { publicRoutes, routes } from "@/lib/routes"
import { BuilderHeader } from "../builder-header"
import { PublishStep } from "../publish-step"

export const metadata = { title: "Public profile · Fanwise" }

/**
 * Step 3 of the builder: preview and publish.
 *
 * Everything shown is computed on the server from the stored draft: the
 * readiness issues, the address check, which selected products are still
 * eligible. A draft that was never saved goes back to step 1, because there is
 * nothing here to review.
 */
export default async function ProfileBuilderPublishPage({
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

  const state = await loadPublishState(supabase, ctx, workspace.slug)
  if (!state.stored || state.draft.updatedAt === null) {
    redirect(routes.publicProfileBuilder(workspace.slug))
  }

  const handle = normalizeHandleInput(state.draft.fields.handle)

  return (
    <div className="flex w-full flex-col gap-10 pb-24">
      <BuilderHeader workspaceSlug={workspace.slug} current={3} />
      <PublishStep
        workspaceSlug={workspace.slug}
        origin={appOrigin()}
        presentation={state.presentation}
        issues={state.readiness.issues}
        summary={{
          detailsComplete: Object.keys(checkDetailsStep(state.draft.fields)).length === 0,
          selectedCount: state.presentation.products.length,
          publicPath: publicRoutes.profile(handle),
        }}
        expectedDraftUpdatedAt={state.draft.updatedAt}
        live={{
          status: state.live.status,
          handle: state.live.handle,
          hasUnpublishedChanges: state.live.hasUnpublishedChanges,
        }}
      />
    </div>
  )
}
