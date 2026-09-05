import { redirect } from "next/navigation"
import { getCurrentUser, listWorkspaces } from "@/lib/workspaces/queries"
import { routes } from "@/lib/routes"

/**
 * The root is a resolver, not a page. Every real surface lives under a workspace
 * slug, so this decides which one and gets out of the way.
 */
export default async function RootPage() {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const workspaces = await listWorkspaces()
  const first = workspaces[0]
  if (!first) redirect("/onboarding")

  redirect(routes.workspace(first.slug))
}
