"use client"

import { useActionState, useMemo, useState, useTransition } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import {
  pullFromCanonicalAction,
  updateListingAction,
  type SaveState,
} from "@/lib/channels/actions"
import { approveListingAction, regenerateFieldAction } from "@/lib/ai/actions"
import type { ListingField } from "@/lib/ai/output"
import { evaluate } from "@/lib/channels/listings"
import { getAdapter } from "@/lib/channels/registry"
import { constraintsFor, type TextConstraint } from "@/lib/channels/constraints"
import type { AdapterSubject, ChannelKey, ChannelListingDraft } from "@/lib/channels/types"
import { ReadinessBar } from "./readiness-bar"
import { RequirementList } from "./requirement-list"
import { TagInput } from "./tag-input"

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
 * B2 put the review beside it: every field can be regenerated on its own, and
 * the listing is approved by a button that is not Save. Saving records words;
 * approving vouches for them. A creator can do the first many times before
 * doing the second once.
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
function Counter({ value, constraint }: { value: string; constraint?: TextConstraint }) {
  if (!constraint?.maxLength && !constraint?.minLength) return null
  const length = value.trim().length
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

function PullButton({
  field,
  onPull,
  disabled,
}: {
  field: string
  onPull: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPull}
      disabled={disabled}
      // The accessible name says which field this acts on. Six identical
      // "Use canonical" buttons on one screen are six buttons a screen reader
      // user cannot tell apart.
      aria-label={`Use canonical ${field.toLowerCase()}`}
      className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] underline underline-offset-4 hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      Use canonical
    </button>
  )
}

/**
 * A labelled control with its counter and actions beside the label.
 *
 * The label is a sibling of the input rather than its wrapper, associated by
 * htmlFor. A <button> nested inside a <label> takes the label's text into its
 * own accessible name, so "Use canonical" announces itself as
 * "Title 16 / 120 Diverged by hand", and clicking it can activate the labelled
 * control as well.
 */
function FieldShell({
  id,
  label,
  children,
  aside,
}: {
  id: string
  label: string
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label-mono">
          {label}
        </label>
        {aside ? <span className="flex items-baseline gap-3">{aside}</span> : null}
      </div>
      {children}
    </div>
  )
}

export interface CanonicalSource {
  title: string
  description: string
  shortDescription: string
  price: string
}

export interface ReviewProps {
  /** False when no model is configured: no Regenerate buttons are offered. */
  aiConfigured: boolean
  /** The field a generation is in flight for, "listing" for the whole, or null. */
  inFlight: ListingField | "listing" | null
  /** True when composed copy has landed and nobody has approved since. */
  awaitingReview: boolean
  approvedAt: string | null
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
  const [pulling, startPull] = useTransition()
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
   * current words reached it. Regenerate and Approve both act on the row, and
   * both are held back while this is true.
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

  function approve() {
    setPullError(null)
    setReviewNotice(null)
    startReview(async () => {
      const result = await approveListingAction(workspaceSlug, listingId)
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

  // The same function the server calls. Recomputed on every keystroke, which is
  // affordable precisely because requirements are pure and synchronous.
  const evaluation = useMemo(() => evaluate(adapter, draft, subject), [adapter, draft, subject])

  function set<K extends keyof ChannelListingDraft>(key: K, value: ChannelListingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function pull(field: "title" | "description" | "shortDescription" | "price") {
    setPullError(null)
    startPull(async () => {
      const result = await pullFromCanonicalAction(workspaceSlug, listingId, field)
      if (result.error) {
        setPullError(result.error)
        return
      }
      // Mirror the server's write locally so readiness reflects it immediately
      // rather than after the route refreshes.
      if (field === "price") {
        set("price", canonical.price === "" ? null : Number(canonical.price))
      } else {
        set(field, canonical[field] === "" ? null : canonical[field])
      }
    })
  }

  const inputClass =
    "w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)]"

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form action={formAction} className="flex flex-col gap-5">
        <FormError message={state.error ?? pullError} />

        <FieldShell
          id="listing-title"
          label="Title"
          aside={
            <>
              <Counter value={draft.title ?? ""} constraint={constraints.text.title} />
              {regen("title", "Title")}
              <PullButton field="Title" onPull={() => pull("title")} disabled={pulling} />
            </>
          }
        >
          <input
            id="listing-title"
            name="title"
            value={draft.title ?? ""}
            onChange={(e) => set("title", e.target.value)}
            className={inputClass}
          />
        </FieldShell>

        <FieldShell
          id="listing-description"
          label="Description"
          aside={
            <>
              <Counter value={draft.description ?? ""} constraint={constraints.text.description} />
              {regen("description", "Description")}
              <PullButton
                field="Description"
                onPull={() => pull("description")}
                disabled={pulling}
              />
            </>
          }
        >
          <textarea
            id="listing-description"
            name="description"
            rows={10}
            value={draft.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
            className={inputClass}
          />
        </FieldShell>

        <FieldShell
          id="listing-short-description"
          label="Short description"
          aside={
            <>
              <Counter
                value={draft.shortDescription ?? ""}
                constraint={constraints.text.shortDescription}
              />
              {regen("shortDescription", "Short description")}
              <PullButton
                field="Short description"
                onPull={() => pull("shortDescription")}
                disabled={pulling}
              />
            </>
          }
        >
          <textarea
            id="listing-short-description"
            name="shortDescription"
            rows={2}
            value={draft.shortDescription ?? ""}
            onChange={(e) => set("shortDescription", e.target.value)}
            className={inputClass}
          />
        </FieldShell>

        {/*
          The search-result pair, together and after the writing they fall back
          to. Both are overrides: left empty, the channel uses the title and the
          short description above, which the placeholders say rather than
          leaving the creator to find out by publishing.
        */}
        <FieldShell
          id="listing-seo-title"
          label="Meta title"
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

        <FieldShell
          id="listing-seo-description"
          label="Meta description"
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

        <div className="grid grid-cols-2 gap-4">
          <FieldShell
            id="listing-price"
            label="Price"
            aside={<PullButton field="Price" onPull={() => pull("price")} disabled={pulling} />}
          >
            <input
              id="listing-price"
              name="price"
              type="number"
              step="0.01"
              min="0"
              value={draft.price ?? ""}
              onChange={(e) => set("price", e.target.value === "" ? null : Number(e.target.value))}
              className={inputClass}
            />
          </FieldShell>

          <FieldShell id="listing-currency" label="Currency">
            <input
              id="listing-currency"
              name="currency"
              value={draft.currency}
              maxLength={3}
              onChange={(e) => set("currency", e.target.value.toUpperCase())}
              className={inputClass}
            />
          </FieldShell>
        </div>

        <FieldShell id="listing-category" label="Category">
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

        <div className="flex flex-col gap-2">
          {review.aiConfigured ? (
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

        {/*
          Two buttons, two claims. Save records the words; Approve vouches for
          them. Approve acts on the row, so it waits for a save: approving
          text the screen shows and the row does not hold would approve
          something else.
        */}
        <div className="flex flex-wrap items-center gap-4">
          <Submit />
          {review.aiConfigured || review.awaitingReview ? (
            <Button
              type="button"
              variant="secondary"
              onClick={approve}
              disabled={reviewing || unsaved || !review.awaitingReview}
              title={
                unsaved
                  ? "Save your changes first."
                  : review.awaitingReview
                    ? undefined
                    : "Nothing is waiting for approval."
              }
            >
              {reviewing ? "Working…" : "Approve listing"}
            </Button>
          ) : null}
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
          {!review.awaitingReview && review.approvedAt ? (
            <span className="label-mono text-[var(--color-ok)]">Approved</span>
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
