"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { renameWorkspaceSchema } from "./schemas"
import { routes } from "@/lib/routes"

/** Save state for the rename form. `savedAt` confirms the save actually landed. */
export interface RenameState {
  error: string | null
  savedAt: number | null
}

/**
 * Renames a workspace. The slug stays put: it is the address, and an address
 * does not move because a name did.
 *
 * Workspaces are provisioned now (lib/workspaces/provision.ts) and start life
 * with a name nobody chose, so this is where a creator first names theirs.
 *
 * Authorization is RLS. The update policy admits the owner only, so a slug that
 * belongs to someone else matches no row, exactly like one that does not exist,
 * and both get the same sentence back.
 */
export async function renameWorkspaceAction(
  workspaceSlug: string,
  _prev: RenameState,
  formData: FormData,
): Promise<RenameState> {
  const parsed = renameWorkspaceSchema.safeParse({ name: formData.get("name") })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the workspace name.", savedAt: null }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data, error } = await supabase
    .from("workspaces")
    .update({ name: parsed.data.name })
    .eq("slug", workspaceSlug)
    .select("id")

  if (error || !data || data.length === 0) {
    // Rule 8: never surface a raw provider error.
    if (error) console.error("[workspaces] rename failed", error)
    return { error: "That name could not be saved. Try again.", savedAt: null }
  }

  // The name is in the header of every page under this workspace.
  revalidatePath(routes.workspace(workspaceSlug), "layout")
  return { error: null, savedAt: Date.now() }
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/sign-in")
}
