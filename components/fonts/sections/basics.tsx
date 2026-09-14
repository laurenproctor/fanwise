"use client"

import { FONT_CLASSIFICATION_LABELS } from "@/lib/fonts/labels"
import { FIELD_IDS } from "@/lib/fonts/readiness"
import { routes } from "@/lib/routes"
import type { SectionContext } from "../context"
import { ChipsInput, LINK_BUTTON_CLASS, SectionHeading, TextArea, TextInput } from "../controls"

/**
 * The marketing copy, entered once.
 *
 * Family name, designer and classification are shown here but edited in
 * Family & styles, where they belong. Showing them read-only with a way to get
 * there is how the screen avoids asking for one value in two places.
 */
export function ListingBasicsSection({ ctx }: { ctx: SectionContext }) {
  const { values, metadata } = ctx
  const address = routes.product(ctx.workspaceSlug, values.slug || ctx.productSlug)

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Listing basics"
        description="The words buyers read first. Every channel draft starts from these."
      />

      <TextInput
        id={FIELD_IDS.canonicalTitle}
        label="Listing title"
        value={values.canonicalTitle}
        maxLength={200}
        placeholder={values.name}
        onChange={(event) => ctx.setValue("canonicalTitle", event.target.value)}
        error={ctx.fieldError("canonicalTitle")}
        hint="Leave empty to use the family name."
      />

      <TextInput
        id={FIELD_IDS.slug}
        label="URL slug"
        value={values.slug}
        maxLength={64}
        spellCheck={false}
        autoCapitalize="off"
        onChange={(event) => ctx.setValue("slug", event.target.value.toLowerCase())}
        error={ctx.fieldError("slug")}
        hint={
          <>
            This product in Fanwise: <span className="font-mono text-[12px]">{address}</span>. A
            public page keeps its own address.
          </>
        }
      />

      <TextArea
        id={FIELD_IDS.shortDescription}
        label="Short description"
        rows={2}
        maxLength={500}
        value={values.shortDescription}
        onChange={(event) => ctx.setValue("shortDescription", event.target.value)}
        error={ctx.fieldError("shortDescription")}
        hint="One line under the name, like “Playful type for a bigger tomorrow.”"
      />

      <TextArea
        id={FIELD_IDS.canonicalDescription}
        label="Full description"
        rows={7}
        maxLength={8000}
        value={values.canonicalDescription}
        onChange={(event) => ctx.setValue("canonicalDescription", event.target.value)}
        error={ctx.fieldError("canonicalDescription")}
        hint={`${values.canonicalDescription.length.toLocaleString()} / 8,000 characters`}
      />

      <ChipsInput
        id={FIELD_IDS.tags}
        label="Tags"
        values={metadata.tags ?? []}
        maxLength={40}
        placeholder="bubble, retro, playful"
        onChange={(tags) => ctx.setFont("tags", tags, { immediate: true })}
        hint="Press Enter or type a comma to add. Channel drafts keep their own tag lists."
      />

      <dl className="grid gap-4 border-t border-[var(--color-rule)] pt-5 sm:grid-cols-2">
        <Reference
          term="Designer / foundry"
          value={values.brandName || "Not set"}
          onEdit={() => ctx.openSection("family", FIELD_IDS.brandName)}
        />
        <Reference
          term="Classification"
          value={
            metadata.classification
              ? FONT_CLASSIFICATION_LABELS[metadata.classification]
              : "Not set"
          }
          onEdit={() => ctx.openSection("family", FIELD_IDS.classification)}
        />
      </dl>
    </div>
  )
}

function Reference({ term, value, onEdit }: { term: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-[var(--color-ink-3)]">{term}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-3 text-[14.5px]">
        <span>{value}</span>
        <button type="button" onClick={onEdit} className={LINK_BUTTON_CLASS}>
          Edit in Family &amp; styles<span className="sr-only"> ({term})</span>
        </button>
      </dd>
    </div>
  )
}
