import type { ReactNode } from "react"

/**
 * One field, taken from somewhere else until someone says otherwise.
 *
 * A listing inherits the product's title and description, and a public page
 * inherits the product's wording. Both show the inherited value where the field
 * would be, with a control to write something different for this place only,
 * and a control to go back. The same two pieces in both, so "customize" means
 * one thing everywhere it appears.
 */

export function InheritToggle({
  field,
  overridden,
  onToggle,
  place,
}: {
  /** The field's name, for the accessible label. */
  field: string
  overridden: boolean
  onToggle: () => void
  /** Where a customization applies: "this channel", "the public page". */
  place: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      // The accessible name says which field it acts on: four identical
      // "Customize" buttons on one screen are four buttons a screen reader user
      // cannot tell apart.
      aria-label={
        overridden
          ? `Use the product's ${field.toLowerCase()}`
          : `Customize ${field.toLowerCase()} for ${place}`
      }
      className="font-mono text-[10px] tracking-[0.12em] text-[var(--color-ink-3)] uppercase underline underline-offset-4 hover:text-[var(--color-accent)]"
    >
      {overridden ? "Use the product's" : "Customize"}
    </button>
  )
}

/** The inherited value, shown where the field would be. */
export function InheritedValue({
  children,
  empty,
  id,
}: {
  children: ReactNode
  empty: boolean
  /** Lets a label point at the value, so the field keeps its name. */
  id?: string
}) {
  return (
    <div
      id={id}
      className="rounded-[10px] border border-dashed border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-2.5 text-[15px]"
    >
      <span className="label-mono mb-1 block">From the product</span>
      {empty ? (
        <span className="text-[var(--color-ink-3)]">
          The product has none yet. Add it once on the product and every place that uses it has it.
        </span>
      ) : (
        <span className="text-[var(--color-ink-2)]">{children}</span>
      )}
    </div>
  )
}
