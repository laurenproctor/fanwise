import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/database.types"

export type Workspace = Database["public"]["Tables"]["workspaces"]["Row"]
export type WorkspaceRole = Database["public"]["Enums"]["workspace_role"]

export interface WorkspaceMember {
  user_id: string
  role: WorkspaceRole
  created_at: string
}

/**
 * The signed-in user, revalidated against the auth server. Never trust
 * getSession() for an authorization decision; it only decodes a cookie.
 */
export async function getCurrentUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/**
 * Every workspace the current user belongs to. RLS does the filtering, so this
 * cannot return someone else's workspace even if the query forgets to scope.
 */
export async function listWorkspaces(): Promise<Workspace[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .order("created_at", { ascending: true })

  if (error) throw error
  return data ?? []
}

/**
 * One workspace by slug, or null. Returns null rather than throwing for a
 * workspace the user cannot see, so callers cannot distinguish "does not exist"
 * from "not yours" and leak the difference.
 */
export async function getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", slug)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })

  if (error) throw error
  return data ?? []
}
