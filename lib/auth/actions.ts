"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { credentialsSchema } from "@/lib/workspaces/schemas"

export interface AuthState {
  error: string | null
}

/**
 * Rule 8: normalize provider errors. Supabase auth messages are reasonable but
 * they leak provider vocabulary and occasionally reveal whether an address is
 * registered, which is an enumeration vector.
 */
function normalizeAuthError(message: string, fallback: string): string {
  const m = message.toLowerCase()
  if (m.includes("invalid login credentials")) return "That email and password do not match."
  if (m.includes("already registered")) return "That email is already in use. Sign in instead."
  if (m.includes("email rate limit") || m.includes("rate limit")) {
    return "Too many attempts. Wait a moment and try again."
  }
  if (m.includes("password")) return "That password was rejected. Use at least 10 characters."
  return fallback
}

function parseCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
}

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parseCredentials(formData)
  if (!parsed.success) {
    // Deliberately generic. Telling an anonymous caller which half was wrong
    // helps them enumerate accounts.
    return { error: "That email and password do not match." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    return { error: normalizeAuthError(error.message, "That email and password do not match.") }
  }

  revalidatePath("/", "layout")
  redirect("/")
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parseCredentials(formData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details and try again." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp(parsed.data)

  if (error) {
    return { error: normalizeAuthError(error.message, "That account could not be created.") }
  }

  // With email confirmations enabled there is no session yet. Local config has
  // them off so signup returns a session directly; production turns them on at
  // step C4, and this branch is what will catch that change.
  if (!data.session) {
    return { error: "Check your email to confirm the account, then sign in." }
  }

  revalidatePath("/", "layout")
  redirect("/")
}
