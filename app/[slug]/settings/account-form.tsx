"use client"

import { useActionState, useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { saveAccountDetailsAction, type AccountState } from "@/lib/account/actions"
import type { AccountProfile } from "@/lib/account/profile"
import { ChangePasswordForm } from "./change-password-form"
import { UnsavedChangesGuard } from "./unsaved-changes-guard"

const EMPTY: AccountState = {
  error: null,
  fieldErrors: {},
  savedAt: null,
  emailPending: null,
  saved: null,
}

/** Cheap enough to run on every keystroke, and only ever used to gate the button. */
function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

/**
 * Account: the person, not the studio.
 *
 * Its own action and its own button. Saving Studio details cannot carry these
 * fields to the server and cannot clear them, because they are not in that form.
 *
 * The email address is the part that does not finish here. Supabase is
 * configured to confirm a change at both the old address and the new one, so a
 * save reports a change in flight rather than a change made, and the field keeps
 * showing the address that is actually on the account until it lands.
 */
export function AccountForm({
  workspaceSlug,
  profile,
}: {
  workspaceSlug: string
  profile: AccountProfile
}) {
  const action = saveAccountDetailsAction.bind(null, workspaceSlug)
  const [state, formAction, pending] = useActionState<AccountState, FormData>(action, EMPTY)

  // The saved truth: whatever the last successful save reported the account
  // holds, or the profile this page was rendered with. An address awaiting
  // confirmation is NOT in here, because it is not on the account yet.
  const saved = state.saved ?? {
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
  }

  const [draft, setDraft] = useState({
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
  })

  const statusRef = useRef<HTMLParagraphElement>(null)
  const firstId = useId()
  const lastId = useId()
  const emailId = useId()

  // A confirmation sent puts the typed address back to the one on the account,
  // so the field stops claiming a change that has not happened. Adjusted during
  // render rather than in an effect: it is a reset on new input, not a
  // synchronisation.
  const [consumedSave, setConsumedSave] = useState<number | null>(null)
  if (state.savedAt !== null && state.savedAt !== consumedSave) {
    setConsumedSave(state.savedAt)
    if (state.emailPending) setDraft((previous) => ({ ...previous, email: saved.email }))
  }

  // Focus follows the outcome rather than being dropped when the button
  // disables itself.
  useEffect(() => {
    if (state.savedAt === null) return
    statusRef.current?.focus()
  }, [state.savedAt])

  const dirty =
    draft.firstName !== saved.firstName ||
    draft.lastName !== saved.lastName ||
    draft.email !== saved.email

  const valid =
    looksLikeEmail(draft.email) && draft.firstName.length <= 60 && draft.lastName.length <= 60

  const canSave = dirty && valid && !pending

  const emailChanging = draft.email.trim().toLowerCase() !== saved.email.toLowerCase()

  return (
    <div className="flex flex-col gap-10">
      <UnsavedChangesGuard when={dirty} />

      <form action={formAction} className="flex flex-col gap-6">
        <FormError message={state.error} />

        {state.emailPending ? (
          <p
            role="status"
            className="border-l-2 border-[var(--color-warn)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
          >
            Confirm the change to {state.emailPending}. We have sent a link to that address and to{" "}
            {saved.email}, and both have to be followed before the address moves. You stay signed in
            either way.
          </p>
        ) : profile.pendingEmail ? (
          <p
            role="status"
            className="border-l-2 border-[var(--color-warn)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
          >
            A change to {profile.pendingEmail} is waiting to be confirmed. Until both addresses
            confirm it, {profile.email} is still the address you sign in with.
          </p>
        ) : null}

        <div className="grid max-w-[620px] gap-5 sm:grid-cols-2">
          <TextField
            id={firstId}
            name="firstName"
            label="First name"
            value={draft.firstName}
            error={state.fieldErrors.firstName ?? null}
            onChange={(firstName) => setDraft((d) => ({ ...d, firstName }))}
          />
          <TextField
            id={lastId}
            name="lastName"
            label="Last name"
            value={draft.lastName}
            error={state.fieldErrors.lastName ?? null}
            onChange={(lastName) => setDraft((d) => ({ ...d, lastName }))}
          />
        </div>

        <div className="max-w-[620px]">
          <TextField
            id={emailId}
            name="email"
            label="Email address"
            type="email"
            required
            autoComplete="email"
            value={draft.email}
            error={state.fieldErrors.email ?? null}
            hint={
              emailChanging
                ? "Changing this sends a confirmation link to both your current and your new address. The change lands only once both are followed."
                : "The address you sign in with."
            }
            onChange={(email) => setDraft((d) => ({ ...d, email }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={!canSave} className="max-sm:w-full">
            {pending ? "Saving…" : "Save account details"}
          </Button>
          <p
            ref={statusRef}
            role="status"
            aria-live="polite"
            tabIndex={-1}
            className="text-[14px] text-[var(--color-ink-2)] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
          >
            {pending
              ? "Saving your account details…"
              : state.savedAt !== null && !dirty
                ? "Account details saved."
                : dirty
                  ? "Unsaved changes."
                  : ""}
          </p>
        </div>
      </form>

      <ChangePasswordForm email={profile.email} />
    </div>
  )
}

function TextField({
  id,
  name,
  label,
  value,
  error,
  hint,
  onChange,
  ...props
}: {
  id: string
  name: string
  label: string
  value: string
  error: string | null
  hint?: string
  onChange: (value: string) => void
} & Omit<React.ComponentProps<"input">, "onChange" | "value" | "id" | "name">) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ")

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="label-mono">
        {label}
      </label>
      <input
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)] aria-[invalid=true]:border-[var(--color-bad)]"
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-[13px] text-[var(--color-ink-3)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="border-l-2 border-[var(--color-bad)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
