import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { routes } from "@/lib/routes"
import { provisionPersonalWorkspace } from "@/lib/workspaces/provision"

/**
 * Where an account without a workspace is sent, and where it gets one.
 *
 * This used to be a form asking the creator to name a workspace before they had
 * seen anything. It now provisions a personal workspace and sends them into it,
 * so the first thing a new account sees is its own catalog.
 *
 * It is a GET, so it will be replayed: refreshed, opened in two tabs, reached
 * again from the root after every sign-in. That is safe because the database
 * makes it safe. provision_personal_workspace() serializes on the caller and
 * returns the workspace they already have, so a replay redirects rather than
 * creates, and someone who already has a workspace is routed to it by the same
 * call.
 *
 * A route handler rather than a page, because a write does not belong in a
 * render. Nothing links here through next/link, which would prefetch it.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // The proxy has already turned an anonymous request away. That is a
  // convenience, not authorization, so it is checked again here.
  if (!user) redirect("/sign-in")

  const result = await provisionPersonalWorkspace(supabase, user)
  if (!result.ok) redirect("/onboarding/unavailable")

  redirect(routes.workspace(result.workspace.slug))
}
