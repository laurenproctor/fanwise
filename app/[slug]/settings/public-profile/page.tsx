import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { getProfileForSettings } from "@/lib/public/workspace-queries"
import { loadBuilderContext } from "@/lib/public/draft-store"
import { loadPublishState } from "@/lib/public/publish-state"
import { createClient } from "@/lib/supabase/server"
import { createPublicProfileAction } from "@/lib/public/actions"
import { appOrigin } from "@/lib/channels/oauth"
import { routes } from "@/lib/routes"
import { Button } from "@/components/ui/button"
import { FanLines } from "@/components/ui/fan-lines"
import { SettingsSection } from "../settings-section"
import { PublishControls } from "./publish-controls"

export const metadata = { title: "Public profile · Fanwise" }

/**
 * The public profile, managed.
 *
 * A page of its own under Settings rather than a fourth section on the
 * settings page, for a reason that is about the content and not the length:
 * the other three sections describe things only the creator ever sees, and
 * this one describes a page strangers see. Mixing "your email address" and
 * "your public biography" into one scroll is how somebody publishes the
 * first while editing the second.
 *
 * Since the builder, this page is the overview rather than the editor: the
 * address, whether it is live, the way into the builder, and Unpublish.
 * Editing here used to write the live profile directly; now every edit is a
 * draft until the builder's Publish, so there is exactly one path to public.
 */
export default async function PublicProfileSettingsPage({
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
  const [settings, ctx] = await Promise.all([
    getProfileForSettings(workspace.id),
    loadBuilderContext(supabase, workspace.slug),
  ])
  const origin = appOrigin()
  const live = ctx ? (await loadPublishState(supabase, ctx, workspace.slug)).live : null

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-12 pb-24 sm:gap-14 lg:gap-16">
      <header className="relative isolate flex flex-col gap-4 overflow-hidden pt-4 pb-2">
        <FanLines className="-top-4 -right-6 -z-10 hidden h-[230px] w-[280px] opacity-60 lg:block" />
        <nav aria-label="Breadcrumb">
          <Link
            href={routes.settings(workspace.slug)}
            className="label-mono underline-offset-4 hover:text-[var(--color-ink-2)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            ← Settings
          </Link>
        </nav>
        <h1 className="font-display max-w-[16ch] text-[44px] leading-[1.05] font-extralight tracking-[-0.04em] text-balance sm:text-[56px]">
          Public profile
        </h1>
        <p className="max-w-prose text-[16px] text-[var(--color-ink-2)]">
          Your portfolio on the open web: one address that gathers everything you sell, wherever you
          sell it. Everything on this page is public once you publish it. Your account email, your
          billing and your unpublished products never appear here.
        </p>
      </header>

      {settings === null || ctx === null ? (
        <NoProfileYet workspaceSlug={workspace.slug} />
      ) : (
        <SettingsSection
          id="publishing"
          heading="Publishing"
          description="Your address, whether the world can see it, and where to edit it."
        >
          <PublishControls
            workspaceSlug={workspace.slug}
            handle={settings.profile.handle}
            status={settings.profile.status}
            appOrigin={origin}
            publishedCount={settings.publishedCount}
            hasUnpublishedChanges={live?.hasUnpublishedChanges ?? false}
          />
        </SettingsSection>
      )}
    </div>
  )
}

/**
 * The empty state, which is also the first-run state.
 *
 * One button, and it creates a draft rather than a live page. A creator who
 * presses it has not published anything and cannot have: the profile is born
 * `draft`, and the publish control on the next screen is a separate, explicit
 * act. Saying so here is what makes the button safe to press.
 */
function NoProfileYet({ workspaceSlug }: { workspaceSlug: string }) {
  const create = createPublicProfileAction.bind(null, workspaceSlug, "builder")

  return (
    <section className="flex flex-col items-start gap-5 rounded-[16px] border border-dashed border-[var(--color-rule)] px-6 py-12">
      <span className="label-mono">Not set up yet</span>
      <h2 className="font-display max-w-[22ch] text-[28px] leading-[1.1] font-light tracking-[-0.03em]">
        Give your studio a public address
      </h2>
      <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
        Fanwise suggests an address from your studio name, and you can change it before anyone sees
        it. Nothing goes public until you publish it from the builder.
      </p>
      <form action={create}>
        <Button type="submit">Create a public profile</Button>
      </form>
    </section>
  )
}
