import Link from "next/link"
import { updatePasswordAction } from "@/lib/auth/actions"
import { getCurrentUser } from "@/lib/workspaces/queries"
import { NewPasswordForm } from "../new-password-form"

export const metadata = { title: "Set a new password · Fanwise" }

/**
 * Reached only through /auth/confirm, which has already spent the emailed link
 * and established a session. With no session there is nothing to authorize
 * against, so the page says so plainly instead of showing a form that cannot
 * work. The action re-checks; this is the empty state, not the guard.
 */
export default async function ResetPasswordPage() {
  const user = await getCurrentUser()

  if (!user) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-2xl font-light tracking-[-0.02em]">
          That link is no longer valid
        </h1>
        <p className="text-[14px] text-[var(--color-ink-2)]">
          Reset links expire and can only be used once. Ask for a new one and it will arrive in a
          moment.
        </p>
        <p className="text-[14px] text-[var(--color-ink-2)]">
          <Link
            href="/forgot-password"
            className="text-[var(--color-accent)] underline underline-offset-4"
          >
            Send a new reset link
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-light tracking-[-0.02em]">Set a new password</h1>
      <p className="text-[14px] text-[var(--color-ink-2)]">
        Signing in as <span className="text-[var(--color-ink)]">{user.email}</span>. Saving this
        signs out every other device.
      </p>
      <NewPasswordForm action={updatePasswordAction} />
    </div>
  )
}
