"use client"

import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import type { SectionStatus } from "@/lib/fonts/readiness"

/** Whether the section a control sits in is the one on screen. */
export const ActiveSectionContext = createContext(true)

/**
 * The workspace's form vocabulary.
 *
 * Sentence-case labels at body size rather than the mono eyebrow the older
 * product form uses: this screen is a long run of related fields, and a column
 * of uppercase eyebrows reads as shouting. The input box is the same one every
 * other form uses, so the two screens still feel like one product.
 */

export const INPUT_CLASS =
  "w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2 " +
  "text-[14.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] " +
  "focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent-soft)] " +
  "aria-[invalid=true]:border-[var(--color-danger)] disabled:opacity-60"

export const QUIET_BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-rule)] " +
  "bg-transparent px-3.5 text-[13.5px] text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-3)] " +
  "hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"

export const LINK_BUTTON_CLASS =
  "inline-flex items-center gap-1 rounded-[4px] text-[13.5px] text-[var(--color-accent)] underline-offset-4 " +
  "hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"

export function FieldShell({
  id,
  label,
  hint,
  error,
  badge,
  children,
  className = "",
}: {
  id: string
  label: string
  hint?: ReactNode
  error?: string | null
  /** Beside the label: where a value came from, or which record it changes. */
  badge?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <label htmlFor={id} className="text-[14px] text-[var(--color-ink)]">
          {label}
        </label>
        {badge}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] text-[var(--color-danger)]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-[var(--color-ink-3)]">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function describedBy(id: string, error?: string | null, hint?: unknown) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined
}

export function TextInput({
  id,
  label,
  hint,
  error,
  badge,
  className,
  ...props
}: ComponentProps<"input"> & {
  id: string
  label: string
  hint?: ReactNode
  error?: string | null
  badge?: ReactNode
}) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} badge={badge} className={className}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={INPUT_CLASS}
        {...props}
      />
    </FieldShell>
  )
}

export function TextArea({
  id,
  label,
  hint,
  error,
  badge,
  className,
  ...props
}: ComponentProps<"textarea"> & {
  id: string
  label: string
  hint?: ReactNode
  error?: string | null
  badge?: ReactNode
}) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} badge={badge} className={className}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${INPUT_CLASS} leading-[1.5]`}
        {...props}
      />
    </FieldShell>
  )
}

/**
 * A short list of words entered as chips.
 *
 * Enter or comma adds, Backspace on an empty field removes the last, and every
 * chip has its own remove button with a name, so the list is fully usable from
 * a keyboard and a screen reader announces what each button removes.
 */
export function ChipsInput({
  id,
  label,
  values,
  onChange,
  suggestions = [],
  hint,
  badge,
  placeholder,
  maxLength = 64,
}: {
  id: string
  label: string
  values: readonly string[]
  onChange: (values: string[]) => void
  suggestions?: readonly string[]
  hint?: ReactNode
  badge?: ReactNode
  placeholder?: string
  maxLength?: number
}) {
  const [draft, setDraft] = useState("")
  const listId = useId()

  function add(raw: string) {
    const value = raw.trim().slice(0, maxLength)
    if (!value) return
    if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setDraft("")
      return
    }
    onChange([...values, value])
    setDraft("")
  }

  return (
    <FieldShell id={id} label={label} hint={hint} badge={badge}>
      <div
        className={`${INPUT_CLASS} flex min-h-[42px] flex-wrap items-center gap-1.5 py-1.5 focus-within:border-[var(--color-accent)] focus-within:ring-2 focus-within:ring-[var(--color-accent-soft)]`}
      >
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--color-paper-2)] py-0.5 pr-1 pl-2.5 text-[13.5px]"
          >
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((v) => v !== value))}
              className="grid h-5 w-5 place-items-center rounded-full text-[var(--color-ink-3)] hover:bg-[var(--color-rule)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            >
              <span aria-hidden>×</span>
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          list={suggestions.length > 0 ? listId : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          placeholder={values.length === 0 ? placeholder : undefined}
          onChange={(event) => {
            const next = event.target.value
            if (next.endsWith(",")) add(next.slice(0, -1))
            else setDraft(next)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              add(draft)
            } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => add(draft)}
          className="min-w-[8ch] flex-1 bg-transparent py-0.5 text-[14.5px] outline-none placeholder:text-[var(--color-ink-3)]"
        />
        {suggestions.length > 0 ? (
          <datalist id={listId}>
            {suggestions
              .filter((s) => !values.includes(s))
              .map((s) => (
                <option key={s} value={s} />
              ))}
          </datalist>
        ) : null}
      </div>
    </FieldShell>
  )
}

/** A switch, as a checkbox with role="switch" so its state is announced as on or off. */
export function Toggle({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3">
      <span className="relative inline-flex">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-describedby={description ? `${id}-description` : undefined}
        />
        <span
          aria-hidden
          className="h-6 w-10 rounded-full bg-[var(--color-rule)] transition-colors peer-checked:bg-[var(--color-accent)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-accent)]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full border border-[var(--color-rule)] bg-[var(--color-card)] transition-transform peer-checked:translate-x-4"
        />
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] text-[var(--color-ink)]">{label}</span>
        {description ? (
          <span id={`${id}-description`} className="text-[12.5px] text-[var(--color-ink-3)]">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

/** Where a value came from. Words first; the colour only reinforces them. */
export function OriginBadge({ origin }: { origin: "detected" | "product" | "channel" | "edited" }) {
  const text = {
    detected: "Detected from files",
    product: "From the product",
    channel: "Only this channel",
    edited: "Edited",
  }[origin]
  return (
    <span
      className={`font-mono text-[10px] tracking-[0.12em] uppercase ${
        origin === "channel" ? "text-[var(--color-accent)]" : "text-[var(--color-ink-3)]"
      }`}
    >
      {text}
    </span>
  )
}

export const STATUS_TEXT: Record<SectionStatus, string> = {
  complete: "Complete",
  incomplete: "Incomplete",
  attention: "Needs attention",
  error: "Blocking error",
}

/**
 * A section or rule state as an icon with a spoken name.
 *
 * Form carries the state as well as colour: a tick, an empty ring, an
 * exclamation mark, a cross. Someone who cannot tell the green from the amber
 * can still tell a tick from a ring.
 */
export function StatusIcon({
  status,
  size = 20,
  announce = true,
}: {
  status: SectionStatus
  size?: number
  /**
   * Whether the icon speaks its status. Off where the caller says the status
   * itself, after the thing it describes, so a control is named "Font files,
   * incomplete" rather than "Incomplete Font files".
   */
  announce?: boolean
}) {
  const common = { width: size, height: size, viewBox: "0 0 20 20", "aria-hidden": true } as const
  const icon =
    status === "complete" ? (
      <svg {...common}>
        <path
          d="M4.5 10.5l3.5 3.5 7.5-8"
          fill="none"
          stroke="var(--color-ok)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : status === "incomplete" ? (
      <svg {...common}>
        <circle cx="10" cy="10" r="8" fill="none" stroke="var(--color-ink-3)" strokeWidth="1.5" />
      </svg>
    ) : status === "attention" ? (
      <svg {...common}>
        <circle cx="10" cy="10" r="9" fill="var(--color-warn)" />
        <path d="M10 5.5v5.5" stroke="var(--color-void)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="1.15" fill="var(--color-void)" />
      </svg>
    ) : (
      <svg {...common}>
        <circle cx="10" cy="10" r="9" fill="var(--color-danger)" />
        <path
          d="M7 7l6 6M13 7l-6 6"
          stroke="var(--color-on-danger)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )

  return (
    <span className="inline-flex shrink-0 items-center">
      {icon}
      {announce ? <span className="sr-only">{STATUS_TEXT[status]}</span> : null}
    </span>
  )
}

export function SectionHeading({
  title,
  description,
  aside,
}: {
  title: string
  description: string
  aside?: ReactNode
}) {
  // Every section stays mounted; only the open one's heading carries the id the
  // editor region is labelled by and focus returns to.
  const active = useContext(ActiveSectionContext)
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          id={active ? "font-section-heading" : undefined}
          tabIndex={-1}
          className="font-display text-[26px] font-light tracking-[-0.02em] outline-none"
        >
          {title}
        </h2>
        <p className="text-[14px] text-[var(--color-ink-2)]">{description}</p>
      </div>
      {aside}
    </div>
  )
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
