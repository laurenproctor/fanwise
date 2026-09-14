"use client"

import { useActionState, useMemo, useState, useTransition } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { InfoTip } from "@/components/ui/info-tip"
import { updateListingAction, type SaveState } from "@/lib/channels/actions"
import { regenerateFieldAction } from "@/lib/ai/actions"
import type { ListingField } from "@/lib/ai/output"
import {
  canonicalValue,
  evaluate,
  resolveDraft,
  type CanonicalValues,
  type InheritedField,
} from "@/lib/channels/listings"
import { getAdapter } from "@/lib/channels/registry"
import { constraintsFor, type TextConstraint } from "@/lib/channels/constraints"
import type {
  AdapterSubject,
  ChannelField,
  ChannelKey,
  ChannelListingDraft,
} from "@/lib/channels/types"
import type { GlossaryTerm } from "@/lib/ui/glossary"
import { ReadinessBar } from "./readiness-bar"
import { RequirementList } from "./requirement-list"
import { TagInput } from "./tag-input"
import { MarkdownEditor } from "@/components/ui/markdown-editor"
import { InheritToggle, InheritedValue } from "@/components/ui/inherited-field"
import { markdownToPlainText } from "@/lib/text/markdown"

/**
 * The manual listing editor.
 *
 * Readiness updates as the creator types, using the same pure evaluator the
 * server runs at save. That is what "deterministic" bought us: one
 * implementation, two callers, no second opinion to drift. The browser's copy is
 * feedback only; the server recomputes and it is the server's verdict that
 * reaches the snapshot.
 *
 * A4 proved a person can write a listing per channel with no AI in the way.
 * B2 put the review beside it: every field can be regenerated on its own.
 * Approval has no button here; Publish is the approval, and the card says so
 * when composed copy is waiting.
 */

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save listing"}
    </Button>
  )
}

/** A character counter that reads the channel's own rule. */
function Counter({
  value,
  constraint,
  markdown = false,
}: {
  value: string
  constraint?: TextConstraint
  /** Count what a reader sees, as readiness does for a Markdown field. */
  markdown?: boolean
}) {
  if (!constraint?.maxLength && !constraint?.minLength) return null
  const length = (markdown ? markdownToPlainText(value) : value.trim()).length
  const over = constraint.maxLength !== undefined && length > constraint.maxLength
  const under = constraint.minLength !== undefined && length < constraint.minLength

  return (
    <span
      className={`tabular font-mono text-[12px] ${
        over || under ? "text-[var(--color-ink)]" : "text-[var(--color-ink-3)]"
      }`}
    >
      {length}
      {constraint.maxLength !== undefined ? ` / ${constraint.maxLength}` : ""}
      {under ? ` (${constraint.minLength} minimum)` : ""}
      {over ? ` (${length - constraint.maxLength!} over)` : ""}
    </span>
  )
}

/**
 * Regenerate one field with the model.
 *
 * Offered only while nothing is unsaved. A regeneration lands by remounting
 * the editor on the new row, and a remount discards local edits; asking the
 * creator to save first is cheaper than losing a paragraph they were in the
 * middle of.
 */
function RegenerateButton({
  field,
  label,
  onRegenerate,
  disabled,
  busy,
  reason,
}: {
  field: ListingField
  label: string
  onRegenerate: (field: ListingField) => void
  disabled: boolean
  busy: boolean
  reason: string | null
}) {
  return (
    <button
      type="button"
      onClick={() => onRegenerate(field)}
      disabled={disabled}
      aria-label={`Regenerate ${label.toLowerCase()}`}
      title={reason ?? undefined}
      className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] underline underline-offset-4 hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? "Composing…" : "Regenerate"}
    </button>
  )
}

/**
 * A labelled control with its explanation, counter and actions beside the label.
 *
 * The label is a sibling of the input rather than its wrapper, associated by
 * htmlFor. A <button> nested inside a <label> takes the label's text into its
 * own accessible name, so "Use canonical" announces itself as
 * "Title 16 / 120 Diverged by hand", and clicking it can activate the labelled
 * control as well. The info button is a sibling for the same reason, one it
 * would break in exactly the same way.
 *
 * The tip sits by the label rather than out at the right edge with the counter,
 * because it explains the word, and an icon a column away from the word it
 * explains is an icon nobody connects to it.
 */
function FieldShell({
  id,
  label,
  term,
  children,
  aside,
}: {
  id: string
  label: string
  term: GlossaryTerm
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-1.5">
          <label htmlFor={id} className="label-mono">
            {label}
          </label>
          <InfoTip term={term} />
        </span>
        {aside ? <span className="flex items-baseline gap-3">{aside}</span> : null}
      </div>
      {children}
    </div>
  )
}

/** The product's values, which a listing uses wherever it holds none. */
export type CanonicalSource = CanonicalValues

export interface ReviewProps {
  /** False when no model is configured: no Regenerate buttons are offered. */
  aiConfigured: boolean
  /** The field a generation is in flight for, "listing" for the whole, or null. */
  inFlight: ListingField | "listing" | null
}

export function ListingEditor({
  workspaceSlug,
  listingId,
  channelKey,
  subject,
  initial,
  canonical,
  review,
}: {
  workspaceSlug: string
  listingId: string
  channelKey: ChannelKey
  subject: AdapterSubject
  initial: ChannelListingDraft
  canonical: CanonicalSource
  review: ReviewProps
}) {
  const adapter = getAdapter(channelKey)
  const constraints = useMemo(() => constraintsFor(adapter), [adapter])
  const router = useRouter()

  const [draft, setDraft] = useState<ChannelListingDraft>(initial)
  /** A regeneration's refusal, shown with the save error. */
  const [pullError, setPullError] = useState<string | null>(null)
  const [reviewing, startReview] = useTransition()
  const [reviewNotice, setReviewNotice] = useState<string | null>(null)

  const action = updateListingAction.bind(null, workspaceSlug, listingId)
  const [state, formAction] = useActionState<SaveState, FormData>(action, {
    error: null,
    savedAt: null,
  })

  /*
   * Whether the screen holds words the row does not. Compared field by field
   * against what the page rendered, which is the row: a save remounts nothing,
   * so `initial` stays the last-loaded row and `savedAt` says whether the
   * current words reached it. Regenerate acts on the row, and is held back
   * while this is true.
   */
  const dirty = useMemo(() => {
    const keys: (keyof ChannelListingDraft)[] = [
      "title",
      "description",
      "shortDescription",
      "seoTitle",
      "seoDescription",
      "price",
      "currency",
      "category",
    ]
    if (keys.some((key) => (draft[key] ?? null) !== (initial[key] ?? null))) return true
    return draft.tags.join("\u0000") !== initial.tags.join("\u0000")
  }, [draft, initial])
  const unsaved = dirty && state.savedAt === null

  function regenerate(field: ListingField) {
    setPullError(null)
    setReviewNotice(null)
    startReview(async () => {
      const result = await regenerateFieldAction(workspaceSlug, listingId, field)
      if (result.error) setPullError(result.error)
      else setReviewNotice(result.notice)
      router.refresh()
    })
  }

  const regenerating = review.inFlight !== null || reviewing
  const holdReason = unsaved
    ? "Save your changes first; a regeneration replaces what is on screen."
    : review.inFlight !== null
      ? "A generation is already on its way."
      : null

  /** The Regenerate control for one field, or nothing when there is no model. */
  function regen(field: ListingField, label: string) {
    if (!review.aiConfigured) return null
    return (
      <RegenerateButton
        field={field}
        label={label}
        onRegenerate={regenerate}
        disabled={regenerating || unsaved}
        busy={review.inFlight === field}
        reason={holdReason}
      />
    )
  }

  const has = (field: ChannelField) => adapter.fields.includes(field)

  /*
   * What this listing says, with the product's words where it says nothing.
   * The same function the server resolves with (lib/channels/listings.ts), so
   * the readiness a creator watches while typing is the verdict a publish
   * records, and neither side can drift from the other.
   */
  const resolved = useMemo(
    () => resolveDraft(draft, canonical, adapter),
    [draft, canonical, adapter],
  )

  /** What the product says for one field, as text for the panel that shows it. */
  const fromProduct = (field: InheritedField) => {
    const value = canonicalValue(field, canonical)
    return value === null ? "" : String(value)
  }

  // The same function the server calls. Recomputed on every keystroke, which is
  // affordable precisely because requirements are pure and synchronous.
  const evaluation = useMemo(
    () => evaluate(adapter, resolved, subject),
    [adapter, resolved, subject],
  )

  function set<K extends keyof ChannelListingDraft>(key: K, value: ChannelListingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  /**
   * An empty field is the product's field. Customizing copies the product's
   * words in as a starting point, because an empty box to rewrite from is not
   * a starting point; going back empties the column again.
   */
  function toggleInherit(field: InheritedField) {
    const inherited = draft[field] === null
    // Customizing a field the product has left empty opens an empty field, not
    // a null one: null would be the product's again, and the click would do
    // nothing visible.
    const value = inherited
      ? (canonicalValue(field, canonical) ?? (field === "price" ? null : ""))
      : null
    if (field === "price") {
      setDraft((current) => ({
        ...current,
        price: (value as number | null) ?? (inherited ? 0 : null),
        currency: inherited ? current.currency : canonical.currency,
      }))
      return
    }
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const inputClass =
    "w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)]"

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form action={formAction} className="flex flex-col gap-5">
        <FormError message={state.error ?? pullError} />

        {has("title") ? (
          <FieldShell
            id="listing-title"
            label="Title"
            term="listingTitle"
            aside={
              <>
                <Counter value={resolved.title ?? ""} constraint={constraints.text.title} />
                {draft.title !== null ? regen("title", "Title") : null}
                <InheritToggle
                  field="Title"
                  place="this channel"
                  overridden={draft.title !== null}
                  onToggle={() => toggleInherit("title")}
                />
              </>
            }
          >
            {draft.title === null ? (
              <InheritedValue empty={fromProduct("title") === ""}>
                {fromProduct("title")}
              </InheritedValue>
            ) : (
              <input
                id="listing-title"
                name="title"
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                className={inputClass}
              />
            )}
          </FieldShell>
        ) : null}

        {has("description") ? (
          <FieldShell
            id="listing-description"
            label="Description"
            term="listingDescription"
            aside={
              <>
                <Counter
                  value={resolved.description ?? ""}
                  constraint={constraints.text.description}
                  markdown
                />
                {draft.description !== null ? regen("description", "Description") : null}
                <InheritToggle
                  field="Description"
                  place="this channel"
                  overridden={draft.description !== null}
                  onToggle={() => toggleInherit("description")}
                />
              </>
            }
          >
            {draft.description === null ? (
              <InheritedValue empty={fromProduct("description") === ""}>
                <span className="line-clamp-6 whitespace-pre-line">
                  {markdownToPlainText(fromProduct("description"))}
                </span>
              </InheritedValue>
            ) : (
              <MarkdownEditor
                id="listing-description"
                name="description"
                ariaLabel="Description"
                rows={10}
                value={draft.description}
                onChange={(value) => set("description", value)}
              />
            )}
          </FieldShell>
        ) : null}

        {has("shortDescription") ? (
          <FieldShell
            id="listing-short-description"
            label="Short description"
            term="listingShortDescription"
            aside={
              <>
                <Counter
                  value={resolved.shortDescription ?? ""}
                  constraint={constraints.text.shortDescription}
                />
                {draft.shortDescription !== null
                  ? regen("shortDescription", "Short description")
                  : null}
                <InheritToggle
                  field="Short description"
                  place="this channel"
                  overridden={draft.shortDescription !== null}
                  onToggle={() => toggleInherit("shortDescription")}
                />
              </>
            }
          >
            {draft.shortDescription === null ? (
              <InheritedValue empty={fromProduct("shortDescription") === ""}>
                {fromProduct("shortDescription")}
              </InheritedValue>
            ) : (
              <textarea
                id="listing-short-description"
                name="shortDescription"
                rows={2}
                value={draft.shortDescription}
                onChange={(e) => set("shortDescription", e.target.value)}
                className={inputClass}
              />
            )}
          </FieldShell>
        ) : null}

        {/*
          The search-result pair, together and after the writing they fall back
          to. Both are overrides: left empty, the channel uses the title and the
          short description above, which the placeholders say rather than
          leaving the creator to find out by publishing.
        */}
        {has("seoTitle") ? (
          <FieldShell
            id="listing-seo-title"
            label="Meta title"
            term="listingSeoTitle"
            aside={
              <>
                <Counter value={draft.seoTitle ?? ""} constraint={constraints.text.seoTitle} />
                {regen("seoTitle", "Meta title")}
              </>
            }
          >
            <input
              id="listing-seo-title"
              name="seoTitle"
              value={draft.seoTitle ?? ""}
              onChange={(e) => set("seoTitle", e.target.value)}
              placeholder="Defaults to the title above"
              className={inputClass}
            />
          </FieldShell>
        ) : null}

        {has("seoDescription") ? (
          <FieldShell
            id="listing-seo-description"
            label="Meta description"
            term="listingSeoDescription"
            aside={
              <>
                <Counter
                  value={draft.seoDescription ?? ""}
                  constraint={constraints.text.seoDescription}
                />
                {regen("seoDescription", "Meta description")}
              </>
            }
          >
            <textarea
              id="listing-seo-description"
              name="seoDescription"
              rows={2}
              value={draft.seoDescription ?? ""}
              onChange={(e) => set("seoDescription", e.target.value)}
              placeholder="Defaults to the short description above"
              className={inputClass}
            />
          </FieldShell>
        ) : null}

        {has("price") ? (
          <div className="grid grid-cols-2 gap-4">
            <FieldShell
              id="listing-price"
              label="Price"
              term="listingPrice"
              aside={
                <InheritToggle
                  field="Price"
                  place="this channel"
                  overridden={draft.price !== null}
                  onToggle={() => toggleInherit("price")}
                />
              }
            >
              {draft.price === null ? (
                <InheritedValue empty={fromProduct("price") === ""}>
                  {fromProduct("price")} {canonical.currency}
                </InheritedValue>
              ) : (
                <input
                  id="listing-price"
                  name="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={draft.price}
                  onChange={(e) =>
                    set("price", e.target.value === "" ? null : Number(e.target.value))
                  }
                  className={inputClass}
                />
              )}
            </FieldShell>

            {draft.price === null ? null : (
              <FieldShell id="listing-currency" label="Currency" term="listingCurrency">
                <input
                  id="listing-currency"
                  name="currency"
                  value={draft.currency}
                  maxLength={3}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                  className={inputClass}
                />
              </FieldShell>
            )}
          </div>
        ) : null}

        {has("category") ? (
          <FieldShell id="listing-category" label="Category" term="listingCategory">
            {constraints.text.category?.allowed ? (
              <select
                id="listing-category"
                name="category"
                value={draft.category ?? ""}
                onChange={(e) => set("category", e.target.value)}
                className={inputClass}
              >
                <option value="">Not set</option>
                {constraints.text.category.allowed.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="listing-category"
                name="category"
                value={draft.category ?? ""}
                onChange={(e) => set("category", e.target.value)}
                className={inputClass}
              />
            )}
          </FieldShell>
        ) : null}

        <div className="flex flex-col gap-2" hidden={!has("tags")}>
          {review.aiConfigured && has("tags") ? (
            <div className="flex justify-end">{regen("tags", "Tags")}</div>
          ) : null}
          <TagInput
            name="tags"
            defaultValue={initial.tags}
            minCount={constraints.tags?.minCount}
            maxCount={constraints.tags?.maxCount}
            maxTagLength={constraints.tags?.maxTagLength}
            onChange={(tags) => set("tags", tags)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Submit />
          {state.savedAt && !state.error ? (
            <span className="label-mono text-[var(--color-ok)]" role="status">
              Saved
            </span>
          ) : null}
          {reviewNotice ? (
            <span className="label-mono text-[var(--color-ink-3)]" role="status">
              {reviewNotice}
            </span>
          ) : null}
        </div>
      </form>

      <aside className="flex h-fit flex-col gap-5 rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-card)] p-5 lg:sticky lg:top-6">
        <div className="grid gap-1">
          <span className="label-mono">{adapter.name} readiness</span>
          <p className="text-[13px] text-[var(--color-ink-2)]">
            Computed from this channel&rsquo;s rules as you type. Nothing here is estimated.
          </p>
        </div>

        <ReadinessBar readiness={evaluation.readiness} />
        <RequirementList results={evaluation.results} />

        {/*
          Saving is always allowed, including when the channel would reject the
          listing. Refusing the save would put the answer behind the fix.
        */}
        {!evaluation.readiness.ready ? (
          <p className="border-l-2 border-[var(--color-rule)] pl-3 text-[13px] text-[var(--color-ink-3)]">
            You can save an unfinished listing. {adapter.name} would reject it as it stands.
          </p>
        ) : null}
      </aside>
    </div>
  )
}
