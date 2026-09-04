"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { FormError } from "@/components/ui/form-error"
import { createWorkspaceAction } from "@/lib/workspaces/actions"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Creating…" : "Create workspace"}
    </Button>
  )
}

export function CreateWorkspaceForm() {
  const [state, formAction] = useActionState(createWorkspaceAction, { error: null })

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />
      <Field
        label="Workspace name"
        name="name"
        type="text"
        required
        maxLength={80}
        autoFocus
        placeholder="Northbound Type"
      />
      <Submit />
    </form>
  )
}
