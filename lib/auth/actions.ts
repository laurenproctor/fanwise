"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { clientEnv } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"
import { PASSWORD_RESET_PATH } from "@/lib/auth/redirect-target"
import {
  credentialsSchema,
  newPasswordSchema,
  passwordResetRequestSchema,
} from "@/lib/workspaces/schemas"

export interface AuthState {
  error: string | null
}

/**
 * The reset request never reports whether the address was found, so its result
 * carries an acknowledgement rather than an outcome.
 */
export interface ResetRequestState {
  error: string | null
  sent: boolean
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
  if (m.includes("different from the old")) {
    return "Choose a password you have not used on this account before."
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

/**
 * Step one of recovery: send the link.
 *
 * The answer is the same sentence whether or not the address has an account,
 * and whether or not Supabase accepted the send. An error here would otherwise
 * be an oracle: "too many attempts" only comes back for an address that exists,
 * and that is enough to enumerate a customer list one address at a time. The
 * only thing reported is a malformed address, which the browser knows already
 * and which does not depend on any account.
 */
export async function requestPasswordResetAction(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const parsed = passwordResetRequestSchema.safeParse({ email: formData.get("email") })
  if (!parsed.success) {
    return { error: "Enter a valid email address.", sent: false }
  }

  const supabase = await createClient()
  // Built from the configured app URL, never from a request header: a redirect
  // target taken from a header is a redirect target an attacker can suggest.
  const redirectTo = new URL("/auth/confirm", clientEnv().NEXT_PUBLIC_APP_URL)
  redirectTo.searchParams.set("next", PASSWORD_RESET_PATH)

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: redirectTo.toString(),
  })

  return { error: null, sent: true }
}

/**
 * Step two: set the new password against the session the recovery link
 * established. There is no token parameter here, and there should not be one.
 * The link was already spent at /auth/confirm, so this action authorizes on the
 * session cookie like every other write in the app.
 */
export async function updatePasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the password and try again." }
  }

  const supabase = await createClient()

  // Rule 7 of docs/security.md: every write authorized here, in the action.
  // "The page only renders the form with a session" is not authorization.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: "That reset link has expired. Request a new one." }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    return { error: normalizeAuthError(error.message, "That password could not be saved.") }
  }

  // Recovery exists because the old password may be in someone else's hands.
  // Leaving sessions opened with it alive would defeat the point. This session
  // survives; every other one does not.
  await supabase.auth.signOut({ scope: "others" })

  revalidatePath("/", "layout")
  redirect("/")
}
