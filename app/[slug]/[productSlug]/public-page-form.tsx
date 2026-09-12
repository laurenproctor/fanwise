"use client"

import { useActionState, useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { savePublicProductPageAction } from "@/lib/public/actions"
import { EMPTY_PAGE_STATE, type PublicProductPageState } from "@/lib/public/form-state"
import { PUBLIC_SLUG_LIMITS, canonicalHandle, checkPublicSlug } from "@/lib/public/handles"
import { publicRoutes, routes } from "@/lib/routes"
import type { PublicPageStatus } from "@/lib/public/types"

/**
 * The Public page section of the product editor.
 *
 * Everything here is an override of something the canonical product already
 * says, and the fields are labelled that way: empty means "use the product's
 * own". That is the shape the data model asks for — `public_product_pages`
 * holds overrides, not a copy — and it is also the behaviour a creator wants,
 * because a product renamed in Fanwise should be renamed on its public page
 * without them having to remember a second place.
 *
 * Whether the page is public is not decided here. The profile builder chooses
 * which products a profile shows and publishes them together; this section
 * edits what the page says, and reports where it stands.
 */

export interface PublicPageFields {
  slug: string
  titleOverride: string
  summaryOverride: string
  descriptionOverride: string
  coverAssetId: string
  seoTitle: string
  seoDescription: string
}

export function PublicPageForm({
  workspaceSlug,
  productSlug,
  handle,
  appOrigin,
  status,
  profileStatus,
  page,
  images,
}: {
  workspaceSlug: string
  productSlug: string
  handle: string
  appOrigin: string
  status: PublicPageStatus
  profileStatus: PublicPageStatus
  page: PublicPageFields
  images: Array<{ id: string; filename: string; assetType: string }>
}) {
  const action = savePublicProductPageAction.bind(null, workspaceSlug, productSlug)
  const [state, formAction, pending] = useActionState<PublicProductPageState, FormData>(
    action,
    EMPTY_PAGE_STATE,
  )

  const savedSlug = state.saved?.slug ?? page.slug

  const [fields, setFields] = useState<PublicPageFields>({ ...page, slug: savedSlug })
  const statusRef = useRef<HTMLParagraphElement>(null)

  const ids = {
    slug: useId(),
    title: useId(),
    summary: useId(),
    description: useId(),
    cover: useId(),
    seoTitle: useId(),
    seoDescription: useId(),
  }

  useEffect(() => {
    if (state.savedAt === null) return
    statusRef.current?.focus()
  }, [state.savedAt])

  function set<K extends keyof PublicPageFields>(key: K, value: string) {
    setFields((current) => ({ ...current, [key]: value }))
  }

  const published = status === "published"
  const url = `${appOrigin}${publicRoutes.product(handle, savedSlug)}`

  const slugChanged = canonicalHandle(fields.slug) !== savedSlug.toLowerCase()
  const slugCheck = checkPublicSlug(fields.slug)
  const slugError =
    (slugChanged && !slugCheck.ok ? slugCheck.message : null) ?? state.fieldErrors.slug ?? null

  const dirty = (Object.keys(fields) as Array<keyof PublicPageFields>).some((key) =>
    key === "slug"
      ? canonicalHandle(fields.slug) !== savedSlug.toLowerCase()
      : fields[key] !== page[key],
  )

  const canSave = dirty && slugCheck.ok && !pending

  return (
    <div className="flex flex-col gap-7">
      {/* Status and publishing ------------------------------------------- */}
      <div className="flex flex-col gap-4 rounded-[14px] border border-[var(--color-rule)] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill published={published && profileStatus === "published"} />
          <p className="text-[14px] text-[var(--color-ink-2)]">
            {published
              ? profileStatus === "published"
                ? "Shown on your public profile."
                : "Chosen for your profile, which isn't published."
              : "Not on your public profile."}
          </p>
        </div>

        {/*
          Whether a product appears on the profile, and where, is decided in
          one place: the profile builder. A second switch here would let the
          live profile show something its final preview did not.
        */}
        <p className="text-[14px] text-[var(--color-ink-2)]">
          Choose which products appear on your profile, and their order, in{" "}
          <Link
            href={routes.publicProfileBuilderProducts(workspaceSlug)}
            className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            the profile builder
          </Link>
          . The details below apply wherever this page is shown.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          {published && profileStatus === "published" ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              View public page
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          <CopyUrl url={url} />
        </div>
      </div>

      <form action={formAction} className="flex flex-col gap-7">
        <FormError message={state.error} />

        {/* Address --------------------------------------------------------- */}
        <div className="flex max-w-[560px] flex-col gap-2">
          <label htmlFor={ids.slug} className="label-mono">
            Public address
          </label>
          <div
            className={`flex items-stretch overflow-hidden rounded-[10px] border bg-[var(--color-card)] focus-within:border-[var(--color-accent)] ${
              slugError ? "border-[var(--color-bad)]" : "border-[var(--color-rule)]"
            }`}
          >
            <span
              aria-hidden
              className="shrink-0 border-r border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-2.5 font-mono text-[13px] text-[var(--color-ink-3)]"
            >
              /@{handle}/
            </span>
            <input
              id={ids.slug}
              name="slug"
              type="text"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              minLength={PUBLIC_SLUG_LIMITS.min}
              maxLength={PUBLIC_SLUG_LIMITS.max}
              value={fields.slug}
              onChange={(event) => set("slug", event.target.value)}
              aria-invalid={slugError ? true : undefined}
              aria-describedby={`${ids.slug}-hint${slugError ? ` ${ids.slug}-error` : ""}`}
              className="min-w-0 flex-1 px-3 py-2.5 font-mono text-[14px] text-[var(--color-ink)] outline-none"
            />
          </div>
          <p id={`${ids.slug}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
            Separate from the product&rsquo;s address inside Fanwise, so renaming one does not move
            the other. Changing it keeps the old address working as a redirect.
          </p>
          <FieldError id={`${ids.slug}-error`} message={slugError} />
        </div>

        {/* Cover ------------------------------------------------------------ */}
        {images.length > 0 ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="label-mono pb-2">Cover image</legend>
            <input type="hidden" name="coverAssetId" value={fields.coverAssetId} />
            <div className="flex flex-wrap gap-3">
              <CoverChoice
                selected={fields.coverAssetId === ""}
                onSelect={() => set("coverAssetId", "")}
                label="First image"
                hint="Automatic"
              />
              {images.map((image) => (
                <CoverChoice
                  key={image.id}
                  selected={fields.coverAssetId === image.id}
                  onSelect={() => set("coverAssetId", image.id)}
                  label={image.filename}
                  previewUrl={routes.assetPreview(workspaceSlug, image.id)}
                />
              ))}
            </div>
            <FieldError
              id={`${ids.cover}-error`}
              message={state.fieldErrors.coverAssetId ?? null}
            />
          </fieldset>
        ) : (
          <p className="max-w-prose text-[13px] text-[var(--color-ink-3)]">
            This product has no gallery images yet. Add a cover or preview image above and it will
            lead the public page.
          </p>
        )}

        {/* Copy overrides ---------------------------------------------------- */}
        <fieldset className="flex max-w-[560px] flex-col gap-5 border-t border-[var(--color-rule)] pt-7">
          <legend className="sr-only">Public wording</legend>
          <p className="text-[14px] text-[var(--color-ink-2)]">
            <span className="label-mono block pb-1">Public wording</span>
            Optional. Leave a field empty and the public page uses the product&rsquo;s own.
          </p>

          <TextField
            id={ids.title}
            name="titleOverride"
            label="Title"
            maxLength={200}
            value={fields.titleOverride}
            onChange={(value) => set("titleOverride", value)}
            error={state.fieldErrors.titleOverride ?? null}
          />

          <TextField
            id={ids.summary}
            name="summaryOverride"
            label="Summary"
            maxLength={300}
            value={fields.summaryOverride}
            onChange={(value) => set("summaryOverride", value)}
            error={state.fieldErrors.summaryOverride ?? null}
            hint="The line under the product name."
          />

          <div className="flex flex-col gap-2">
            <label htmlFor={ids.description} className="label-mono">
              Description
            </label>
            <textarea
              id={ids.description}
              name="descriptionOverride"
              rows={6}
              maxLength={4000}
              value={fields.descriptionOverride}
              onChange={(event) => set("descriptionOverride", event.target.value)}
              aria-describedby={`${ids.description}-hint`}
              className="w-full resize-y rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
            />
            <p id={`${ids.description}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
              Plain text. Blank lines become paragraphs; formatting and links are not rendered.
            </p>
            <FieldError
              id={`${ids.description}-error`}
              message={state.fieldErrors.descriptionOverride ?? null}
            />
          </div>
        </fieldset>

        {/* Search ------------------------------------------------------------ */}
        <fieldset className="flex max-w-[560px] flex-col gap-5 border-t border-[var(--color-rule)] pt-7">
          <legend className="sr-only">Search appearance</legend>
          <p className="text-[14px] text-[var(--color-ink-2)]">
            <span className="label-mono block pb-1">Search appearance</span>
            Optional. Left empty, Fanwise uses the title and summary above.
          </p>

          <TextField
            id={ids.seoTitle}
            name="seoTitle"
            label="Search title"
            maxLength={70}
            value={fields.seoTitle}
            onChange={(value) => set("seoTitle", value)}
            error={state.fieldErrors.seoTitle ?? null}
          />

          <TextField
            id={ids.seoDescription}
            name="seoDescription"
            label="Search description"
            maxLength={200}
            value={fields.seoDescription}
            onChange={(value) => set("seoDescription", value)}
            error={state.fieldErrors.seoDescription ?? null}
          />
        </fieldset>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={!canSave} className="max-sm:w-full">
            {pending ? "Saving…" : "Save public page"}
          </Button>
          <p
            ref={statusRef}
            role="status"
            aria-live="polite"
            tabIndex={-1}
            className="text-[14px] text-[var(--color-ink-2)] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
          >
            {pending
              ? "Saving the public page…"
              : state.savedAt !== null && !dirty
                ? "Public page saved."
                : dirty
                  ? "Unsaved changes."
                  : ""}
          </p>
        </div>
      </form>
    </div>
  )
}

function StatusPill({ published }: { published: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-[var(--radius-pill)] border px-3 py-1 font-mono text-[10px] tracking-[0.12em] uppercase ${
        published
          ? "border-[var(--color-ok)]/30 bg-[var(--color-ok)]/[0.09] text-[var(--color-ok)]"
          : "border-[var(--color-rule)] bg-[var(--color-paper-2)] text-[var(--color-ink-3)]"
      }`}
    >
      <span
        aria-hidden
        className={`h-[5px] w-[5px] rounded-full ${
          published ? "bg-[var(--color-ok)]" : "bg-[var(--color-ink-3)]"
        }`}
      />
      {published ? "Live" : "Draft"}
    </span>
  )
}

/**
 * One choice in the cover picker.
 *
 * The thumbnail comes from the *authenticated* preview route, not the public
 * one. The public route serves images only for a published page, so on a draft
 * — which is every page the first time a creator opens this — every thumbnail
 * would 404 and the picker would be a row of broken frames. This is the editor:
 * the person looking at it is signed in and RLS already lets them see the
 * asset.
 */
function CoverChoice({
  selected,
  onSelect,
  label,
  hint,
  previewUrl,
}: {
  selected: boolean
  onSelect: () => void
  label: string
  hint?: string
  previewUrl?: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={label}
      className={`flex w-[92px] shrink-0 flex-col overflow-hidden rounded-[10px] border text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
        selected
          ? "border-[var(--color-ink)]"
          : "border-[var(--color-rule)] hover:border-[var(--color-ink-3)]"
      }`}
    >
      {previewUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element -- the preview
           route redirects to a short-lived signed URL into a private bucket,
           which the optimizer cannot fetch or usefully cache. */
        <img
          src={previewUrl}
          alt=""
          style={{ aspectRatio: "1 / 1" }}
          className="w-full bg-[var(--color-paper-2)] object-cover"
        />
      ) : (
        <span
          aria-hidden
          style={{ aspectRatio: "1 / 1" }}
          className="flex w-full items-center justify-center bg-[var(--color-paper-2)] text-[var(--color-ink-3)]"
        >
          <AutoIcon />
        </span>
      )}
      <span className="truncate px-2 py-1.5 text-[11px] text-[var(--color-ink-2)]">
        {hint ?? label}
      </span>
    </button>
  )
}

function AutoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 15 5-4 4 3 3-2 6 4" />
    </svg>
  )
}

function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(url).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }}
        className="text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        {copied ? "Link copied" : "Copy link"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Public link copied to the clipboard." : ""}
      </span>
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
    <div className="flex flex-col gap-2">
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
