"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createWorkspaceSchema } from "./schemas"
import { ensureMinimumLength, randomSuffix, slugify, withSuffix } from "@/lib/slug"

export interface ActionState {
  error: string | null
}

/** How many slug collisions to absorb before giving up and asking for a new name. */
const MAX_SLUG_ATTEMPTS = 5

// Postgres unique_violation. The slug column is the only unique constraint on
// workspaces, so this can only mean the slug was taken.
const UNIQUE_VIOLATION = "23505"

export async function createWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createWorkspaceSchema.safeParse({ name: formData.get("name") })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the workspace name." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const base = ensureMinimumLength(slugify(parsed.data.name), randomSuffix())
  let slug = base

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase.rpc("create_workspace", {
      p_name: parsed.data.name,
      p_slug: slug,
    })

    if (!error && data) {
      revalidatePath("/", "layout")
      redirect(`/w/${data.slug}`)
    }

    if (error?.code !== UNIQUE_VIOLATION) {
      // Rule 8: never surface a raw provider error.
      console.error("[workspaces] create_workspace failed", error)
      return { error: "That workspace could not be created. Try again." }
    }

    slug = withSuffix(base, randomSuffix())
  }

  return { error: "That name is taken. Try a different one." }
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/sign-in")
}
