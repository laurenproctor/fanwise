import type { ReactNode } from "react"
import { RequiredMark } from "@/components/ui/required-mark"

/**
 * A labelled field with a provenance marker beside its label.
 *
 * Not `components/ui/field.tsx`, and for one specific reason rather than taste:
 * that shell wraps everything in a `<label>`, the marker carries an info
 * button, and a button inside a label steals the label's accessible name — the
 * trap `components/channels/tag-input.tsx` already documents. So the label is
 * associated by `htmlFor` and the marker sits beside it as a sibling.
 *
 * The box itself is `FIELD_INPUT_CLASS`, imported by the caller from that same
 * file, so the two shells cannot drift into two different-looking inputs.
 *
 * The hint and issue ids are derived from `htmlFor` rather than generated, so
 * the caller can point the control's `aria-describedby` at them without this
 * component having to hand them back. `describedByFor()` is that convention,
 * written once.
 */
export function DraftField({
  label,
  htmlFor,
  required = false,
  annotation,
  hint,
  issue,
  children,
}: {
  label: string
  htmlFor: string
  required?: boolean
  /** The origin marker. A sibling of the label, never inside it. */
  annotation?: ReactNode
  hint?: string
  /** What is wrong with the current value, or null when it passes. */
  issue?: string | null
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={htmlFor} className="label-mono">
          {label}
          {required ? <RequiredMark /> : null}
        </label>
        {annotation}
      </div>
      {children}
      {hint ? (
        <span id={`${htmlFor}-hint`} className="text-[13px] text-[var(--color-ink-3)]">
          {hint}
        </span>
      ) : null}
      {issue ? (
        /*
          Not role="alert". Every issue here is true from the moment the field
          is empty, and an alert on each would announce five problems the
          instant the screen loads. The control points at this with
          aria-describedby, so it is read when the field is reached.
        */
        <span id={`${htmlFor}-issue`} className="text-[13px] text-[var(--color-ink)]">
          <span
            aria-hidden
            className="mr-2 inline-block h-[5px] w-[5px] rounded-full bg-[var(--color-bad)] align-middle"
          />
          {issue}
        </span>
      ) : null}
    </div>
  )
}

/** The describedby value for a field, naming only the parts actually rendered. */
export function describedByFor(
  htmlFor: string,
  options: { hint?: boolean; issue?: boolean },
): string | undefined {
  const ids = [
    options.hint ? `${htmlFor}-hint` : null,
    options.issue ? `${htmlFor}-issue` : null,
  ].filter((id): id is string => id !== null)
  return ids.length > 0 ? ids.join(" ") : undefined
}
