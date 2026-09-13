import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { ImportChrome } from "@/components/imports/import-chrome"
import { JourneySteps } from "@/components/imports/composer/journey-steps"
import { UniversalComposer } from "@/components/imports/composer/universal-composer"

export const metadata = { title: "Create a product listing · Fanwise" }

/**
 * Creating a product listing from whatever the creator already has.
 *
 * The tenancy check is repeated here rather than trusted from the layout, per
 * docs/security.md rule 7. `getWorkspaceBySlug` returns null for a workspace
 * belonging to somebody else, which is indistinguishable from one that does not
 * exist, so a probe cannot confirm a slug is real.
 *
 * One composer takes a link, pasted text, PDFs, HTML files and a recording, in
 * any combination, and "Create draft" makes one import session and redirects to
 * `[importId]`, where the reading happens and the review screen takes over.
 *
 * The route keeps its name from when a link was the only way in: renaming it
 * would break every import address already handed out. An older link to
 * `?from=text` lands here too, on the same composer.
 */
export default async function CreateListingPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  return (
    <ImportChrome
      workspaceSlug={workspace.slug}
      heading="Create a product listing"
      lede="Add anything you already have. Fanwise will organize it into an editable draft."
      width="composer"
    >
      <div className="flex flex-col gap-10">
        <UniversalComposer workspaceSlug={workspace.slug} />
        <JourneySteps />
      </div>
    </ImportChrome>
  )
}
