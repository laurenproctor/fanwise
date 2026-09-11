"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { FormError } from "@/components/ui/form-error"
import { FormNotice } from "@/components/ui/form-notice"
import { renameWorkspaceAction, type RenameState } from "@/lib/workspaces/actions"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "Saving…" : "Save name"}
    </Button>
  )
}

export function RenameWorkspaceForm({
  workspaceSlug,
  name,
}: {
  workspaceSlug: string
  name: string
}) {
  const action = renameWorkspaceAction.bind(null, workspaceSlug)
  const [state, formAction] = useActionState<RenameState, FormData>(action, {
    error: null,
    savedAt: null,
  })

  return (
    <form action={formAction} className="flex max-w-[520px] flex-col gap-4">
      <FormError message={state.error} />
      <FormNotice message={state.savedAt ? "Saved. The address has not changed." : null} />
      <Field
        label="Workspace name"
        name="name"
        type="text"
        required
        maxLength={80}
        defaultValue={name}
        hint="Shown in the header. The address stays the same."
      />
      <div>
        <Submit />
      </div>
    </form>
  )
}
