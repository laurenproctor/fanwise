"use client"

import { useActionState, useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { savePublicProfileAction } from "@/lib/public/actions"
import { EMPTY_PROFILE_STATE, type PublicProfileState } from "@/lib/public/form-state"
import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from "@/lib/public/avatars"
import { HANDLE_LIMITS, canonicalHandle, checkHandle } from "@/lib/public/handles"
import { UnsavedChangesGuard } from "../unsaved-changes-guard"
import { WorkspaceIcon } from "../workspace-icon"

/**
 * The public identity: picture, name, handle, bio, links and search text.
 *
 * The shape follows `StudioDetailsForm` closely and on purpose — a creator
 * moving between the two settings pages should not have to learn a second set
 * of behaviours. Staged file pick, one button per section, baseline carried
 * back from the action rather than kept in a second state hook, and the save
 * button disabled until something valid has actually changed.
 *
 * The handle is the one field with its own live check. It is the only value
 * here that can be refused by somebody else's data, and the only one where a
 * creator can produce something the database will not accept without any hint
 * that it is coming. `checkHandle` is the same function the server action and
 * the Zod schema use, so what this says while typing is what the save will
 * decide — the field cannot validate green and then be rejected for shape.
 *
 * What it deliberately does *not* do is ask the server whether the handle is
 * taken while the creator types. That would be an endpoint answering "does
 * this handle exist" to anyone who asks, a few hundred times a minute, which
 * is a handle-enumeration API with a debounce on it. Availability is decided
 * once, by the unique index, when the form is submitted.
 */

const ACCEPT = AVATAR_MIME_TYPES.join(",")

interface Pick {
  file: File
  url: string
}

export interface ProfileFields {
  handle: string
  displayName: string
  shortBio: string
  location: string
  websiteUrl: string
  instagramUrl: string
  contactUrl: string
  seoTitle: string
  seoDescription: string
}

export function PublicProfileForm({
  workspaceSlug,
  appOrigin,
  profile,
  avatarUrl,
  hasAvatar,
}: {
  workspaceSlug: string
  appOrigin: string
  profile: ProfileFields
  avatarUrl: string | null
  hasAvatar: boolean
}) {
  const action = savePublicProfileAction.bind(null, workspaceSlug)
  const [state, formAction, pending] = useActionState<PublicProfileState, FormData>(
    action,
    EMPTY_PROFILE_STATE,
  )

  const savedHandle = state.saved?.handle ?? profile.handle
  const savedHasAvatar = state.saved?.hasAvatar ?? hasAvatar

  const [fields, setFields] = useState<ProfileFields>({ ...profile, handle: savedHandle })
  const [pick, setPick] = useState<Pick | null>(null)
  const [removeAvatar, setRemoveAvatar] = useState(false)
  const [localAvatarError, setLocalAvatarError] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)

  const ids = {
    handle: useId(),
    displayName: useId(),
    shortBio: useId(),
    location: useId(),
    websiteUrl: useId(),
    instagramUrl: useId(),
    contactUrl: useId(),
    seoTitle: useId(),
    seoDescription: useId(),
    avatar: useId(),
  }

  // Clear the staging once a save has consumed it. Conditional setState during
  // render, which React re-runs immediately without committing the interim UI.
  const [consumedSave, setConsumedSave] = useState<number | null>(null)
  if (state.savedAt !== null && state.savedAt !== consumedSave) {
    setConsumedSave(state.savedAt)
    if (pick) URL.revokeObjectURL(pick.url)
    setPick(null)
    setRemoveAvatar(false)
    setLocalAvatarError(null)
  }

  useEffect(() => {
    if (state.savedAt === null) return
    statusRef.current?.focus()
  }, [state.savedAt])

  useEffect(() => {
    return () => {
      if (pick) URL.revokeObjectURL(pick.url)
    }
  }, [pick])

  function set<K extends keyof ProfileFields>(key: K, value: string) {
    setFields((current) => ({ ...current, [key]: value }))
  }

  function onPick(file: File | null) {
    if (pick) URL.revokeObjectURL(pick.url)

    if (!file) {
      setPick(null)
      setLocalAvatarError(null)
      return
    }
    if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
      reject("That file is not a PNG, JPG or WebP image.")
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      reject("That image is over 5 MB. Choose a smaller one.")
      return
    }

    setLocalAvatarError(null)
    setRemoveAvatar(false)
    setPick({ file, url: URL.createObjectURL(file) })
  }

  function reject(message: string) {
    setLocalAvatarError(message)
    setPick(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  // The live handle check. Silent while the field is untouched and unchanged,
  // because telling somebody their existing handle is fine is noise.
  const handleChanged = canonicalHandle(fields.handle) !== savedHandle.toLowerCase()
  const handleCheck = checkHandle(fields.handle)
  const localHandleError = handleChanged && !handleCheck.ok ? handleCheck.message : null

  const handleError = localHandleError ?? state.fieldErrors.handle ?? null
  const avatarError = localAvatarError ?? state.fieldErrors.avatar ?? null

  const displayNameValid =
    fields.displayName.trim().length > 0 && fields.displayName.trim().length <= 80

  const avatarChanged = pick !== null || removeAvatar
  const dirty =
    avatarChanged ||
    (Object.keys(fields) as Array<keyof ProfileFields>).some((key) =>
      key === "handle"
        ? canonicalHandle(fields.handle) !== savedHandle.toLowerCase()
        : fields[key] !== profile[key],
    )

  const canSave = dirty && displayNameValid && handleCheck.ok && !localAvatarError && !pending

  const showingAvatar = pick?.url ?? (removeAvatar ? null : avatarUrl)
  const previewName = fields.displayName.trim() || savedHandle
  const origin = appOrigin.replace(/^https?:\/\//, "")

  return (
    <>
      <UnsavedChangesGuard when={dirty} />
      <form action={formAction} className="flex flex-col gap-9">
        <FormError message={state.error} />

        {/* Picture ---------------------------------------------------------- */}
        <div role="group" aria-labelledby={`${ids.avatar}-group`} className="flex flex-col gap-3">
          <span className="label-mono" id={`${ids.avatar}-group`}>
            Profile picture
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <WorkspaceIcon name={previewName} url={showingAvatar} size={64} />
            <div className="flex flex-wrap items-center gap-3">
              <input
                key={consumedSave ?? "first"}
                ref={fileRef}
                id={ids.avatar}
                type="file"
                name="avatar"
                accept={ACCEPT}
                className="peer sr-only"
                aria-describedby={`${ids.avatar}-hint${avatarError ? ` ${ids.avatar}-error` : ""}`}
                onChange={(event) => onPick(event.target.files?.[0] ?? null)}
              />
              <label
                htmlFor={ids.avatar}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-[22px] py-[12px] text-[15px] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-[var(--color-accent)]"
              >
                {pick ? "Choose another" : "Upload picture"}
              </label>
              {showingAvatar ? (
                <button
                  type="button"
                  onClick={() => {
                    const stagedOnly = pick !== null
                    if (pick) URL.revokeObjectURL(pick.url)
                    setPick(null)
                    setLocalAvatarError(null)
                    if (fileRef.current) fileRef.current.value = ""
                    setRemoveAvatar(savedHasAvatar && !stagedOnly)
                  }}
                  className="min-h-11 rounded-[6px] text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>

          <input type="hidden" name="removeAvatar" value={removeAvatar ? "true" : "false"} />

          <p id={`${ids.avatar}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
            PNG, JPG or WebP. Maximum 5 MB. Square images look best.
            {pick ? ` ${pick.file.name} is ready to save.` : ""}
            {removeAvatar ? " The picture will be removed when you save." : ""}
          </p>
          <FieldError id={`${ids.avatar}-error`} message={avatarError} />
        </div>

        {/* Name ------------------------------------------------------------- */}
        <TextField
          id={ids.displayName}
          name="displayName"
          label="Display name"
          required
          maxLength={80}
          value={fields.displayName}
          onChange={(value) => set("displayName", value)}
          error={state.fieldErrors.displayName ?? null}
          hint="The name at the top of your profile. It does not have to match your workspace name."
        />

        {/* Handle ----------------------------------------------------------- */}
        <div className="flex max-w-[560px] flex-col gap-2">
          <label htmlFor={ids.handle} className="label-mono">
            Handle
          </label>
          <div
            className={`flex items-stretch overflow-hidden rounded-[10px] border bg-[var(--color-card)] focus-within:border-[var(--color-accent)] ${
              handleError ? "border-[var(--color-bad)]" : "border-[var(--color-rule)]"
            }`}
          >
            {/*
              The origin is rendered as a static prefix inside the control, so
              the field shows the whole address while the input holds only the
              part that is editable. Nothing has to be parsed back out.
            */}
            <span
              aria-hidden
              className="shrink-0 border-r border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-2.5 font-mono text-[13px] text-[var(--color-ink-3)]"
            >
              {origin}/@
            </span>
            <input
              id={ids.handle}
              name="handle"
              type="text"
              required
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              minLength={HANDLE_LIMITS.min}
              maxLength={HANDLE_LIMITS.max}
              value={fields.handle}
              onChange={(event) => set("handle", event.target.value)}
              aria-invalid={handleError ? true : undefined}
              aria-describedby={`${ids.handle}-hint${handleError ? ` ${ids.handle}-error` : ""}`}
              className="min-w-0 flex-1 px-3 py-2.5 font-mono text-[14px] text-[var(--color-ink)] outline-none"
            />
          </div>
          <p id={`${ids.handle}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
            Lowercase letters, numbers and hyphens, {HANDLE_LIMITS.min} to {HANDLE_LIMITS.max}{" "}
            characters. Changing it keeps the old address working as a redirect.
          </p>
          <FieldError id={`${ids.handle}-error`} message={handleError} />
        </div>

        {/* Bio and location -------------------------------------------------- */}
        <div className="flex max-w-[560px] flex-col gap-2">
          <label htmlFor={ids.shortBio} className="label-mono">
            Short bio
          </label>
          <textarea
            id={ids.shortBio}
            name="shortBio"
            rows={3}
            maxLength={280}
            value={fields.shortBio}
            onChange={(event) => set("shortBio", event.target.value)}
            aria-describedby={`${ids.shortBio}-hint`}
            className="w-full resize-y rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          />
          <p id={`${ids.shortBio}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
            One or two lines under your name.{" "}
            <span className="tabular">{280 - fields.shortBio.length}</span> characters left.
          </p>
          <FieldError id={`${ids.shortBio}-error`} message={state.fieldErrors.shortBio ?? null} />
        </div>

        <TextField
          id={ids.location}
          name="location"
          label="Location"
          maxLength={80}
          value={fields.location}
          onChange={(value) => set("location", value)}
          error={state.fieldErrors.location ?? null}
          placeholder="Brooklyn, New York"
          hint="Optional. Shown as plain text; it is never used to locate you."
        />

        {/* Links -------------------------------------------------------------- */}
        <TextField
          id={ids.websiteUrl}
          name="websiteUrl"
          label="Website"
          type="url"
          value={fields.websiteUrl}
          onChange={(value) => set("websiteUrl", value)}
          error={state.fieldErrors.websiteUrl ?? null}
          placeholder="https://example.com"
          hint="Optional. Must start with https://."
        />

        <TextField
          id={ids.instagramUrl}
          name="instagramUrl"
          label="Instagram"
          type="url"
          value={fields.instagramUrl}
          onChange={(value) => set("instagramUrl", value)}
          error={state.fieldErrors.instagramUrl ?? null}
          placeholder="https://instagram.com/yourstudio"
          hint="Optional."
        />

        <TextField
          id={ids.contactUrl}
          name="contactUrl"
          label="Contact"
          value={fields.contactUrl}
          onChange={(value) => set("contactUrl", value)}
          error={state.fieldErrors.contactUrl ?? null}
          placeholder="mailto:hello@example.com"
          hint="Optional. A contact page or an email address. Shown as a Contact button, and as the fallback on a product with no live channel."
        />

        {/* Search ------------------------------------------------------------- */}
        <fieldset className="flex max-w-[560px] flex-col gap-5 border-t border-[var(--color-rule)] pt-7">
          <legend className="sr-only">Search appearance</legend>
          <p className="text-[14px] text-[var(--color-ink-2)]">
            <span className="label-mono block pb-1">Search appearance</span>
            Optional. Left empty, Fanwise uses your display name and bio.
          </p>

          <TextField
            id={ids.seoTitle}
            name="seoTitle"
            label="Search title"
            maxLength={70}
            value={fields.seoTitle}
            onChange={(value) => set("seoTitle", value)}
            error={state.fieldErrors.seoTitle ?? null}
            hint="Cut off past 70 characters in most results."
          />

          <TextField
            id={ids.seoDescription}
            name="seoDescription"
            label="Search description"
            maxLength={200}
            value={fields.seoDescription}
            onChange={(value) => set("seoDescription", value)}
            error={state.fieldErrors.seoDescription ?? null}
            hint="Cut off past 200 characters in most results."
          />
        </fieldset>

        {/* Save ---------------------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={!canSave} className="max-sm:w-full">
            {pending ? "Saving…" : "Save public profile"}
          </Button>
          <p
            ref={statusRef}
            role="status"
            aria-live="polite"
            tabIndex={-1}
            className="text-[14px] text-[var(--color-ink-2)] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
          >
            {pending
              ? "Saving your public profile…"
              : state.savedAt !== null && !dirty
                ? "Public profile saved."
                : dirty
                  ? "Unsaved changes."
                  : ""}
          </p>
        </div>
      </form>
    </>
  )
}

function TextField({
  id,
  name,
  label,
  value,
  onChange,
  error,
  hint,
  ...rest
}: {
  id: string
  name: string
  label: string
  value: string
  onChange: (value: string) => void
  error: string | null
  hint?: string
} & Omit<React.ComponentProps<"input">, "id" | "name" | "value" | "onChange">) {
  return (
    <div className="flex max-w-[560px] flex-col gap-2">
      <label htmlFor={id} className="label-mono">
        {label}
      </label>
      <input
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          `${hint ? `${id}-hint` : ""}${error ? ` ${id}-error` : ""}`.trim() || undefined
        }
        className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)] aria-[invalid=true]:border-[var(--color-bad)]"
        {...rest}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null
  return (
    <p
      id={id}
      role="alert"
      className="border-l-2 border-[var(--color-bad)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
    >
      {message}
    </p>
  )
}
