"use client"

import { useState, type ReactNode } from "react"
import { InfoTip } from "@/components/ui/info-tip"

/**
 * Tags as a comma-separated field, with a live count against the channel's
 * limit.
 *
 * A chip editor would be nicer and is not what A4 is for. This is the simplest
 * correct version: it round-trips through one form field, the count tells the
 * creator where they stand, and the requirement engine remains the thing that
 * decides whether the list is acceptable.
 */
export function TagInput({
  name,
  defaultValue,
  minCount,
  maxCount,
  maxTagLength,
  onChange,
  annotation,
}: {
  name: string
  defaultValue: string[]
  minCount?: number
  maxCount?: number
  maxTagLength?: number
  onChange?: (tags: string[]) => void
  /**
   * Rendered beside the label, for a caller that has something to say about
   * where the value came from. A sibling of the label rather than a child, for
   * the same reason the tip is one: a button inside a label steals its name.
   */
  annotation?: ReactNode
}) {
  const [value, setValue] = useState(defaultValue.join(", "))

  const tags = value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const overlong = maxTagLength === undefined ? [] : tags.filter((t) => t.length > maxTagLength)

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-baseline gap-1.5">
        <label htmlFor="listing-tags" className="label-mono">
          Tags
        </label>
        {/* Sibling, not child: a button inside a label steals the label's name. */}
        <InfoTip term="listingTags" />
        {annotation}
      </span>
      <input
        id="listing-tags"
        name={name}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          onChange?.(
            event.target.value
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.length > 0),
          )
        }}
        placeholder="grotesque, sans serif, editorial"
        className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)]"
      />
      <span className="flex flex-wrap gap-x-3 text-[13px] text-[var(--color-ink-3)]">
        <span>Separate with commas.</span>
        <span className="tabular font-mono text-[12px]">
          {tags.length}
          {maxCount !== undefined ? ` / ${maxCount}` : ""}
          {minCount !== undefined && tags.length < minCount ? ` (${minCount} minimum)` : ""}
        </span>
        {overlong.length > 0 ? (
          <span className="text-[var(--color-ink-2)]">
            Over {maxTagLength} characters: {overlong.join(", ")}
          </span>
        ) : null}
      </span>
    </div>
  )
}
