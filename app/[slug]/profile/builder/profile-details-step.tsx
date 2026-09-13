"use client"

import { useRouter } from "next/navigation"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { FIELD_INPUT_CLASS } from "@/components/ui/field"
import {
  continueProfileDetailsAction,
  saveProfileDraftAction,
  uploadProfileDraftAvatarAction,
} from "@/lib/public/draft-actions"
import {
  createDraftAutosave,
  type AutosaveStatus,
  type DraftAutosave,
} from "@/lib/public/draft-autosave"
import { AVATAR_MIME_TYPES, AVATAR_RULES_SENTENCE } from "@/lib/public/avatar-rules"
import { EXAMPLE_PROFILE } from "@/lib/public/example-profile"
import {
  createHandleAvailabilityChecker,
  type AvailabilityState,
  type HandleAvailabilityChecker,
} from "@/lib/public/handle-availability"
import { HANDLE_LIMITS, normalizeHandleInput } from "@/lib/public/handles"
import {
  checkLocalImage,
  createImagePreviewManager,
  fileIdentity,
  type ImagePreviewManager,
} from "@/lib/public/image-preview"
import {
  DRAFT_LIMITS,
  type DetailsErrors,
  type ProfileDraftFields,
} from "@/lib/public/profile-draft"
import { parseContact } from "@/lib/public/profile-links"
import { presentationFromDraft } from "@/lib/public/profile-presentation"
import { routes } from "@/lib/routes"
import { UnsavedChangesGuard } from "../../settings/unsaved-changes-guard"
import { DraftStatus, ErrorGlyph, OkGlyph } from "./builder-status"
import { LinksEditor } from "./links-editor"
import { LocationFields } from "./location-fields"
import { ProfilePreview } from "./profile-preview"

/**
 * Step 1 of the builder: the creator's details, and a live preview of them.
 *
 * Three moving parts, each a plain controller from `lib/public` so its timing
 * is tested without a browser, and each wired up here once:
 *
 *   - the draft autosave, which stores what was typed a moment after typing
 *     stops and never touches the published profile;
 *   - the address check, which decides shape and reservation on the keystroke
 *     and availability after a pause, dropping any answer a newer keystroke
 *     has made stale;
 *   - the image preview, which holds exactly one object URL at a time and
 *     uploads a picture once, when it is chosen, not on every later save.
 *
 * The image has one more rule, and it is the fix for a picture that only
 * appeared after a second edit. The file field is server-rendered, so it can
 * be clicked before the page hydrates; a file chosen in that window fires its
 * change event before React is listening, and used to be lost without a word
 * while the creator carried on and published a profile with no image. On
 * mount the field is read once, and a file already sitting in it is taken as
 * if it had just been chosen. Continue is also held while an upload is in
 * flight, so the step is never submitted ahead of its image.
 *
 * The preview reads from local state, so it changes on the same render as the
 * field. Nothing it shows waits on the network.
 */

const ACCEPT = AVATAR_MIME_TYPES.join(",")

const availabilityResponse = z.object({
  status: z.enum(["available", "unavailable", "invalid", "reserved"]),
})

type ImageState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "saved"; removed: boolean }
  | { kind: "error"; message: string; retry: File | "remove" | null }

/** Fields step 3 can send the creator back to. `links` focuses the first link row. */
export type FocusField = keyof ProfileDraftFields | "image"

export function ProfileDetailsStep({
  workspaceSlug,
  origin,
  liveHandle,
  published,
  initial,
  focusField = null,
}: {
  workspaceSlug: string
  origin: string
  liveHandle: string
  published: boolean
  /** A field step 3 sent the creator back to fix; focused and shown as touched on arrival. */
  focusField?: FocusField | null
  initial: {
    fields: ProfileDraftFields
    revision: number
    avatarUrl: string | null
    stored: boolean
  }
}) {
  const router = useRouter()
  const ids: Record<FocusField, string> = {
    image: useId(),
    handle: useId(),
    displayName: useId(),
    shortBio: useId(),
    about: useId(),
    countryCode: useId(),
    city: useId(),
    location: useId(),
    links: useId(),
    contact: useId(),
  }

  const [fields, setFields] = useState<ProfileDraftFields>(initial.fields)
  const [touched, setTouched] = useState<Partial<Record<keyof ProfileDraftFields, boolean>>>(
    focusField && focusField !== "image" ? { [focusField]: true } : {},
  )
  const [serverErrors, setServerErrors] = useState<DetailsErrors>({})
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>(initial.stored ? "saved" : "idle")
  const [availability, setAvailability] = useState<AvailabilityState>({ status: "untouched" })
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial.avatarUrl)
  const [imageState, setImageState] = useState<ImageState>({ kind: "idle" })
  const [continuing, setContinuing] = useState(false)
  const [formMessage, setFormMessage] = useState<string | null>(null)
  const [showingExample, setShowingExample] = useState(false)

  const autosave = useRef<DraftAutosave<ProfileDraftFields> | null>(null)
  const checker = useRef<HandleAvailabilityChecker | null>(null)
  const previews = useRef<ImagePreviewManager | null>(null)
  const uploadedIdentity = useRef<string | null>(null)
  /** The file being uploaded now, so the same pick arriving twice sends its bytes once. */
  const uploadingIdentity = useRef<string | null>(null)
  /** Which upload is the latest. An older one finishing late must not report for a newer pick. */
  const latestUpload = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const initialHandle = useRef(initial.fields.handle)

  useEffect(() => {
    const controller = createDraftAutosave<ProfileDraftFields>({
      initialRevision: initial.revision,
      save: (value, revision) => saveProfileDraftAction(workspaceSlug, { fields: value, revision }),
      onStatus: setSaveStatus,
    })
    autosave.current = controller
    return () => controller.dispose()
    // The controller owns the revision from here on; a changed prop must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug])

  useEffect(() => {
    const controller = createHandleAvailabilityChecker({
      ownHandle: liveHandle,
      onChange: setAvailability,
      fetcher: async (handle, signal) => {
        const response = await fetch(
          routes.publicProfileHandleAvailability(workspaceSlug, handle),
          {
            signal,
            cache: "no-store",
          },
        )
        if (!response.ok) throw new Error(`availability ${response.status}`)
        const parsed = availabilityResponse.parse(await response.json())
        // Shape and reservation were decided locally; if the server disagrees
        // about them, the answer is not "available".
        return parsed.status === "available" ? "available" : "unavailable"
      },
    })
    checker.current = controller
    // A restored draft whose address is not the live one has not been checked
    // in this visit; check it now rather than showing it as untouched.
    if (normalizeHandleInput(initialHandle.current) !== liveHandle.toLowerCase()) {
      controller.update(initialHandle.current)
    }
    return () => controller.dispose()
  }, [workspaceSlug, liveHandle])

  // Arriving from step 3 with a named field: put the cursor where the fix goes.
  useEffect(() => {
    if (!focusField) return
    const element =
      focusField === "links"
        ? document.querySelector<HTMLElement>(`#${CSS.escape(ids.links)} input`)
        : document.getElementById(ids[focusField])
    element?.focus()
    element?.scrollIntoView({ block: "center" })
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const manager = createImagePreviewManager({
      create: (file) => URL.createObjectURL(file),
      revoke: (url) => URL.revokeObjectURL(url),
    })
    previews.current = manager
    // A file chosen before hydration is already in the field; take it now.
    const early = fileInput.current?.files?.[0]
    if (early) onPickImage(early)
    return () => manager.dispose()
    // Once, on mount: this is the hydration catch-up, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Not memoised: it closes over the current fields, and every change event
  // re-renders before the next one arrives, so the closure is never stale.
  function setFieldsPatch(patch: Partial<ProfileDraftFields>) {
    const next = { ...fields, ...patch }
    setFields(next)
    autosave.current?.change(next)
    setServerErrors((current) => {
      const keys = Object.keys(patch) as Array<keyof DetailsErrors>
      if (!keys.some((key) => current[key])) return current
      const cleared = { ...current }
      for (const key of keys) delete cleared[key]
      return cleared
    })
    setFormMessage(null)
    if (patch.handle !== undefined) checker.current?.update(patch.handle)
  }

  function setField<K extends keyof ProfileDraftFields>(key: K, value: ProfileDraftFields[K]) {
    setFieldsPatch({ [key]: value } as Partial<ProfileDraftFields>)
  }

  const touch = (key: keyof ProfileDraftFields) =>
    setTouched((t) => (t[key] ? t : { ...t, [key]: true }))

  // ---- Image ---------------------------------------------------------------

  async function uploadImage(file: File | "remove") {
    const identity = file === "remove" ? "remove" : fileIdentity(file)
    const attempt = (latestUpload.current += 1)
    uploadingIdentity.current = identity
    setImageState({ kind: "uploading" })
    const body = new FormData()
    if (file === "remove") body.set("remove", "true")
    else body.set("image", file)

    let result: Awaited<ReturnType<typeof uploadProfileDraftAvatarAction>>
    try {
      result = await uploadProfileDraftAvatarAction(workspaceSlug, body)
    } catch {
      result = { ok: false, message: "That image could not be saved. Try again." }
    }

    // Server actions run in order, so a newer pick's upload lands after this
    // one; its own result is the one the screen should report.
    if (attempt !== latestUpload.current) return
    uploadingIdentity.current = null
    if (result.ok) {
      uploadedIdentity.current = file === "remove" ? null : identity
      setImageState({ kind: "saved", removed: file === "remove" })
    } else {
      setImageState({ kind: "error", message: result.message, retry: file })
    }
  }

  function onPickImage(file: File | null) {
    if (!file) return
    const local = checkLocalImage(file)
    if (!local.ok) {
      setImageState({ kind: "error", message: local.message, retry: null })
      if (fileInput.current) fileInput.current.value = ""
      return
    }
    const identity = fileIdentity(file)
    setAvatarUrl(previews.current?.show(file) ?? null)
    if (uploadingIdentity.current === identity) return
    if (uploadedIdentity.current === identity) {
      setImageState({ kind: "saved", removed: false })
      return
    }
    void uploadImage(file)
  }

  function onRemoveImage() {
    previews.current?.clear()
    setAvatarUrl(null)
    if (fileInput.current) fileInput.current.value = ""
    void uploadImage("remove")
  }

  // ---- Continue ------------------------------------------------------------

  async function onContinue() {
    const saver = autosave.current
    if (!saver) return
    if (imageState.kind === "uploading") {
      setFormMessage("Your image is still uploading. Continue once it has saved.")
      return
    }
    setContinuing(true)
    setFormMessage(null)

    const stored = await saver.flush()
    if (!stored && saver.status() === "conflict") {
      setContinuing(false)
      setFormMessage("This draft was changed in another tab. Reload to see the latest version.")
      return
    }

    let result: Awaited<ReturnType<typeof continueProfileDetailsAction>>
    try {
      result = await continueProfileDetailsAction(workspaceSlug, {
        fields,
        revision: saver.revision(),
      })
    } catch {
      setContinuing(false)
      setFormMessage("Your changes could not be saved. Try again.")
      return
    }

    if (result.ok) {
      router.push(result.next)
      return
    }
    saver.adopt(result.revision)
    setServerErrors(result.errors)
    setTouched({
      handle: true,
      displayName: true,
      shortBio: true,
      about: true,
      city: true,
      countryCode: true,
      location: true,
      links: true,
      contact: true,
    })
    setFormMessage(
      result.message ??
        (Object.keys(result.errors).length > 0
          ? "A few details need attention before you continue."
          : null),
    )
    setContinuing(false)
  }

  // ---- Derived -------------------------------------------------------------

  const normalizedHandle = normalizeHandleInput(fields.handle)
  const presentation = useMemo(
    () =>
      presentationFromDraft(fields, {
        handle: normalizedHandle,
        avatarUrl,
        products: [],
      }),
    [fields, normalizedHandle, avatarUrl],
  )

  const locationErrors = {
    countryCode: serverErrors.countryCode ?? null,
    city: serverErrors.city ?? null,
    location:
      serverErrors.location ??
      (fields.location.trim().length > DRAFT_LIMITS.location
        ? `Keep the location under ${DRAFT_LIMITS.location} characters, or remove it.`
        : null),
  }

  const contactError = (() => {
    if (serverErrors.contact) return serverErrors.contact
    if (!touched.contact) return null
    const parsed = parseContact(fields.contact)
    return parsed.kind === "invalid" ? parsed.message : null
  })()

  const nameError =
    serverErrors.displayName ??
    (touched.displayName && fields.displayName.trim().length === 0 ? "Add your studio name." : null)

  // "At least 3 characters" is noise while the first two are being typed. A
  // too-short address is held back until the field is left; every other
  // outcome, reserved and taken included, shows as soon as it is known.
  const shownAvailability: AvailabilityState =
    availability.status === "invalid" &&
    !touched.handle &&
    normalizedHandle.length < HANDLE_LIMITS.min
      ? { status: "untouched" }
      : availability

  const handleError = serverErrors.handle ?? availabilityMessage(shownAvailability)

  const unsaved = saveStatus === "pending" || saveStatus === "saving" || saveStatus === "error"
  const uploading = imageState.kind === "uploading"

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <UnsavedChangesGuard when={unsaved || uploading} />

      <form
        noValidate
        aria-labelledby="profile-details-heading"
        className="flex min-w-0 flex-col gap-6 px-5 py-8 sm:px-10"
        onSubmit={(event) => {
          event.preventDefault()
          void onContinue()
        }}
      >
        <div className="flex flex-col gap-2">
          <span className="label-mono">Create your public profile</span>
          <h2
            id="profile-details-heading"
            className="font-display text-[32px] leading-[1.1] font-light tracking-[-0.03em] sm:text-[38px]"
          >
            Build your profile
          </h2>
          <p className="text-[16px] text-[var(--color-ink-2)]">
            Add the details customers will see when they visit your page.
          </p>
        </div>

        <fieldset disabled={continuing} className="flex min-w-0 flex-col gap-5">
          <legend className="sr-only">Profile details</legend>

          {/* Image ------------------------------------------------------------ */}
          <div role="group" aria-labelledby={`${ids.image}-label`} className="flex flex-col gap-2">
            <span id={`${ids.image}-label`} className="text-[14px] text-[var(--color-ink)]">
              Profile image
            </span>
            <div className="flex flex-wrap items-center gap-4">
              {avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element -- a blob: preview or a signed URL. */
                <img
                  src={avatarUrl}
                  alt="Your profile image"
                  width={80}
                  height={80}
                  // A signed URL can expire under a tab left open, and an object
                  // can be gone. Initials, never a broken-image icon.
                  onError={() => setAvatarUrl(null)}
                  className="aspect-square h-20 w-20 rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] object-cover"
                />
              ) : (
                <span
                  role="img"
                  aria-label="No profile image yet"
                  className="font-display flex h-20 w-20 items-center justify-center rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] text-[30px] font-light"
                >
                  {presentation.initials}
                </span>
              )}
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileInput}
                    id={ids.image}
                    type="file"
                    accept={ACCEPT}
                    className="peer sr-only"
                    aria-describedby={`${ids.image}-hint ${ids.image}-status`}
                    onChange={(event) => onPickImage(event.target.files?.[0] ?? null)}
                  />
                  <label
                    htmlFor={ids.image}
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius-pill)] border border-[var(--color-ink)] px-5 text-[15px] text-[var(--color-ink)] hover:bg-[var(--color-paper-2)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-[var(--color-accent)]"
                  >
                    Change image
                  </label>
                  {avatarUrl ? (
                    <button
                      type="button"
                      onClick={onRemoveImage}
                      className="min-h-11 rounded-[6px] text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <span id={`${ids.image}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
                  {AVATAR_RULES_SENTENCE}
                </span>
                <span id={`${ids.image}-status`} aria-live="polite" className="text-[13px]">
                  {imageState.kind === "uploading" ? (
                    <span className="text-[var(--color-ink-3)]">Saving image…</span>
                  ) : imageState.kind === "saved" ? (
                    <span className="flex items-center gap-2 text-[var(--color-ink)]">
                      <OkGlyph />
                      {imageState.removed
                        ? "Image removed from your draft"
                        : "Image saved to your draft"}
                    </span>
                  ) : null}
                </span>
                {imageState.kind === "error" ? (
                  <p
                    role="alert"
                    className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-ink)]"
                  >
                    <ErrorGlyph />
                    {imageState.message}
                    {imageState.retry ? (
                      <button
                        type="button"
                        onClick={() => imageState.retry && void uploadImage(imageState.retry)}
                        className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                      >
                        Try again
                      </button>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* Studio address ---------------------------------------------------- */}
          <div className="flex flex-col gap-2">
            <label htmlFor={ids.handle} className="text-[14px] text-[var(--color-ink)]">
              Studio address
            </label>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div
                className={`flex min-w-0 flex-1 basis-[280px] items-stretch overflow-hidden rounded-[10px] border bg-[var(--color-card)] focus-within:border-[var(--color-accent)] ${
                  handleError ? "border-[var(--color-bad)]" : "border-[var(--color-rule)]"
                }`}
              >
                <span
                  aria-hidden
                  className="flex shrink-0 items-center border-r border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 text-[15px] text-[var(--color-ink-2)]"
                >
                  {origin.replace(/^https?:\/\//, "")}/@
                </span>
                <input
                  id={ids.handle}
                  type="text"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={DRAFT_LIMITS.handle}
                  value={fields.handle}
                  onChange={(event) => setField("handle", event.target.value)}
                  onBlur={() => touch("handle")}
                  aria-invalid={handleError ? true : undefined}
                  aria-describedby={`${ids.handle}-status ${ids.handle}-hint`}
                  className="min-w-0 flex-1 px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none"
                />
              </div>
              <AvailabilityBadge
                id={`${ids.handle}-status`}
                state={shownAvailability}
                serverError={serverErrors.handle ?? null}
                onRetry={() => checker.current?.retry()}
              />
            </div>
            <span id={`${ids.handle}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
              Lowercase letters, numbers and hyphens, {HANDLE_LIMITS.min} to {HANDLE_LIMITS.max}{" "}
              characters.
              {normalizedHandle !== fields.handle.trim() && normalizedHandle.length > 0
                ? ` Your address will be @${normalizedHandle}.`
                : ""}
            </span>
          </div>

          {/* Studio name -------------------------------------------------------- */}
          <TextInput
            id={ids.displayName}
            label="Studio name"
            value={fields.displayName}
            maxLength={DRAFT_LIMITS.displayName}
            autoComplete="organization"
            error={nameError}
            onChange={(value) => setField("displayName", value)}
            onBlur={() => touch("displayName")}
          />

          {/* Short introduction -------------------------------------------------- */}
          <div className="flex flex-col gap-2">
            <label htmlFor={ids.shortBio} className="text-[14px] text-[var(--color-ink)]">
              Short introduction
            </label>
            <textarea
              id={ids.shortBio}
              rows={3}
              maxLength={DRAFT_LIMITS.shortBio}
              value={fields.shortBio}
              onChange={(event) => setField("shortBio", event.target.value)}
              onBlur={() => touch("shortBio")}
              aria-invalid={serverErrors.shortBio ? true : undefined}
              aria-describedby={`${ids.shortBio}-count${serverErrors.shortBio ? ` ${ids.shortBio}-error` : ""}`}
              className={`${FIELD_INPUT_CLASS} resize-y`}
            />
            <span
              id={`${ids.shortBio}-count`}
              className="tabular self-end text-[13px] text-[var(--color-ink-3)]"
            >
              {fields.shortBio.length} / {DRAFT_LIMITS.shortBio}
              <span className="sr-only"> characters used</span>
            </span>
            <FieldError id={`${ids.shortBio}-error`} message={serverErrors.shortBio ?? null} />
          </div>

          {/* About, optional ----------------------------------------------------- */}
          <div className="flex flex-col gap-2">
            <label htmlFor={ids.about} className="text-[14px] text-[var(--color-ink)]">
              About (optional)
            </label>
            <textarea
              id={ids.about}
              rows={5}
              maxLength={DRAFT_LIMITS.about}
              value={fields.about}
              onChange={(event) => setField("about", event.target.value)}
              onBlur={() => touch("about")}
              aria-invalid={serverErrors.about ? true : undefined}
              aria-describedby={`${ids.about}-hint ${ids.about}-count${serverErrors.about ? ` ${ids.about}-error` : ""}`}
              className={`${FIELD_INPUT_CLASS} resize-y`}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span id={`${ids.about}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
                Your practice, what you make and who it&rsquo;s for. Shown in your profile&rsquo;s
                About section.
              </span>
              <span
                id={`${ids.about}-count`}
                className="tabular text-[13px] text-[var(--color-ink-3)]"
              >
                {fields.about.length} / {DRAFT_LIMITS.about}
                <span className="sr-only"> characters used</span>
              </span>
            </div>
            <FieldError id={`${ids.about}-error`} message={serverErrors.about ?? null} />
          </div>

          {/* Location, optional -------------------------------------------------- */}
          <LocationFields
            workspaceSlug={workspaceSlug}
            countryId={ids.countryCode}
            cityId={ids.city}
            countryCode={fields.countryCode}
            city={fields.city}
            legacyLocation={fields.location}
            errors={locationErrors}
            onChange={(next) => setFieldsPatch(next)}
            onRemoveLegacy={() => setField("location", "")}
          />

          {/* Links ------------------------------------------------------------------ */}
          <div id={ids.links}>
            <LinksEditor
              initial={initial.fields.links}
              serverIssues={serverErrors.links ?? []}
              showAllErrors={Boolean(touched.links)}
              onChange={(links) => setField("links", links)}
            />
          </div>

          {/*
            Contact, optional. A Remove control rather than only "clear the
            field", because a creator who wants the button gone is looking for
            a way to take it off, not for an empty input to aim at. Removing
            saves like any other edit and nothing is public until publish.
          */}
          <div className="flex flex-col gap-2">
            <TextInput
              id={ids.contact}
              label="Contact button (optional)"
              value={fields.contact}
              placeholder="hello@yourstudio.com or yourstudio.com/contact"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="email"
              hint="Shown as a Contact button on your profile. Use an email address or a web page. Leave it empty to show no button."
              error={contactError}
              onChange={(value) => setField("contact", value)}
              onBlur={() => touch("contact")}
            />
            {fields.contact.trim().length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setField("contact", "")
                  document.getElementById(ids.contact)?.focus()
                }}
                className="min-h-11 self-start rounded-[6px] text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                Remove contact button
              </button>
            ) : null}
          </div>
        </fieldset>

        {formMessage ? (
          <p
            role="alert"
            className="flex items-start gap-2 border-l-2 border-[var(--color-bad)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px]"
          >
            {formMessage}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-2">
          <Button
            type="submit"
            disabled={continuing || uploading}
            aria-describedby={uploading ? `${ids.image}-status` : undefined}
            className="min-w-[160px] max-sm:w-full"
          >
            {continuing ? "Saving…" : uploading ? "Saving image…" : "Continue"}
          </Button>
          <button
            type="button"
            aria-pressed={showingExample}
            onClick={() => setShowingExample((value) => !value)}
            className="inline-flex min-h-11 items-center gap-2 rounded-[6px] text-[15px] text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            {showingExample ? "Back to your profile" : "View an example"}
            <span aria-hidden>→</span>
          </button>
          <DraftStatus status={saveStatus} onRetry={() => autosave.current?.retry()} />
        </div>
      </form>

      <div className="min-w-0 border-t border-[var(--color-rule)] px-5 py-8 sm:px-8 lg:border-t-0 lg:border-l">
        <ProfilePreview
          heading={showingExample ? "Example profile" : "Live preview"}
          subheading={showingExample ? "A fictional studio, for reference" : "Updates as you type"}
          origin={origin}
          presentation={showingExample ? EXAMPLE_PROFILE : presentation}
          published={published && !showingExample}
          emptyProductsMessage="Products you choose in the next step appear here."
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function availabilityMessage(state: AvailabilityState): string | null {
  switch (state.status) {
    case "invalid":
      return state.message
    case "reserved":
      return "That address is reserved by Fanwise. Choose another."
    case "unavailable":
      return "That address is taken. Choose another."
    default:
      return null
  }
}

function AvailabilityBadge({
  id,
  state,
  serverError,
  onRetry,
}: {
  id: string
  state: AvailabilityState
  serverError: string | null
  onRetry: () => void
}) {
  const message = serverError ?? availabilityMessage(state)
  return (
    <div id={id} aria-live="polite" className="flex min-h-11 items-center gap-2 text-[15px]">
      {message ? (
        <span className="flex items-center gap-2 text-[var(--color-ink)]">
          <ErrorGlyph />
          {message}
        </span>
      ) : state.status === "checking" ? (
        <span className="text-[var(--color-ink-3)]">Checking…</span>
      ) : state.status === "available" ? (
        <span className="flex items-center gap-2 text-[var(--color-ink)]">
          <OkGlyph />
          Available
        </span>
      ) : state.status === "error" ? (
        <span className="flex items-center gap-2 text-[var(--color-ink)]">
          <ErrorGlyph />
          Couldn&rsquo;t check.
          <button
            type="button"
            onClick={onRetry}
            className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            Try again
          </button>
        </span>
      ) : null}
    </div>
  )
}

function TextInput({
  id,
  label,
  error,
  hint,
  onChange,
  wrapperClassName = "",
  ...rest
}: {
  id: string
  label: string
  error: string | null
  hint?: string
  onChange: (value: string) => void
  wrapperClassName?: string
} & Omit<React.ComponentProps<"input">, "id" | "onChange">) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ")
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${wrapperClassName}`}>
      <label htmlFor={id} className="text-[14px] text-[var(--color-ink)]">
        {label}
      </label>
      <input
        id={id}
        type="text"
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`${FIELD_INPUT_CLASS} aria-[invalid=true]:border-[var(--color-bad)]`}
        {...rest}
      />
      {hint ? (
        <span id={`${id}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
          {hint}
        </span>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null
  return (
    <p id={id} className="flex items-center gap-2 text-[13px] text-[var(--color-ink)]">
      <ErrorGlyph />
      {message}
    </p>
  )
}
