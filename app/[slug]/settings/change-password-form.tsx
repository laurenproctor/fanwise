"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { requestPasswordChangeAction, type PasswordChangeState } from "@/lib/account/actions"

const EMPTY: PasswordChangeState = { error: null, sent: false }

/**
 * Change password, kept apart from saving the profile.
 *
 * There is no password field here on purpose. Supabase's password update does
 * not ask for the current one, so a field on this page would hand the account to
 * anyone who found the laptop unlocked. The emailed link proves possession of
 * the inbox, and the page it lands on ends by signing every other session out.
 *
 * A separate form rather than a button inside the profile one: a nested form is
 * invalid HTML, and a second submitter inside the first would make Enter in the
 * email field ambiguous.
 */
export function ChangePasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<PasswordChangeState, FormData>(
    () => requestPasswordChangeAction(EMPTY),
    EMPTY,
  )

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-t border-[var(--color-rule-2)] pt-8"
    >
      <span className="label-mono">Password</span>
      <FormError message={state.error} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="secondary" disabled={pending} className="max-sm:w-full">
          {pending ? "Sending…" : "Change password"}
        </Button>
        <p
          role="status"
          aria-live="polite"
          className="max-w-prose text-[14px] text-[var(--color-ink-2)]"
        >
          {pending
            ? "Sending the link…"
            : state.sent
              ? `Check ${email} for a secure link to set a new password. It expires after an hour.`
              : `We will email a secure reset link to ${email}. Your password does not change until you follow it.`}
        </p>
      </div>
    </form>
  )
}
