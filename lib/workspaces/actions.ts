"use server"

import { randomUUID } from "node:crypto"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { studioDetailsSchema } from "./schemas"
import {
  buildIconPath,
  checkIcon,
  MAX_ICON_BYTES,
  removeIcons,
  uploadIcon,
  type IconMimeType,
} from "./icons"
import { routes } from "@/lib/routes"

/**
 * Save state for the Studio details section.
 *
 * Field-scoped rather than one message: the section has a name and an icon, and
 * "that could not be saved" over the whole section tells a creator nothing about
 * which control to fix. `savedAt` confirms the save actually landed.
 */
export interface StudioDetailsState {
  error: string | null
  fieldErrors: { name?: string; icon?: string }
  savedAt: number | null
  /**
   * What the workspace holds now, when this save is the reason it holds it.
   *
   * The form compares its fields against this rather than keeping a second copy
   * of "last saved" in a state hook it has to remember to update. A save that
   * lands moves the baseline, the fields already match it, and the button turns
   * itself off without anything synchronising anything.
   */
  saved: { name: string; hasIcon: boolean } | null
}

/**
 * Saves the Studio details section: the workspace name, and the icon if one was
 * chosen or removed.
 *
 * The icon is staged with the rest of the section rather than uploaded the
 * moment it is picked. A creator who selects an image and then navigates away
 * has changed nothing, which is the behaviour the button promises; immediate
 * upload would mean an abandoned page still moved their icon.
 *
 * Order matters on the way through. The object is written to storage first and
 * the column second, so a failure between the two leaves an unreferenced object
 * (invisible, a few kilobytes) rather than a column pointing at nothing (a
 * broken icon the page keeps trying to render). The old object is removed only
 * after the column has moved, and a failure there is swallowed for the same
 * reason.
 *
 * Authorization is RLS. The update policy admits the owner only, so a slug that
 * belongs to someone else matches no row, exactly like one that does not exist,
 * and both get the same sentence back.
 */
export async function saveStudioDetailsAction(
  workspaceSlug: string,
  _prev: StudioDetailsState,
  formData: FormData,
): Promise<StudioDetailsState> {
  const parsed = studioDetailsSchema.safeParse({ name: formData.get("name") })
  if (!parsed.success) {
    return {
      error: null,
      fieldErrors: { name: parsed.error.issues[0]?.message ?? "Check the workspace name." },
      savedAt: null,
      saved: null,
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  // Read before write: the icon path is needed to clean up a replaced object,
  // and the id is needed to build the new path. RLS scopes this to a workspace
  // the caller can see.
  const { data: workspace, error: readError } = await supabase
    .from("workspaces")
    .select("id, icon_path")
    .eq("slug", workspaceSlug)
    .maybeSingle()

  if (readError || !workspace) {
    if (readError) console.error("[workspaces] settings read failed", readError)
    return {
      error: "Those details could not be saved. Try again.",
      fieldErrors: {},
      savedAt: null,
      saved: null,
    }
  }

  const removeRequested = formData.get("removeIcon") === "true"
  const file = formData.get("icon")
  const hasUpload = file instanceof File && file.size > 0

  let nextIconPath: string | null | undefined
  let uploadedPath: string | null = null

  if (hasUpload) {
    // Checked before the bytes are read as well as after, so an oversized file
    // is refused without buffering it.
    if (file.size > MAX_ICON_BYTES) {
      return {
        error: null,
        fieldErrors: { icon: "That image is over 4 MB. Choose a smaller one." },
        savedAt: null,
        saved: null,
      }
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const checked = checkIcon(bytes, file.size)
    if (!checked.ok) {
      return { error: null, fieldErrors: { icon: checked.message }, savedAt: null, saved: null }
    }

    const path = buildIconPath(workspace.id, randomUUID(), checked.mimeType as IconMimeType)
    try {
      await uploadIcon(path, checked.bytes, checked.mimeType as IconMimeType)
    } catch (error) {
      console.error("[workspaces] icon upload failed", error)
      return {
        error: null,
        fieldErrors: { icon: "That image could not be uploaded. Try again." },
        savedAt: null,
        saved: null,
      }
    }
    uploadedPath = path
    nextIconPath = path
  } else if (removeRequested) {
    nextIconPath = null
  }

  const update: { name: string; icon_path?: string | null } = { name: parsed.data.name }
  if (nextIconPath !== undefined) update.icon_path = nextIconPath

  const { data, error } = await supabase
    .from("workspaces")
    .update(update)
    .eq("slug", workspaceSlug)
    .select("id")

  if (error || !data || data.length === 0) {
    // Rule 8: never surface a raw provider error.
    if (error) console.error("[workspaces] studio details save failed", error)
    // The object written a moment ago is now unreferenced. Best effort.
    if (uploadedPath) await removeIcons([uploadedPath]).catch(() => {})
    return {
      error: "Those details could not be saved. Try again.",
      fieldErrors: {},
      savedAt: null,
      saved: null,
    }
  }

  // The column has moved, so the old object is safe to drop. A failure here
  // leaves a stray object and must not fail a save that already landed.
  if (workspace.icon_path && workspace.icon_path !== nextIconPath && nextIconPath !== undefined) {
    await removeIcons([workspace.icon_path]).catch((cause) => {
      console.error("[workspaces] stale icon not removed", cause)
    })
  }

  // The name and the icon are in the header of every page under this workspace.
  revalidatePath(routes.workspace(workspaceSlug), "layout")
  const hasIcon = nextIconPath === undefined ? workspace.icon_path !== null : nextIconPath !== null
  return {
    error: null,
    fieldErrors: {},
    savedAt: Date.now(),
    saved: { name: parsed.data.name, hasIcon },
  }
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/sign-in")
}
