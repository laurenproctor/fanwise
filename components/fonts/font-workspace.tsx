"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { SaveStatusIndicator } from "@/components/ui/save-status"
import { routes } from "@/lib/routes"
import { productNameSchema, productSlugSchema } from "@/lib/products/schemas"
import { RESERVED_PRODUCT_SLUGS } from "@/lib/slug"
import type { FontMetadata } from "@/lib/products/metadata"
import { publishFontEverywhereAction, saveFontProductAction } from "@/lib/fonts/actions"
import { evaluateFontReadiness, type ReadinessRule } from "@/lib/fonts/readiness"
import type { PatchField } from "@/lib/fonts/save"
import { useAutosave } from "@/lib/fonts/use-autosave"
import { FONT_CLASSIFICATION_LABELS } from "@/lib/fonts/labels"
import {
  FONT_SECTION_LABELS,
  adoptionPatch,
  type ChannelDraftView,
  type DetectedFamily,
  type FontFileView,
  type FontProductValues,
  type FontSection,
  type ProductPatch,
  type SpecimenImageView,
  parseSection,
} from "@/lib/fonts/workspace"
import type { EditOptions, FontKey, SectionContext } from "./context"
import { LivePreview, previewStyles } from "./live-preview"
import { ReadinessIssues, SectionNav, SectionSummaries } from "./readiness-panels"
import { QUIET_BUTTON_CLASS } from "./controls"
import { ListingBasicsSection } from "./sections/basics"
import { FontFilesSection } from "./sections/files"
import { FamilySection } from "./sections/family"
import { CoverageSection } from "./sections/coverage"
import { SpecimenImagesSection } from "./sections/images"
import { LicensingSection } from "./sections/licensing"
import { MarketplaceDraftsSection } from "./sections/drafts"

/**
 * The font publishing workspace.
 *
 * One surface: sections on the left, one editor in the middle, the storefront
 * on the right, and readiness under it. The product lives here, in two pieces
 * of state — the canonical columns and the font metadata — seeded once from
 * the server and then owned by the screen. A server refresh (after a save, or
 * while a file processes) brings new files, images and channel drafts, and
 * never resets what the creator is typing.
 */

export interface FontWorkspaceProps {
  workspaceSlug: string
  productId: string
  /** Shown until the address names another section. */
  defaultSection: FontSection
  initialValues: FontProductValues
  initialMetadata: FontMetadata
  files: FontFileView[]
  family: DetectedFamily
  images: SpecimenImageView[]
  channels: ChannelDraftView[]
  hasLicenseFile: boolean
  attemptableChannels: number
  canPublishSomewhere: boolean
}

type LocalErrors = Partial<Record<PatchField, string>>

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

/** The canonical column a value writes to, converted to what the patch carries. */
function toPatch<K extends keyof FontProductValues>(
  key: K,
  value: FontProductValues[K],
): ProductPatch {
  if (key === "basePrice" || key === "name" || key === "slug" || key === "currency") {
    return { [key]: value } as ProductPatch
  }
  const text = (value as string).trim()
  return { [key]: text === "" ? null : text } as ProductPatch
}

export function FontWorkspace(props: FontWorkspaceProps) {
  const router = useRouter()
  const [values, setValues] = useState(props.initialValues)
  const [metadata, setMetadata] = useState(props.initialMetadata)
  /*
   * The open section is in the address's hash, never its query. The page reads
   * its search params on the server, so changing one — even with replaceState —
   * asks the server for a new page and remounts this component, taking every
   * unsaved keystroke and every upload in progress with it. A hash never leaves
   * the browser.
   */
  const hashSection = useSyncExternalStore(
    subscribeToHash,
    () => parseSection(window.location.hash.slice(1)),
    () => null,
  )
  const [chosenSection, setSection] = useState<FontSection | null>(null)
  const section = chosenSection ?? hashSection ?? props.defaultSection
  const [localErrors, setLocalErrors] = useState<LocalErrors>({})
  const [adoptedNotice, setAdoptedNotice] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<{
    error: string | null
    notice: string | null
  } | null>(null)
  const [savedSlug, setSavedSlug] = useState(props.initialValues.slug)
  const focusTarget = useRef<string | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const previewDialog = useRef<HTMLDialogElement>(null)

  const autosave = useAutosave({
    save: (patch) => saveFontProductAction(props.workspaceSlug, props.productId, patch),
    onSaved: (result) => {
      if (result.slug !== savedSlug) setSavedSlug(result.slug)
    },
  })

  /*
   * A saved new address is put in the location bar once nothing else is
   * waiting to save. Changing the path is a navigation to Next, which renders
   * the product at its new address; doing it while an edit is still pending
   * would drop that edit with the old page.
   */
  useEffect(() => {
    if (autosave.status !== "saved") return
    const path = routes.product(props.workspaceSlug, savedSlug)
    if (window.location.pathname !== path) {
      window.history.replaceState(null, "", `${path}${window.location.hash}`)
    }
  }, [autosave.status, savedSlug, props.workspaceSlug])

  const queueSave = autosave.queue

  const setLocalError = (field: PatchField, message: string | null) =>
    setLocalErrors((current) => {
      const next = { ...current }
      if (message) next[field] = message
      else delete next[field]
      return next
    })

  const setValue = useCallback(
    <K extends keyof FontProductValues>(
      key: K,
      value: FontProductValues[K],
      options: EditOptions = {},
    ) => {
      setValues((current) => ({ ...current, [key]: value }))

      // What the server would refuse, refused here first, so an invalid value
      // stays on screen with its reason and is never sent.
      if (key === "name") {
        const parsed = productNameSchema.safeParse(value)
        setLocalError(
          "name",
          parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check the name."),
        )
        if (!parsed.success) return
      }
      if (key === "slug") {
        const parsed = productSlugSchema.safeParse(value)
        const reserved = parsed.success && RESERVED_PRODUCT_SLUGS.has(parsed.data)
        const message = !parsed.success
          ? (parsed.error.issues[0]?.message ?? "Check the address.")
          : reserved
            ? "That address is reserved. Try another."
            : null
        setLocalError("slug", message)
        if (message) return
      }
      queueSave(toPatch(key, value), options.immediate)
    },
    [queueSave],
  )

  const setFont = useCallback(
    <K extends FontKey>(key: K, value: FontMetadata[K] | undefined, options: EditOptions = {}) => {
      setMetadata((current) => {
        const next = { ...current }
        if (value === undefined) delete next[key]
        else next[key] = value
        return next
      })
      queueSave({ font: { [key]: value === undefined ? null : value } }, options.immediate)
    },
    [queueSave],
  )

  /*
   * Fill what the files can answer and the product does not yet say.
   *
   * Checked during render whenever the detected family's content changes —
   * keyed on content, because its identity changes on every refresh even when
   * nothing new was read — so the filled values appear in the same paint. The
   * save is a server call and goes out from the effect below.
   */
  const familyKey = JSON.stringify(props.family)
  const [seenFamilyKey, setSeenFamilyKey] = useState<string | null>(null)
  const [adoption, setAdoption] = useState<ProductPatch | null>(null)
  if (seenFamilyKey !== familyKey) {
    setSeenFamilyKey(familyKey)
    const patch = adoptionPatch({ metadata, values, family: props.family })
    if (patch) {
      if (patch.version || patch.brandName) {
        setValues((current) => ({
          ...current,
          ...(patch.version ? { version: patch.version } : {}),
          ...(patch.brandName ? { brandName: patch.brandName } : {}),
        }))
      }
      if (patch.font) {
        setMetadata((current) => {
          const next: Record<string, unknown> = { ...current }
          for (const [key, value] of Object.entries(patch.font!)) {
            if (value === null) delete next[key]
            else next[key] = value
          }
          return next as FontMetadata
        })
      }
      const filled =
        Object.keys(patch.font ?? {}).filter((key) => key !== "formats" && key !== "styleCount")
          .length +
        (patch.version ? 1 : 0) +
        (patch.brandName ? 1 : 0)
      if (filled > 0) {
        setAdoptedNotice(
          `Filled ${filled} ${filled === 1 ? "detail" : "details"} from your font files. Check them and correct anything that is wrong.`,
        )
      }
      setAdoption(patch)
    }
  }

  useEffect(() => {
    if (adoption) queueSave(adoption, true)
  }, [adoption, queueSave])

  const readiness = useMemo(
    () =>
      evaluateFontReadiness({
        values,
        metadata,
        files: props.files,
        family: props.family,
        images: props.images,
        channels: props.channels,
        hasLicenseFile: props.hasLicenseFile,
      }),
    [
      values,
      metadata,
      props.files,
      props.family,
      props.images,
      props.channels,
      props.hasLicenseFile,
    ],
  )

  const openSection = useCallback((next: FontSection, fieldId: string | null = null) => {
    setSection(next)
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${next}`,
    )
    focusTarget.current = fieldId ?? "font-section-heading"
    setFocusTick((tick) => tick + 1)
  }, [])

  // Focus after the section has rendered, so the target exists.
  useEffect(() => {
    if (focusTick === 0 || !focusTarget.current) return
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(focusTarget.current ?? "")
      if (!element) return
      element.scrollIntoView({ block: "center", behavior: "smooth" })
      element.focus({ preventScroll: true })
      focusTarget.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [focusTick, section])

  const fieldError = useCallback(
    (field: PatchField) =>
      localErrors[field] ??
      (autosave.error && autosave.error.field === field ? autosave.error.message : null),
    [localErrors, autosave.error],
  )

  const refresh = useCallback(() => router.refresh(), [router])

  const ctx: SectionContext = {
    workspaceSlug: props.workspaceSlug,
    productId: props.productId,
    productSlug: savedSlug,
    values,
    metadata,
    setValue,
    setFont,
    fieldError,
    files: props.files,
    family: props.family,
    images: props.images,
    channels: props.channels,
    readiness,
    hasLicenseFile: props.hasLicenseFile,
    openSection,
    refresh,
  }

  const styles = useMemo(
    () => previewStyles(metadata, props.family, props.files),
    [metadata, props.family, props.files],
  )

  const publishBlockedReason = !readiness.canPublish
    ? `${readiness.blockingAll.length} ${readiness.blockingAll.length === 1 ? "issue blocks" : "issues block"} publishing. See Listing readiness.`
    : !props.canPublishSomewhere
      ? "Connect a channel Fanwise can publish to."
      : props.attemptableChannels === 0
        ? "No channel draft is ready to send yet. See Marketplace drafts."
        : null

  async function publish() {
    setPublishing(true)
    setPublishResult(null)
    try {
      await autosave.flush()
      const result = await publishFontEverywhereAction(props.workspaceSlug, props.productId)
      setPublishResult(result)
      router.refresh()
    } catch {
      setPublishResult({ error: "Publishing could not start. Try again.", notice: null })
    } finally {
      setPublishing(false)
    }
  }

  const summaries: Record<FontSection, string> = {
    basics: [
      values.canonicalTitle || values.name,
      (metadata.tags ?? []).length ? `${metadata.tags!.length} tags` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    files: props.files.length
      ? `${props.files.length} ${props.files.length === 1 ? "file" : "files"} · ${
          [...new Set(props.files.flatMap((f) => (f.format ? [f.format.toUpperCase()] : [])))].join(
            ", ",
          ) || "no fonts"
        }`
      : "No files yet",
    family: [
      metadata.styles?.length ? `${metadata.styles.length} styles` : "No styles",
      metadata.classification ? FONT_CLASSIFICATION_LABELS[metadata.classification] : null,
    ]
      .filter(Boolean)
      .join(" · "),
    coverage:
      [
        metadata.glyphCount ? `${metadata.glyphCount.toLocaleString()} glyphs` : null,
        (metadata.scripts ?? []).join(", ") || null,
      ]
        .filter(Boolean)
        .join(" · ") || "Not detected yet",
    images: props.images.length
      ? `${props.images.length} ${props.images.length === 1 ? "image" : "images"}`
      : "No images",
    licensing: [
      (metadata.licenses ?? [])
        .map((l) =>
          l.kind === "web"
            ? "Web"
            : l.kind === "epub"
              ? "ePub"
              : l.kind[0]!.toUpperCase() + l.kind.slice(1),
        )
        .join(" + ") || "No licenses",
      values.basePrice !== null ? `${values.basePrice} ${values.currency}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    drafts: props.channels.length
      ? `${props.channels.length} ${props.channels.length === 1 ? "channel" : "channels"}`
      : "No channels connected",
  }

  const name = values.name.trim() || "Untitled font"

  return (
    <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2">
          <nav aria-label="Breadcrumb">
            <ol className="label-mono flex flex-wrap items-center gap-2">
              <li>
                <Link
                  href={routes.workspace(props.workspaceSlug)}
                  className="hover:text-[var(--color-ink-2)]"
                >
                  Products
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li aria-current="page" className="truncate">
                {name}
              </li>
            </ol>
          </nav>
          <h1 className="font-display text-[clamp(32px,3.4vw,46px)] leading-[1.05] font-extralight tracking-[-0.03em] text-balance">
            Prepare {name} for launch
          </h1>
          <p className="text-[15.5px] text-[var(--color-ink-2)]">
            Review the font files, family details, specimens, licensing, and marketplace drafts.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <SaveStatusIndicator status={autosave.status} savedAt={autosave.savedAt} />
            {autosave.status === "error" && autosave.error?.retryable ? (
              <button type="button" onClick={autosave.retry} className={QUIET_BUTTON_CLASS}>
                Try again
              </button>
            ) : null}
            <Button
              variant="secondary"
              className="px-[18px] py-[9px]"
              onClick={() => previewDialog.current?.showModal()}
            >
              Preview
            </Button>
            <Button
              className="px-[20px] py-[9px]"
              disabled={publishing || publishBlockedReason !== null}
              aria-describedby={publishBlockedReason ? "font-publish-blocked" : undefined}
              onClick={() => void publish()}
            >
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          </div>
          {publishBlockedReason ? (
            <p id="font-publish-blocked" className="text-[12.5px] text-[var(--color-ink-3)]">
              {publishBlockedReason}
            </p>
          ) : null}
          {autosave.status === "error" && autosave.error && autosave.error.field === null ? (
            <p role="alert" className="text-[12.5px] text-[var(--color-danger)]">
              {autosave.error.message}
            </p>
          ) : null}
        </div>
      </header>

      {publishResult?.error || publishResult?.notice ? (
        <p
          role={publishResult.error ? "alert" : "status"}
          className={`border-l-2 py-2 pl-3 text-[14px] ${
            publishResult.error ? "border-[var(--color-danger)]" : "border-[var(--color-ok)]"
          } bg-[var(--color-paper-2)]`}
        >
          {publishResult.error ?? publishResult.notice}
        </p>
      ) : null}

      <div className="grid gap-x-10 gap-y-8 border-t border-[var(--color-rule)] pt-8 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_minmax(380px,0.85fr)]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <SectionNav
            current={section}
            readiness={readiness}
            onSelect={(next) => openSection(next)}
          />
        </aside>

        <section
          aria-labelledby="font-section-heading"
          className="flex min-w-0 flex-col gap-10 lg:border-l lg:border-[var(--color-rule)] lg:pl-10 xl:border-r xl:pr-10"
        >
          {adoptedNotice ? (
            <p
              role="status"
              className="flex items-start justify-between gap-3 border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] py-2 pr-2 pl-3 text-[13.5px]"
            >
              {adoptedNotice}
              <button
                type="button"
                onClick={() => setAdoptedNotice(null)}
                className="shrink-0 text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)]"
              >
                Dismiss
              </button>
            </p>
          ) : null}

          <div key={section}>
            {section === "basics" ? <ListingBasicsSection ctx={ctx} /> : null}
            {section === "files" ? <FontFilesSection ctx={ctx} /> : null}
            {section === "family" ? <FamilySection ctx={ctx} /> : null}
            {section === "coverage" ? <CoverageSection ctx={ctx} /> : null}
            {section === "images" ? <SpecimenImagesSection ctx={ctx} /> : null}
            {section === "licensing" ? <LicensingSection ctx={ctx} /> : null}
            {section === "drafts" ? <MarketplaceDraftsSection ctx={ctx} /> : null}
          </div>

          <SectionSummaries
            current={section}
            readiness={readiness}
            summaries={summaries}
            onSelect={(next) => openSection(next)}
          />
        </section>

        <aside
          aria-label="Storefront preview and readiness"
          className="flex min-w-0 flex-col gap-8 lg:col-span-2 xl:sticky xl:top-6 xl:col-span-1 xl:self-start"
        >
          <LivePreview
            workspaceSlug={props.workspaceSlug}
            name={values.name}
            shortDescription={values.shortDescription}
            metadata={metadata}
            styles={styles}
          />
          <ReadinessIssues
            readiness={readiness}
            onOpen={(rule: ReadinessRule) => openSection(rule.section, rule.fieldId)}
          />
        </aside>
      </div>

      <dialog
        ref={previewDialog}
        aria-label={`Storefront preview of ${name}`}
        className="m-auto w-[min(1100px,calc(100vw-2rem))] rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-paper)] p-6 text-[var(--color-ink)] backdrop:bg-black/40"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="text-[14px] text-[var(--color-ink-2)]">
            How {name} reads on a storefront. {FONT_SECTION_LABELS.files} feed the typeface shown.
          </p>
          <form method="dialog">
            <button type="submit" className={QUIET_BUTTON_CLASS} autoFocus>
              Close
            </button>
          </form>
        </div>
        <LivePreview
          workspaceSlug={props.workspaceSlug}
          name={values.name}
          shortDescription={values.shortDescription}
          metadata={metadata}
          styles={styles}
          size="full"
        />
      </dialog>
    </div>
  )
}
