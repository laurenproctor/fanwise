"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { clientEnv } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"
import { PASSWORD_RESET_PATH } from "@/lib/auth/redirect-target"
import { accountDetailsSchema } from "@/lib/workspaces/schemas"
import { nameMetadata } from "./profile"

/**
 * Save state for the Account section. Field-scoped, like Studio details, so an
 * invalid address points at the address rather than at the section.
 *
 * `emailPending` is the half of this save that does not finish here: a changed
 * address needs confirming by email, and saying "saved" over a change that has
 * not happened yet would be a lie the creator only discovers when their sign-in
 * still wants the old address.
 */
export interface AccountState {
  error: string | null
  fieldErrors: { firstName?: string; lastName?: string; email?: string }
  savedAt: number | null
  emailPending: string | null
  /**
   * What the account holds now, when this save is the reason it holds it.
   *
   * The email here is the address actually on the account, which is the OLD one
   * when a change is awaiting confirmation. The form compares its fields against
   * this, so a pending address correctly reads as still-unsaved rather than as
   * done.
   */
  saved: { firstName: string; lastName: string; email: string } | null
}

/** Rule 8. The provider's own sentences leak its vocabulary and its enumerable facts. */
function normalize(message: string, fallback: string): string {
  const m = message.toLowerCase()
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "That address is already in use."
  }
  if (m.includes("rate limit")) return "Too many attempts. Wait a moment and try again."
  if (m.includes("reauthentication")) {
    return "Sign in again before changing your email address."
  }
  return fallback
}

/**
 * Saves the Account section: the person's name, and their email address if it
 * changed.
 *
 * The name is metadata and lands immediately. The address does not: Supabase is
 * configured with double_confirm_changes, so a change sends a link to the
 * current address AND to the new one, and the address moves only once both have
 * been followed. Until then the account keeps the address it has and the session
 * is untouched. That is what `emailPending` carries back, and the form says it
 * in those terms rather than reporting a change that has not happened.
 */
export async function saveAccountDetailsAction(
  workspaceSlug: string,
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const parsed = accountDetailsSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
  })

  if (!parsed.success) {
    const fieldErrors: AccountState["fieldErrors"] = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (key === "firstName" || key === "lastName" || key === "email") {
        fieldErrors[key] ??= issue.message
      }
    }
    return { error: null, fieldErrors, savedAt: null, emailPending: null, saved: null }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { firstName, lastName, email } = parsed.data
  const emailChanged = email.toLowerCase() !== (user.email ?? "").toLowerCase()

  const { error: nameError } = await supabase.auth.updateUser({
    data: nameMetadata(firstName, lastName),
  })
  if (nameError) {
    console.error("[account] name save failed", nameError)
    return {
      error: "Your details could not be saved. Try again.",
      fieldErrors: {},
      savedAt: null,
      emailPending: null,
      saved: null,
    }
  }

  if (emailChanged) {
    // Built from the configured app URL, never from a request header: a
    // redirect target taken from a header is one an attacker can suggest.
    const redirectTo = new URL("/auth/confirm", clientEnv().NEXT_PUBLIC_APP_URL)

    const { error: emailError } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: redirectTo.toString() },
    )

    if (emailError) {
      // The name did land. Say so, and point the failure at the field that
      // caused it, so a rejected address does not read as a lost name.
      return {
        error: null,
        fieldErrors: {
          email: normalize(emailError.message, "That address could not be changed."),
        },
        savedAt: Date.now(),
        emailPending: null,
        saved: { firstName, lastName, email: user.email ?? "" },
      }
    }

    revalidatePath(`/${workspaceSlug}`, "layout")
    // The address has NOT moved yet, so the baseline keeps the current one.
    return {
      error: null,
      fieldErrors: {},
      savedAt: Date.now(),
      emailPending: email,
      saved: { firstName, lastName, email: user.email ?? "" },
    }
  }

  revalidatePath(`/${workspaceSlug}`, "layout")
  return {
    error: null,
    fieldErrors: {},
    savedAt: Date.now(),
    emailPending: null,
    saved: { firstName, lastName, email },
  }
}

export interface PasswordChangeState {
  error: string | null
  sent: boolean
}

/**
 * Starts a password change by sending the account's own address a reset link.
 *
 * Deliberately the recovery flow rather than a password field on this page.
 * Supabase's updateUser({ password }) does not require the old password, so a
 * field here would let anyone who found an unlocked laptop take the account
 * without knowing anything. The emailed link proves possession of the inbox,
 * and /reset-password already ends by signing every other session out.
 *
 * The address is the session's own and is never read from the form, so this
 * cannot be pointed at somebody else's inbox.
 */
export async function requestPasswordChangeAction(
  _prev: PasswordChangeState,
): Promise<PasswordChangeState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) redirect("/sign-in")

  const redirectTo = new URL("/auth/confirm", clientEnv().NEXT_PUBLIC_APP_URL)
  redirectTo.searchParams.set("next", PASSWORD_RESET_PATH)

  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: redirectTo.toString(),
  })

  if (error) {
    console.error("[account] password reset send failed", error)
    return {
      error: normalize(error.message, "That link could not be sent. Try again."),
      sent: false,
    }
  }

  return { error: null, sent: true }
}
