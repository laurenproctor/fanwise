import type { ComponentProps } from "react"
import { RequiredMark } from "./required-mark"

/**
 * The one input treatment, as a string.
 *
 * Exported because a second field shell needs the same box: the import screen's
 * fields carry a provenance marker beside their label, and that marker contains
 * a button. A button inside a `<label>` steals the label's accessible name — the
 * problem `components/channels/tag-input.tsx` already documents — so those
 * fields cannot use the `<label>`-wrapping shell below and must associate by
 * `htmlFor` instead. Sharing the class rather than the component keeps the two
 * shells looking like one control.
 */
export const FIELD_INPUT_CLASS =
  "w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 " +
  "text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] " +
  "focus:border-[var(--color-accent)]"

export function Field({
  label,
  hint,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-2">
      {/*
        Read from `required` rather than taken as a separate prop. A `marked`
        prop could be forgotten on a required field, or left on one that stopped
        being required; this cannot disagree with the input's own behaviour.
      */}
      <span className="label-mono">
        {label}
        {props.required ? <RequiredMark /> : null}
      </span>
      <input className={FIELD_INPUT_CLASS} {...props} />
      {hint ? <span className="text-[13px] text-[var(--color-ink-3)]">{hint}</span> : null}
    </label>
  )
}
