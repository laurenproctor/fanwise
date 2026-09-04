import type { ComponentProps } from "react"

export function Field({
  label,
  hint,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="label-mono">{label}</span>
      <input
        className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)]"
        {...props}
      />
      {hint ? <span className="text-[13px] text-[var(--color-ink-3)]">{hint}</span> : null}
    </label>
  )
}
