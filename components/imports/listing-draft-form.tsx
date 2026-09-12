"use client"

import { FIELD_INPUT_CLASS } from "@/components/ui/field"
import { TagInput } from "@/components/channels/tag-input"
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS, type ProductType } from "@/lib/products/types"
import { fieldsAwaitingReview, listingIssues, LISTING_FIELD_LABELS } from "@/lib/imports/draft"
import { joinWords } from "@/lib/imports/prose"
import type { ListingDraft, ListingFieldKey } from "@/lib/imports/types"
import { DraftField, describedByFor } from "./draft-field"
import { OriginBadge } from "./origin-badge"

/**
 * The master listing, editable, with every value saying where it came from.
 *
 * This is the half of the screen that decides what the canonical product will
 * be, so two rules hold here and nowhere else:
 *
 *   1. **Every field carries its origin.** `OriginBadge` renders it. A value
 *      the source stated and a value a model proposed are not the same kind of
 *      thing and are never drawn as though they were.
 *   2. **A model's proposal is not finished until a person has read it.**
 *      `fieldsAwaitingReview` is what the Listing readiness step consults, and
 *      the acknowledgment at the foot of this form is how a creator answers it.
 *      Architecture invariant 5 is the reason: an unreviewed suggestion that
 *      reached the canonical product would enter the FactSheet, and every later
 *      generation for every other channel would be free to restate a claim
 *      Fanwise invented here.
 *
 * Editing a field is itself a review and a stronger one than the checkbox: the
 * value becomes the creator's, and `setListingField` marks it so.
 */

const DESCRIPTION_LIMIT = 1000

export function ListingDraftForm({
  draft,
  onFieldChange,
  onReviewSuggestions,
}: {
  draft: ListingDraft
  onFieldChange: <K extends ListingFieldKey>(key: K, value: ListingDraft[K]["value"]) => void
  onReviewSuggestions: () => void
}) {
  const issues = listingIssues(draft)
  const issueFor = (key: ListingFieldKey) =>
    issues.find((issue) => issue.field === key)?.message ?? null
  const awaiting = fieldsAwaitingReview(draft)

  const titleIssue = issueFor("title")
  const typeIssue = issueFor("productType")
  const priceIssue = issueFor("price")
  const descriptionIssue = issueFor("description")
  const described = draft.description.value.length

  return (
    <section aria-labelledby="import-draft-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2
          id="import-draft-heading"
          className="font-display text-[22px] font-light tracking-[-0.02em]"
        >
          Listing draft
        </h2>
        <p className="max-w-prose text-[14px] leading-[1.55] text-[var(--color-ink-2)]">
          Review and edit the details Fanwise prepared from your source. Nothing here is final, and
          nothing leaves Fanwise until you approve it.
        </p>
      </div>

      <DraftField
        label={LISTING_FIELD_LABELS.title}
        htmlFor="import-title"
        required
        issue={titleIssue}
        annotation={<OriginBadge origin={draft.title.origin} field={LISTING_FIELD_LABELS.title} />}
      >
        <input
          id="import-title"
          name="title"
          type="text"
          required
          maxLength={200}
          value={draft.title.value}
          aria-describedby={describedByFor("import-title", { issue: titleIssue !== null })}
          aria-invalid={titleIssue !== null}
          onChange={(event) => onFieldChange("title", event.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </DraftField>

      <div className="grid gap-5 sm:grid-cols-2">
        <DraftField
          label={LISTING_FIELD_LABELS.productType}
          htmlFor="import-product-type"
          required
          issue={typeIssue}
          annotation={
            <OriginBadge
              origin={draft.productType.origin}
              field={LISTING_FIELD_LABELS.productType}
            />
          }
        >
          <select
            id="import-product-type"
            name="productType"
            required
            value={draft.productType.value ?? ""}
            aria-describedby={describedByFor("import-product-type", { issue: typeIssue !== null })}
            aria-invalid={typeIssue !== null}
            onChange={(event) =>
              onFieldChange(
                "productType",
                event.target.value === "" ? null : (event.target.value as ProductType),
              )
            }
            className={FIELD_INPUT_CLASS}
          >
            <option value="">Choose a type…</option>
            {PRODUCT_TYPES.map((type) => (
              <option key={type} value={type}>
                {PRODUCT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </DraftField>

        <DraftField
          label={`${LISTING_FIELD_LABELS.price} (${draft.currency.value})`}
          htmlFor="import-price"
          required
          issue={priceIssue}
          hint="Enter 0 to give it away."
          annotation={
            <OriginBadge origin={draft.price.origin} field={LISTING_FIELD_LABELS.price} />
          }
        >
          <input
            id="import-price"
            name="price"
            type="text"
            inputMode="decimal"
            required
            value={draft.price.value}
            aria-describedby={describedByFor("import-price", {
              hint: true,
              issue: priceIssue !== null,
            })}
            aria-invalid={priceIssue !== null}
            onChange={(event) => onFieldChange("price", event.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </DraftField>
      </div>

      <DraftField
        label={LISTING_FIELD_LABELS.description}
        htmlFor="import-description"
        required
        issue={descriptionIssue}
        annotation={
          <OriginBadge origin={draft.description.origin} field={LISTING_FIELD_LABELS.description} />
        }
      >
        <textarea
          id="import-description"
          name="description"
          required
          rows={5}
          maxLength={DESCRIPTION_LIMIT}
          value={draft.description.value}
          aria-describedby={describedByFor("import-description", {
            issue: descriptionIssue !== null,
          })}
          aria-invalid={descriptionIssue !== null}
          onChange={(event) => onFieldChange("description", event.target.value)}
          className={`${FIELD_INPUT_CLASS} resize-y leading-[1.6]`}
        />
        <span className="tabular self-end font-mono text-[12px] text-[var(--color-ink-3)]">
          {described} / {DESCRIPTION_LIMIT}
        </span>
      </DraftField>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <OriginBadge origin={draft.tags.origin} field={LISTING_FIELD_LABELS.tags} />
        </div>
        {/*
          The channel listing editor's tag field, reused rather than rewritten.
          It carries its own label, its own glossary tip and its own count, and
          a second comma-separated tag field on a second screen would be a
          second set of rules about what a tag is.
        */}
        <TagInput
          name="tags"
          defaultValue={[...draft.tags.value]}
          onChange={(tags) => onFieldChange("tags", tags)}
        />
      </div>

      {awaiting.length > 0 ? (
        <ReviewAcknowledgment fields={awaiting} onConfirm={onReviewSuggestions} />
      ) : null}
    </section>
  )
}

/**
 * The one control that answers "has a person read what the model wrote".
 *
 * It appears only while something is waiting, and it disappears once answered,
 * because a permanently ticked box is a box nobody reads. Editing any of the
 * named fields answers it for that field without touching this.
 */
function ReviewAcknowledgment({
  fields,
  onConfirm,
}: {
  fields: readonly ListingFieldKey[]
  onConfirm: () => void
}) {
  const names = fields.map((key) => LISTING_FIELD_LABELS[key].toLowerCase())
  const listed = joinWords(names)

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--color-warn)] bg-[var(--color-paper-2)] px-4 py-4">
      <p className="text-[14px] leading-[1.55] text-[var(--color-ink)]">
        Fanwise worked out the {listed} rather than reading {names.length === 1 ? "it" : "them"} on
        the page. Check {names.length === 1 ? "it" : "them"} before continuing: anything you accept
        here, Fanwise may repeat on other channels.
      </p>
      <button
        type="button"
        onClick={onConfirm}
        className="inline-flex min-h-11 items-center self-start rounded-[var(--radius-pill)] border border-[var(--color-ink)] px-4 text-[14px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-card)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
      >
        I have checked {names.length === 1 ? "it" : "these"}
      </button>
    </div>
  )
}
