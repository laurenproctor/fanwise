import { redirect } from "next/navigation"
import { Landing } from "@/components/marketing/landing"
import { getCurrentUser, listWorkspaces } from "@/lib/workspaces/queries"
import { routes } from "@/lib/routes"

/**
 * The root serves two audiences.
 *
 * To a visitor it is the marketing landing page. To someone signed in it is a
 * resolver, as it always was: every real surface lives under a workspace slug,
 * so this decides which one and gets out of the way.
 *
 * The proxy lists `/` as public for this reason. That is convenience, not
 * authorization — nothing below the landing page is reachable without the
 * workspace routes doing their own check.
 */
export default async function RootPage() {
  if (!(await getCurrentUser())) return <Landing />

  const workspaces = await listWorkspaces()
  const first = workspaces[0]
  if (!first) redirect("/onboarding")

  redirect(routes.workspace(first.slug))
}
