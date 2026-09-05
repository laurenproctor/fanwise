import type { ComponentProps } from "react"
import { RequiredMark } from "./required-mark"

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
      <input
        className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)]"
        {...props}
      />
      {hint ? <span className="text-[13px] text-[var(--color-ink-3)]">{hint}</span> : null}
    </label>
  )
}
