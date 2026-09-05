"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { FormError } from "@/components/ui/form-error"
import { updateProductAction, type SaveState } from "@/lib/products/actions"
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS, type Product } from "@/lib/products/types"
import { SaveStatusIndicator, type SaveStatus } from "@/components/ui/save-status"

/**
 * How long typing has to stop before the form saves itself.
 *
 * Long enough that ordinary typing does not write a row per keystroke, short
 * enough that looking away and looking back finds the work saved. Every edit
 * restarts it, so a paragraph typed without pause is one save at the end.
 */
const AUTOSAVE_IDLE_MS = 1200

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
  const [state, formAction, isPending] = useActionState<SaveState, FormData>(action, {
    error: null,
    savedAt: null,
  })

  const formRef = useRef<HTMLFormElement>(null)
  const [dirty, setDirty] = useState(false)

  /*
   * Autosave by asking the form to submit itself, rather than by assembling a
   * FormData by hand. The action, its validation and its error handling are
   * the same ones the button uses, so there is one save path and not two that
   * can disagree. requestSubmit also runs native validation, which a direct
   * call to the action would skip.
   */
  useEffect(() => {
    if (!dirty || isPending) return
    const timer = setTimeout(() => formRef.current?.requestSubmit(), AUTOSAVE_IDLE_MS)
    return () => clearTimeout(timer)
  }, [dirty, isPending])

  /*
   * The last line of defence, not the first. Autosave should mean this never
   * fires; it exists for the case where the tab is closed inside the idle
   * window, or while a save is failing.
   */
  useEffect(() => {
    if (!dirty && !state.error) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, state.error])

  const status: SaveStatus = state.error
    ? "error"
    : isPending
      ? "saving"
      : dirty
        ? "dirty"
        : state.savedAt
          ? "saved"
          : "clean"

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="label-mono">The canonical record</h2>
        {/* Top right, on the heading line, where it is visible without
            scrolling to the end of a long form. */}
        <SaveStatusIndicator status={status} savedAt={state.savedAt} />
      </div>
      <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
        This is the source of truth. Channels receive a translation of it; nothing here is shaped by
        any one marketplace. Changes save themselves.
      </p>

      <form
        ref={formRef}
        action={formAction}
        onInput={() => setDirty(true)}
        onChange={() => setDirty(true)}
        // A save in flight covers everything typed up to this point. Typing
        // during the save sets it again through onInput.
        onSubmit={() => setDirty(false)}
        className="flex flex-col gap-5"
      >
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

        {/*
          Kept, though autosave means it is rarely the thing that saves. It is
          the answer to "did that go through?", it is how a keyboard user
          commits without waiting out the timer, and it is the retry when a
          save has failed. Disabled once there is nothing outstanding, so it
          never invites a pointless write.
        */}
        <div className="flex items-center gap-4">
          <Button type="submit" disabled={isPending || (!dirty && !state.error)}>
            {isPending ? "Saving…" : state.error ? "Try again" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  )
}
