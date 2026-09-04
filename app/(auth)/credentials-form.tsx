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

export function CredentialsForm({
  action,
  submitLabel,
  passwordHint,
  passwordAutoComplete,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>
  submitLabel: string
  passwordHint?: string
  passwordAutoComplete: "current-password" | "new-password"
}) {
  const [state, formAction] = useActionState(action, { error: null })

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
      <Field
        label="Password"
        name="password"
        type="password"
        required
        autoComplete={passwordAutoComplete}
        hint={passwordHint}
      />
      <Submit label={submitLabel} />
    </form>
  )
}
