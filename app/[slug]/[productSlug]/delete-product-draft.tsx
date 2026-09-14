"use client"

import { useActionState, useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { FIELD_INPUT_CLASS } from "@/components/ui/field"
import { deleteProductDraftAction, type ActionState } from "@/lib/products/actions"
import {
  DELETE_CONFIRMATION_WORD,
  canConfirmDraftDeletion,
  draftDeletionBlockedMessage,
  type DraftDeletionEligibility,
} from "@/lib/products/draft-deletion"

/**
 * Delete draft, at the very bottom of the product page.
 *
 * Not in the product form, where an autosave and a deletion would share one
 * submit path; not beside Save or the publishing actions, where it would be
 * one slip from the thing a creator meant to press; and not in the catalog,
 * where a row is too small a target for something that cannot be undone.
 *
 * What the page is handed decides what renders, and the database decided that
 * (`product_draft_deletion_blocker()`): a product that may go gets the control,
 * a product that may not gets one sentence saying why and no button, and a
 * caller who does not own it gets nothing at all — the page does not render
 * this component for `hidden`. None of that is the authorization. The action
 * asks the database again, under lock.
 *
 * The confirmation is a native <dialog>, following the profile's Publish all:
 * labelled and described by its own heading and copy, Escape closes it while
 * nothing is in flight, and focus goes back to the button that opened it. While
 * the deletion runs, Escape is refused, both buttons are disabled and the form
 * will not submit again, so one press is one request.
 */
export function DeleteProductDraft({
  workspaceSlug,
  productId,
  productName,
  eligibility,
}: {
  workspaceSlug: string
  productId: string
  productName: string
  eligibility: Exclude<DraftDeletionEligibility, { kind: "hidden" }>
}) {
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className="flex max-w-[640px] flex-col items-start gap-4 rounded-[14px] border border-[var(--color-rule)] px-5 py-5"
    >
      <h2 id={headingId} className="label-mono">
        Danger zone
      </h2>
      {eligibility.kind === "eligible" ? (
        <>
          <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
            Permanently delete this draft and everything uploaded to it. This cannot be undone.
          </p>
          <DeleteDraftControl
            workspaceSlug={workspaceSlug}
            productId={productId}
            productName={productName}
          />
        </>
      ) : (
        <p className="max-w-prose text-[14px] text-[var(--color-ink-2)]">
          {draftDeletionBlockedMessage(eligibility.blocker, "product")}
        </p>
      )}
    </section>
  )
}

function DeleteDraftControl({
  workspaceSlug,
  productId,
  productName,
}: {
  workspaceSlug: string
  productId: string
  productName: string
}) {
  const action = deleteProductDraftAction.bind(null, workspaceSlug, productId)
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {
    error: null,
  })

  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const descriptionId = useId()
  const confirmationId = useId()
  const [typed, setTyped] = useState("")
  /*
    `pending` arrives with the next render. A second submit inside the same
    frame — Enter pressed twice, a double click — would read the old value, so
    the first submit is also remembered here, synchronously, until the action
    settles.
  */
  const submitting = useRef(false)
  useEffect(() => {
    if (!pending) submitting.current = false
  }, [pending])

  const canConfirm = canConfirmDraftDeletion(typed, pending)

  function openDialog() {
    setTyped("")
    dialogRef.current?.showModal()
  }

  function closeDialog() {
    if (pending) return
    // `onClose` returns focus, so Cancel and Escape take the same path back.
    dialogRef.current?.close()
  }

  return (
    <>
      <Button ref={triggerRef} type="button" variant="secondary" onClick={openDialog}>
        Delete draft
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        onCancel={(event) => {
          if (pending) event.preventDefault()
        }}
        onClose={() => triggerRef.current?.focus()}
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] p-0 text-[var(--color-ink)] backdrop:bg-black/40"
      >
        <form
          action={formAction}
          onSubmit={(event) => {
            // The disabled button already says no; Enter in the field does not
            // ask the button, so the same rule is applied here.
            if (submitting.current || !canConfirm) {
              event.preventDefault()
              return
            }
            submitting.current = true
          }}
          className="flex flex-col gap-5 p-6"
        >
          <h2
            id={headingId}
            className="font-display text-[26px] leading-[1.15] font-light tracking-[-0.02em] text-balance"
          >
            Delete &ldquo;{productName}&rdquo;?
          </h2>
          <p id={descriptionId} className="text-[15px] text-[var(--color-ink-2)]">
            This permanently removes its product details, uploaded files, images, and unpublished
            channel drafts from Fanwise. Nothing has been published, so no marketplace listing will
            be affected.
          </p>

          <div className="flex flex-col gap-2">
            <label htmlFor={confirmationId} className="label-mono">
              Type {DELETE_CONFIRMATION_WORD} to confirm
            </label>
            <input
              id={confirmationId}
              name="confirmation"
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              // Read-only rather than disabled while pending: a disabled field
              // is left out of the form data.
              readOnly={pending}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={FIELD_INPUT_CLASS}
            />
          </div>

          <FormError message={state.error} />

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={closeDialog} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={!canConfirm}>
              {pending ? "Deleting…" : "Delete draft"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
