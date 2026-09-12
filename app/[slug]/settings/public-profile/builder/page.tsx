import { notFound, redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { createClient } from "@/lib/supabase/server"
import { createPublicProfileAction } from "@/lib/public/actions"
import { createAvatarUrl } from "@/lib/public/avatars"
import { loadBuilderContext, readDraft } from "@/lib/public/draft-store"
import { appOrigin } from "@/lib/channels/oauth"
import { BuilderHeader } from "./builder-header"
import { ProfileDetailsStep } from "./profile-details-step"

export const metadata = { title: "Public profile · Fanwise" }

/** Fields step 3 may send the creator back to, named in `?field=`. */
const FOCUSABLE = new Set([
  "handle",
  "displayName",
  "shortBio",
  "website",
  "instagram",
  "behance",
  "image",
] as const)
type FocusField = typeof FOCUSABLE extends Set<infer T> ? T : never

/**
 * Step 1 of the public-profile builder: profile details.
 *
 * Reads the stored draft, or the live profile copied when nothing has been
 * saved yet. A GET never writes: the first autosave creates the draft row.
 */
export default async function ProfileBuilderDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ field?: string | string[] }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in")

  const { slug } = await params
  const { field } = await searchParams
  const focusField =
    typeof field === "string" && FOCUSABLE.has(field as FocusField) ? (field as FocusField) : null
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, workspace.slug)

  return (
    <div className="flex w-full flex-col gap-10 pb-24">
      <BuilderHeader workspaceSlug={workspace.slug} current={1} />

      {ctx === null ? (
        <NoProfileYet workspaceSlug={workspace.slug} />
      ) : (
        <DetailsStep
          workspaceSlug={workspace.slug}
          ctx={ctx}
          supabase={supabase}
          focusField={focusField}
        />
      )}
    </div>
  )
}

async function DetailsStep({
  workspaceSlug,
  ctx,
  supabase,
  focusField,
}: {
  focusField: FocusField | null
  workspaceSlug: string
  ctx: NonNullable<Awaited<ReturnType<typeof loadBuilderContext>>>
  supabase: Awaited<ReturnType<typeof createClient>>
}) {
  const { draft, stored } = await readDraft(supabase, ctx.profile)
  const avatarUrl = draft.avatarPath ? await createAvatarUrl(draft.avatarPath) : null

  return (
    <ProfileDetailsStep
      workspaceSlug={workspaceSlug}
      origin={appOrigin()}
      liveHandle={ctx.profile.handle}
      published={ctx.profile.status === "published"}
      initial={{ fields: draft.fields, revision: draft.revision, avatarUrl, stored }}
      focusField={focusField}
    />
  )
}

/**
 * No profile row yet. Creating one reserves a suggested handle on a profile
 * that is born `draft`; nothing becomes public by pressing this.
 */
function NoProfileYet({ workspaceSlug }: { workspaceSlug: string }) {
  const create = createPublicProfileAction.bind(null, workspaceSlug, "builder")
  return (
    <section className="flex flex-col items-start gap-5 rounded-[16px] border border-dashed border-[var(--color-rule)] px-6 py-12">
      <span className="label-mono">Not set up yet</span>
      <h2 className="font-display max-w-[22ch] text-[28px] leading-[1.1] font-light tracking-[-0.03em]">
        Start your public profile
      </h2>
      <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
        Fanwise suggests an address from your studio name, and you can change it before anyone sees
        it. Nothing goes public until you publish.
      </p>
      <form action={create}>
        <Button type="submit">Start building</Button>
      </form>
    </section>
  )
}
