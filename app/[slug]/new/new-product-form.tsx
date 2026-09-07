"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { RequiredMark } from "@/components/ui/required-mark"
import { FormError } from "@/components/ui/form-error"
import { createProductAction, type ActionState } from "@/lib/products/actions"
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS } from "@/lib/products/types"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Creating…" : "Create product"}
    </Button>
  )
}

export function NewProductForm({ workspaceSlug }: { workspaceSlug: string }) {
  const action = createProductAction.bind(null, workspaceSlug)
  const [state, formAction] = useActionState<ActionState, FormData>(action, { error: null })

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />
      <Field
        label="Product name"
        name="name"
        type="text"
        required
        maxLength={200}
        autoFocus
        placeholder="Aster Grotesk"
      />
      <label className="flex flex-col gap-2">
        <span className="label-mono">
          Product type
          <RequiredMark />
        </span>
        <select
          name="productType"
          required
          defaultValue="font"
          className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
        >
          {PRODUCT_TYPES.map((type) => (
            <option key={type} value={type}>
              {PRODUCT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <Submit />
    </form>
  )
}
