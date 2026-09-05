import Link from "next/link"
import { requestPasswordResetAction } from "@/lib/auth/actions"
import { FormError } from "@/components/ui/form-error"
import { RequestResetForm } from "../request-reset-form"

export const metadata = { title: "Reset your password · Fanwise" }

/**
 * Not redirected away from when a session exists. A person who arrives here
 * signed in on one device is usually here because they have lost the password
 * somewhere else, and bouncing them to the workspace answers a question they
 * did not ask.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-light tracking-[-0.02em]">Reset your password</h1>
      <FormError
        message={
          error === "link"
            ? "That reset link has expired or was already used. Ask for a new one."
            : null
        }
      />
      <p className="text-[14px] text-[var(--color-ink-2)]">
        Enter the address you signed up with and we will send a link to set a new password.
      </p>
      <RequestResetForm action={requestPasswordResetAction} />
      <p className="text-[14px] text-[var(--color-ink-2)]">
        Remembered it?{" "}
        <Link href="/sign-in" className="text-[var(--color-accent)] underline underline-offset-4">
          Sign in
        </Link>
        .
      </p>
    </div>
  )
}
