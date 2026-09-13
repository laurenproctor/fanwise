"use client"

import { useId } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { ANALYZING_STAGE_LABELS, type ImportState } from "@/lib/imports/machine"

/**
 * The link, across the top of the screen.
 *
 * One field that changes job rather than two that trade places. Before a source
 * is read it is an editable input with the primary action beside it; afterwards
 * it is the address of what is on screen, shown as text with a state and a way
 * to change it. A field that stayed editable after analysis would invite a
 * creator to retype the URL and wonder why nothing happened.
 *
 * The state word sits next to the address rather than replacing it, so the two
 * questions a creator has here — what did I paste, and what happened to it —
 * are both answered in the same line.
 */

const STATE_WORDS: Record<ImportState["status"], string> = {
  empty: "Not analyzed",
  validating: "Checking the link",
  analyzing: "Analyzing",
  analyzed: "Analyzed",
  private: "Needs permission",
  notFound: "Not found",
  unsupported: "Unsupported",
  failed: "Could not finish",
}

/**
 * The tone of each state, applied to a border and a dot and never to the word
 * itself. docs/design-system.md: state is readable from form as well as colour,
 * and coloured text on paper is the variant that fails a contrast check.
 */
const STATE_TONE: Record<ImportState["status"], string> = {
  empty: "border-[var(--color-rule)] text-[var(--color-ink-3)]",
  validating: "border-[var(--color-accent)] text-[var(--color-ink-2)]",
  analyzing: "border-[var(--color-accent)] text-[var(--color-ink-2)]",
  analyzed: "border-[var(--color-ok)] text-[var(--color-ink)]",
  private: "border-[var(--color-warn)] text-[var(--color-ink)]",
  notFound: "border-[var(--color-warn)] text-[var(--color-ink)]",
  unsupported: "border-[var(--color-warn)] text-[var(--color-ink)]",
  failed: "border-[var(--color-bad)] text-[var(--color-ink)]",
}

const STATE_DOT: Record<ImportState["status"], string> = {
  empty: "bg-[var(--color-ink-3)]",
  validating: "bg-[var(--color-accent)]",
  analyzing: "bg-[var(--color-accent)]",
  analyzed: "bg-[var(--color-ok)]",
  private: "bg-[var(--color-warn)]",
  notFound: "bg-[var(--color-warn)]",
  unsupported: "bg-[var(--color-warn)]",
  failed: "bg-[var(--color-bad)]",
}

export function SourceField({
  state,
  onUrlChange,
  onSubmit,
  onReplaceLink,
  mode = "link",
  canReplaceLink = mode === "link",
}: {
  state: ImportState
  onUrlChange: (url: string) => void
  onSubmit: () => void
  onReplaceLink: () => void
  /**
   * Whether the source is a link or something handed over. A paste or a file
   * shows its name rather than an address, and has no link to replace.
   */
  mode?: "link" | "content"
  /** Offered whenever the import has a link, even alongside other sources. */
  canReplaceLink?: boolean
}) {
  const inputId = useId()
  const hintId = useId()
  const editable = mode === "link" && (state.status === "empty" || state.status === "validating")
  const busy = state.status === "validating" || state.status === "analyzing"

  return (
    <section aria-labelledby={`${inputId}-legend`} className="flex flex-col gap-3">
      <h2 id={`${inputId}-legend`} className="sr-only">
        Product source
      </h2>

      {editable ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
          className="flex flex-col gap-3"
        >
          <label htmlFor={inputId} className="label-mono">
            Product link
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <span className="relative flex min-w-0 flex-1 items-center">
              <LinkGlyph />
              <input
                id={inputId}
                name="sourceUrl"
                type="url"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                required
                disabled={busy}
                aria-describedby={hintId}
                aria-invalid={state.status === "empty" && state.error !== null}
                value={state.url}
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder="https://"
                className="min-h-[52px] w-full rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-[var(--color-card)] py-3 pl-11 pr-4 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-60"
              />
            </span>
            <Button type="submit" disabled={busy} className="min-h-[52px] shrink-0">
              {state.status === "validating" ? "Checking…" : "Analyze product"}
            </Button>
          </div>
          <p id={hintId} className="text-[13px] text-[var(--color-ink-2)]">
            A public link anyone can open. Fanwise reads the page as a visitor would — it never
            signs in, and never asks you for a password to it.
          </p>
          {state.status === "empty" ? <FormError message={state.error} /> : null}
        </form>
      ) : (
        <div className="flex flex-col gap-3 rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-[var(--color-card)] px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:py-2.5 sm:pl-5">
          <span className="flex min-w-0 flex-1 items-center gap-3">
            {mode === "link" ? <LinkGlyph inline /> : <DocumentGlyph />}
            <span className="min-w-0 truncate font-mono text-[13px] text-[var(--color-ink-2)]">
              {state.url}
            </span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-[var(--radius-pill)] border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] ${STATE_TONE[state.status]}`}
            >
              <span
                aria-hidden
                className={`h-[6px] w-[6px] rounded-full ${STATE_DOT[state.status]}`}
              />
              {STATE_WORDS[state.status]}
            </span>
            {canReplaceLink ? (
              <>
                <span aria-hidden className="hidden h-5 w-px bg-[var(--color-rule)] sm:block" />
                <button
                  type="button"
                  onClick={onReplaceLink}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[6px] text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
                >
                  <SwapGlyph />
                  Replace link
                </button>
              </>
            ) : null}
          </span>
        </div>
      )}

      {/*
        One live region for the whole panel. Polite, so a creator typing into
        the field is not interrupted mid-word, and it carries the stage rather
        than a percentage: what is happening is knowable, how far along it is
        is not.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {state.status === "analyzing"
          ? `${ANALYZING_STAGE_LABELS[state.stage]}. Still working.`
          : state.status === "validating"
            ? "Checking the link."
            : `Source ${STATE_WORDS[state.status].toLowerCase()}.`}
      </p>
    </section>
  )
}

function LinkGlyph({ inline = false }: { inline?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={
        inline
          ? "shrink-0 text-[var(--color-ink-3)]"
          : "pointer-events-none absolute left-4 text-[var(--color-ink-3)]"
      }
    >
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

function DocumentGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-[var(--color-ink-3)]"
    >
      <path
        d="M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5M6 8.25h4.5M6 10.75h4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SwapGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 2.5v11M4 2.5 1.8 4.7M4 2.5l2.2 2.2M12 13.5v-11M12 13.5l2.2-2.2M12 13.5l-2.2-2.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
