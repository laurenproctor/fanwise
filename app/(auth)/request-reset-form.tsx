"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { FormError } from "@/components/ui/form-error"
import { FormNotice } from "@/components/ui/form-notice"
import type { ResetRequestState } from "@/lib/auth/actions"

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Working…" : label}
    </Button>
  )
}

export function RequestResetForm({
  action,
}: {
  action: (state: ResetRequestState, formData: FormData) => Promise<ResetRequestState>
}) {
  const [state, formAction] = useActionState(action, { error: null, sent: false })

  // The confirmation replaces the form rather than sitting under it. Leaving a
  // filled form beside "check your email" reads as though nothing happened and
  // invites a second submit, which the provider's send limit then rejects.
  if (state.sent) {
    return (
      <div className="flex flex-col gap-5">
        <FormNotice message="If that address has an account, a reset link is on its way. The link is good for one use." />
        <p className="text-[14px] text-[var(--color-ink-2)]">
          Nothing arrived? Check spam, then try again in a few minutes.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />
      <Field
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@studio.com"
      />
      <Submit label="Send reset link" />
    </form>
  )
}
