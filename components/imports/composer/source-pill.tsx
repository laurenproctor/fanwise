"use client"

import { PILL_STATUS_WORDS, pillTone, type ComposerSource } from "@/lib/imports/composer"

/**
 * One source in the composer: what it is, what it is called, what is true of
 * it now, and a way to take it out.
 *
 * The status is a word beside a dot, never the dot alone. The name is cut
 * visually and kept whole for assistive technology and in the tooltip, so
 * `brand-guidelines-final-v3.pdf` is still findable when it does not fit.
 */

const DOT: Record<ReturnType<typeof pillTone>, string> = {
  ok: "bg-[var(--color-ok)]",
  busy: "bg-[var(--color-accent)]",
  bad: "bg-[var(--color-bad)]",
}

export function SourcePill({
  source,
  onRemove,
  onRetry,
}: {
  source: ComposerSource
  onRemove: () => void
  onRetry: (() => void) | null
}) {
  const word = PILL_STATUS_WORDS[source.status]
  const tone = pillTone(source.status)
  const message = source.type === "link" ? null : source.message
  const messageId = `${source.key}-message`

  return (
    <li
      className={`flex max-w-full flex-col gap-1 rounded-[14px] border bg-[var(--color-card)] py-1 pl-3.5 pr-1 ${
        tone === "bad" ? "border-[var(--color-bad)]" : "border-[var(--color-rule)]"
      }`}
    >
      <span className="flex min-h-11 min-w-0 items-center gap-3">
        <SourceGlyph type={source.type} />
        <span
          title={source.label}
          className="min-w-0 max-w-[22ch] truncate text-[14px] text-[var(--color-ink)]"
        >
          {source.label}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--color-ink-2)]">
          <span
            aria-hidden
            className={`h-[6px] w-[6px] rounded-full ${DOT[tone]} ${
              tone === "busy" ? "animate-pulse motion-reduce:animate-none" : ""
            }`}
          />
          {word}
        </span>
        <span aria-hidden className="h-5 w-px shrink-0 bg-[var(--color-rule)]" />
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            aria-label={`Retry ${source.label}`}
            className="grid h-11 shrink-0 place-items-center rounded-[10px] px-2 text-[13px] font-medium text-[var(--color-accent)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
          >
            Retry
          </button>
        ) : null}
        <button
          type="button"
          data-remove
          onClick={onRemove}
          aria-label={`Remove ${source.label}`}
          aria-describedby={message ? messageId : undefined}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-[var(--color-ink-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2.5 2.5l7 7M9.5 2.5l-7 7"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </span>
      {message ? (
        <span
          id={messageId}
          className="max-w-[44ch] pb-2 pr-3 text-[13px] leading-[1.45] text-[var(--color-ink-2)]"
        >
          {message}
        </span>
      ) : null}
    </li>
  )
}

export function SourceGlyph({
  type,
}: {
  type: "link" | "public_url" | "pdf" | "html" | "audio" | "pasted_text"
}) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": true,
    className: "shrink-0 text-[var(--color-ink)]",
  } as const
  if (type === "link" || type === "public_url") {
    return (
      <svg {...common}>
        <path
          d="M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-.8.8M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l.8-.8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (type === "audio") {
    return (
      <svg {...common}>
        <rect
          x="5.5"
          y="1.75"
          width="5"
          height="8"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M3.25 7.5a4.75 4.75 0 0 0 9.5 0M8 12.25v2"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (type === "pasted_text") {
    return (
      <svg {...common}>
        <path
          d="M3 4h10M3 7h10M3 10h7M3 13h5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path
        d="M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {type === "html" ? (
        <path
          d="M6.5 8.5 5.25 10l1.25 1.5M9.5 8.5l1.25 1.5-1.25 1.5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  )
}
