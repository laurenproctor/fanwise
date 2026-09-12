import { notFound, redirect } from "next/navigation"
import { ButtonLink } from "@/components/ui/button"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { routes } from "@/lib/routes"
import { BuilderHeader } from "../builder-header"

export const metadata = { title: "Public profile · Fanwise" }

/**
 * Step 2, Manage products. Not built in this phase: Step 1's Continue lands
 * here so the flow has a real destination, and the page says plainly that the
 * step is still to come rather than offering controls that do nothing.
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

  return (
    <div className="flex w-full flex-col gap-10 pb-24">
      <BuilderHeader workspaceSlug={workspace.slug} current={2} />
      <section className="flex flex-col items-start gap-5 rounded-[16px] border border-dashed border-[var(--color-rule)] px-6 py-12">
        <span className="label-mono">Coming next</span>
        <h2 className="font-display max-w-[24ch] text-[28px] leading-[1.1] font-light tracking-[-0.03em]">
          Choosing and ordering products is on its way
        </h2>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          Your profile details are saved as a draft. Nothing has been published.
        </p>
        <ButtonLink href={routes.publicProfileBuilder(workspace.slug)} variant="secondary">
          Back to profile details
        </ButtonLink>
      </section>
    </div>
  )
}
