"use client"

import { useActionState, useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { saveStudioDetailsAction, type StudioDetailsState } from "@/lib/workspaces/actions"
import { ICON_MIME_TYPES, MAX_ICON_BYTES } from "@/lib/workspaces/icons"
import { UnsavedChangesGuard } from "./unsaved-changes-guard"
import { WorkspaceIcon } from "./workspace-icon"

const EMPTY: StudioDetailsState = { error: null, fieldErrors: {}, savedAt: null, saved: null }

const ACCEPT = ICON_MIME_TYPES.join(",")

/** A staged pick: the file to send, and the object URL previewing it. */
interface Pick {
  file: File
  url: string
}

/**
 * Studio details: the icon, the name, and the address it lives at.
 *
 * One button saves this section and only this section. Account is a separate
 * form with a separate action, so neither can carry the other's half-typed
 * changes to the server, and neither one's error or spinner appears next to the
 * other's fields.
 *
 * The icon is staged, not uploaded on pick. The preview is a local object URL;
 * nothing reaches storage until the button is pressed, so a creator who changes
 * their mind by navigating away has changed nothing.
 *
 * There is no effect here copying a saved value into state. The baseline comes
 * back from the action (`state.saved`), so a save that lands moves it, the
 * fields already equal it, and the button turns itself off. The one adjustment
 * that cannot be derived — dropping a staged file once it has been uploaded — is
 * made during render, which is React's own answer to "reset state when a prop
 * changes" and does not cost the cascading render an effect would.
 */
export function StudioDetailsForm({
  workspaceSlug,
  appOrigin,
  name,
  iconUrl,
  hasIcon,
}: {
  workspaceSlug: string
  appOrigin: string
  name: string
  iconUrl: string | null
  hasIcon: boolean
}) {
  const action = saveStudioDetailsAction.bind(null, workspaceSlug)
  const [state, formAction, pending] = useActionState<StudioDetailsState, FormData>(action, EMPTY)

  // The saved truth: whatever the last successful save reported, or the props
  // this page was rendered with.
  const savedName = state.saved?.name ?? name
  const savedHasIcon = state.saved?.hasIcon ?? hasIcon

  const [draftName, setDraftName] = useState(name)
  const [pick, setPick] = useState<Pick | null>(null)
  const [removeIcon, setRemoveIcon] = useState(false)
  // Checked in the browser before the bytes are sent. The server checks again
  // from the magic numbers; this one only saves a doomed round trip.
  const [localIconError, setLocalIconError] = useState<string | null>(null)

  const fileRefValue = useRef<HTMLInputElement>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const nameId = useId()
  const nameErrorId = `${nameId}-error`
  const iconId = useId()
  const iconHintId = `${iconId}-hint`
  const iconErrorId = `${iconId}-error`
  const iconGroupId = `${iconId}-group`

  // Clear the staging once a save has consumed it. Conditional setState during
  // render, which React re-runs immediately without committing the interim UI.
  //
  // The file input is not reset here. A ref may not be touched during render,
  // and it does not need to be: `key` is the React way to clear an uncontrolled
  // input, and keying it on the save that consumed the pick remounts it empty.
  const [consumedSave, setConsumedSave] = useState<number | null>(null)
  if (state.savedAt !== null && state.savedAt !== consumedSave) {
    setConsumedSave(state.savedAt)
    if (pick) URL.revokeObjectURL(pick.url)
    setPick(null)
    setRemoveIcon(false)
    setLocalIconError(null)
  }

  // Focus follows the outcome rather than being dropped on the floor when the
  // button disables itself. The confirmation is focusable for exactly this.
  useEffect(() => {
    if (state.savedAt === null) return
    statusRef.current?.focus()
  }, [state.savedAt])

  // The last object URL outlives its own render and has to be released when the
  // component goes, which is the one thing only an effect can do.
  useEffect(() => {
    return () => {
      if (pick) URL.revokeObjectURL(pick.url)
    }
  }, [pick])

  function onPick(file: File | null) {
    if (pick) URL.revokeObjectURL(pick.url)

    if (!file) {
      setPick(null)
      setLocalIconError(null)
      return
    }
    if (!(ICON_MIME_TYPES as readonly string[]).includes(file.type)) {
      reject("That file is not a PNG, JPG or WebP image.")
      return
    }
    if (file.size > MAX_ICON_BYTES) {
      reject("That image is over 2 MB. Choose a smaller one.")
      return
    }

    setLocalIconError(null)
    setRemoveIcon(false)
    setPick({ file, url: URL.createObjectURL(file) })
  }

  function reject(message: string) {
    setLocalIconError(message)
    setPick(null)
    if (fileRefValue.current) fileRefValue.current.value = ""
  }

  const nameError = state.fieldErrors.name ?? null
  const iconError = localIconError ?? state.fieldErrors.icon ?? null

  const trimmed = draftName.trim()
  const nameValid = trimmed.length > 0 && trimmed.length <= 80
  const iconChanged = pick !== null || removeIcon
  const dirty = draftName !== savedName || iconChanged
  // Disabled until something valid has changed. `pending` is the duplicate
  // submission guard: the button cannot be pressed twice into one action.
  const canSave = dirty && nameValid && !localIconError && !pending

  const showingIcon = pick?.url ?? (removeIcon ? null : iconUrl)
  const previewName = trimmed || savedName

  return (
    <>
      <UnsavedChangesGuard when={dirty} />
      <form action={formAction} className="flex flex-col gap-9">
        <FormError message={state.error} />

        {/* Icon ------------------------------------------------------------ */}
        {/*
          A named group rather than a label on the input. The input's own label
          is the visible "Upload icon" pill, and an aria-label saying something
          else would leave the control's accessible name disagreeing with the
          words on it. The group carries "Workspace icon" instead, so the icon,
          its buttons and its rules are announced as one thing.
        */}
        <div role="group" aria-labelledby={iconGroupId} className="flex flex-col gap-3">
          <span className="label-mono" id={iconGroupId}>
            Workspace icon
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <WorkspaceIcon name={previewName} url={showingIcon} size={56} />
            <div className="flex flex-wrap items-center gap-3">
              {/*
                A real file input, visually hidden but still focusable, with a
                label styled as the pill. That keeps the control keyboard
                reachable and the click forwarding native, rather than a button
                poking at a hidden input through a ref.
              */}
              <input
                key={consumedSave ?? "first"}
                ref={fileRefValue}
                id={iconId}
                type="file"
                name="icon"
                accept={ACCEPT}
                className="peer sr-only"
                aria-describedby={`${iconHintId}${iconError ? ` ${iconErrorId}` : ""}`}
                onChange={(event) => onPick(event.target.files?.[0] ?? null)}
              />
              <label
                htmlFor={iconId}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-[22px] py-[12px] text-[15px] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-[var(--color-accent)]"
              >
                {pick ? "Choose another" : "Upload icon"}
              </label>

              {showingIcon ? (
                <button
                  type="button"
                  onClick={() => {
                    // Dropping a staged pick returns to whatever is stored,
                    // which may be nothing. Only a stored icon needs removing.
                    const stagedOnly = pick !== null
                    if (pick) URL.revokeObjectURL(pick.url)
                    setPick(null)
                    setLocalIconError(null)
                    if (fileRefValue.current) fileRefValue.current.value = ""
                    setRemoveIcon(savedHasIcon && !stagedOnly)
                  }}
                  className="min-h-11 rounded-[6px] text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>

          <input type="hidden" name="removeIcon" value={removeIcon ? "true" : "false"} />

          <p id={iconHintId} className="text-[13px] text-[var(--color-ink-3)]">
            PNG, JPG or WebP. Maximum 2 MB.
            {pick ? ` ${pick.file.name} is ready to save.` : ""}
            {removeIcon ? " The icon will be removed when you save." : ""}
          </p>
          {iconError ? (
            <p
              id={iconErrorId}
              role="alert"
              className="border-l-2 border-[var(--color-bad)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
            >
              {iconError}
            </p>
          ) : null}
        </div>

        {/* Name ------------------------------------------------------------ */}
        <div className="flex max-w-[560px] flex-col gap-2">
          <label htmlFor={nameId} className="label-mono">
            Workspace name
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            required
            maxLength={80}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? nameErrorId : undefined}
            className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)] aria-[invalid=true]:border-[var(--color-bad)]"
          />
          {nameError ? (
            <p
              id={nameErrorId}
              role="alert"
              className="border-l-2 border-[var(--color-bad)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
            >
              {nameError}
            </p>
          ) : null}
        </div>

        {/* Address --------------------------------------------------------- */}
        <StudioAddress workspaceSlug={workspaceSlug} appOrigin={appOrigin} />

        {/* Save ------------------------------------------------------------ */}
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={!canSave} className="max-sm:w-full">
            {pending ? "Saving…" : "Save studio details"}
          </Button>
          {/*
            One live region for the section, always present so the announcement
            is a change of content rather than a node appearing. tabIndex -1 so
            focus can land here when the button disables itself after a save.
          */}
          <p
            ref={statusRef}
            role="status"
            aria-live="polite"
            tabIndex={-1}
            className="text-[14px] text-[var(--color-ink-2)] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
          >
            {pending
              ? "Saving your studio details…"
              : state.savedAt !== null && !dirty
                ? "Studio details saved."
                : dirty
                  ? "Unsaved changes."
                  : ""}
          </p>
        </div>
      </form>
    </>
  )
}

/**
 * The address, shown and copyable but not editable.
 *
 * The slug is the workspace's address. Nothing in Fanwise rewrites an old one to
 * a new one, so moving it would break every link a creator has already shared or
 * bookmarked, silently, with no way back. Changing an address is a feature with
 * a redirect table behind it, not a text field, and the honest version of this
 * control until then is one that says what the address is and why it is fixed.
 *
 * The origin comes from the server's configured app URL rather than from
 * window.location, so the first paint is right and there is nothing to hydrate.
 */
function StudioAddress({ workspaceSlug, appOrigin }: { workspaceSlug: string; appOrigin: string }) {
  const [copied, setCopied] = useState(false)
  const hintId = useId()
  const labelId = useId()

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  const href = `${appOrigin}/${workspaceSlug}`
  // Shown without the scheme, the way the mockup shows it, but copied whole so
  // what lands on the clipboard is a link that works when pasted.
  const display = `${appOrigin.replace(/^https?:\/\//, "")}/${workspaceSlug}`

  return (
    <div className="flex max-w-[560px] flex-col gap-2">
      <span className="label-mono" id={labelId}>
        Address
      </span>
      <div className="flex items-stretch overflow-hidden rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-paper-2)]">
        <output
          aria-labelledby={labelId}
          aria-describedby={hintId}
          className="min-w-0 flex-1 truncate px-3 py-2.5 font-mono text-[13px] text-[var(--color-ink-2)]"
        >
          {display}
        </output>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(href).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }}
          className="shrink-0 border-l border-[var(--color-rule)] px-4 text-[14px] text-[var(--color-ink)] hover:bg-[var(--color-rule-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p id={hintId} className="text-[13px] text-[var(--color-ink-3)]">
        The address stays the same when the workspace name changes. It cannot be changed yet:
        Fanwise does not forward an old address to a new one, so moving it would break links you
        have already shared.
      </p>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Address copied to the clipboard." : ""}
      </span>
    </div>
  )
}
