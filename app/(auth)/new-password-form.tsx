"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { FormError } from "@/components/ui/form-error"
import type { AuthState } from "@/lib/auth/actions"

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Working…" : label}
    </Button>
  )
}

export function NewPasswordForm({
  action,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>
}) {
  const [state, formAction] = useActionState(action, { error: null })

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />
      <Field
        label="New password"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        hint="At least 10 characters."
      />
      <Field
        label="Confirm new password"
        name="confirm"
        type="password"
        required
        autoComplete="new-password"
      />
      <Submit label="Set new password" />
    </form>
  )
}
