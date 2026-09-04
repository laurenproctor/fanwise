"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { FormError } from "@/components/ui/form-error"
import { updateProductAction, type SaveState } from "@/lib/products/actions"
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS, type Product } from "@/lib/products/types"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  )
}

function Area({
  label,
  name,
  defaultValue,
  rows = 4,
  maxLength,
}: {
  label: string
  name: string
  defaultValue: string
  rows?: number
  maxLength?: number
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="label-mono">{label}</span>
      <textarea
        name={name}
        rows={rows}
        maxLength={maxLength}
        defaultValue={defaultValue}
        className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
      />
    </label>
  )
}

export function ProductForm({
  workspaceSlug,
  product,
}: {
  workspaceSlug: string
  product: Product
}) {
  const action = updateProductAction.bind(null, workspaceSlug, product.id)
  const [state, formAction] = useActionState<SaveState, FormData>(action, {
    error: null,
    savedAt: null,
  })

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />
      <Field label="Name" name="name" defaultValue={product.name} required maxLength={200} />

      <label className="flex flex-col gap-2">
        <span className="label-mono">Product type</span>
        <select
          name="productType"
          defaultValue={product.product_type}
          className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
        >
          {PRODUCT_TYPES.map((type) => (
            <option key={type} value={type}>
              {PRODUCT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <Field
        label="Canonical title"
        name="canonicalTitle"
        defaultValue={product.canonical_title ?? ""}
        maxLength={200}
      />
      <Area
        label="Canonical description"
        name="canonicalDescription"
        defaultValue={product.canonical_description ?? ""}
        rows={6}
        maxLength={8000}
      />
      <Area
        label="Short description"
        name="shortDescription"
        defaultValue={product.short_description ?? ""}
        rows={2}
        maxLength={500}
      />
      <Field
        label="Brand name"
        name="brandName"
        defaultValue={product.brand_name ?? ""}
        maxLength={120}
      />

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Base price"
          name="basePrice"
          type="number"
          step="0.01"
          min="0"
          defaultValue={product.base_price ?? ""}
        />
        <Field
          label="Currency"
          name="currency"
          defaultValue={product.currency}
          maxLength={3}
          hint="Three-letter code"
        />
      </div>

      <Field label="Version" name="version" defaultValue={product.version ?? ""} maxLength={40} />
      <Field
        label="Support URL"
        name="supportUrl"
        type="url"
        defaultValue={product.support_url ?? ""}
      />
      <Field
        label="Documentation URL"
        name="documentationUrl"
        type="url"
        defaultValue={product.documentation_url ?? ""}
      />
      <Area
        label="License summary"
        name="licenseSummary"
        defaultValue={product.license_summary ?? ""}
        rows={3}
        maxLength={2000}
      />

      <div className="flex items-center gap-4">
        <Submit />
        {state.savedAt && !state.error ? (
          <span className="label-mono text-[var(--color-ok)]" role="status">
            Saved
          </span>
        ) : null}
      </div>
    </form>
  )
}
