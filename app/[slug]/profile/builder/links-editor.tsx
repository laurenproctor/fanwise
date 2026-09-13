"use client"

import { useId, useRef, useState } from "react"
import { FIELD_INPUT_CLASS } from "@/components/ui/field"
import { LinkGlyph } from "@/components/public/link-glyph"
import {
  LINK_LABEL_MAX,
  MAX_PROFILE_LINKS,
  checkLinks,
  kindName,
  parseLinkUrl,
  platformOf,
  type DraftLink,
  type LinkIssue,
} from "@/lib/public/profile-links"
import { ErrorGlyph } from "./builder-status"

/**
 * The profile's links: as many as the creator wants to show, up to eight, in
 * the order they choose.
 *
 * Each row is an address and an optional label. The glyph at the start of the
 * row is what the public page will draw, decided by the same parser, so a
 * creator sees the Instagram mark appear as they finish typing the address,
 * and a globe for their own site.
 *
 * Reordering is two buttons per row, Move up and Move down, rather than a drag
 * handle: they work the same with a mouse, a keyboard, a switch or a screen
 * reader, every move is announced with the row's new position, and focus
 * follows the row it moved. Rows are keyed by an id minted here, not by index,
 * so moving a row does not remount its inputs under the cursor.
 */

interface Row extends DraftLink {
  key: string
}

let nextKey = 0
const mint = () => `link-${(nextKey += 1)}`

export function LinksEditor({
  initial,
  serverIssues,
  showAllErrors,
  onChange,
}: {
  initial: readonly DraftLink[]
  /** Problems the server reported at Continue, by row index. */
  serverIssues: readonly LinkIssue[]
  /** True after a Continue attempt: every row's problem shows, touched or not. */
  showAllErrors: boolean
  onChange: (links: DraftLink[]) => void
}) {
  const baseId = useId()
  const [rows, setRows] = useState<Row[]>(() => initial.map((link) => ({ ...link, key: mint() })))
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [announcement, setAnnouncement] = useState("")
  const addButton = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<string | null>(null)

  function commit(next: Row[], message?: string) {
    setRows(next)
    if (message) setAnnouncement(message)
    onChange(next.map(({ url, label }) => ({ url, label })))
  }

  const focusRef = (id: string) => (node: HTMLElement | null) => {
    if (node && pendingFocus.current === id) {
      pendingFocus.current = null
      node.focus()
    }
  }

  function add() {
    if (rows.length >= MAX_PROFILE_LINKS) return
    const row = { key: mint(), url: "", label: "" }
    pendingFocus.current = `${row.key}-url`
    commit([...rows, row], `Link ${rows.length + 1} added.`)
  }

  function remove(index: number) {
    const row = rows[index]!
    const next = rows.filter((_, i) => i !== index)
    const following = next[index] ?? next[index - 1]
    if (following) pendingFocus.current = `${following.key}-url`
    else addButton.current?.focus()
    const parsed = parseLinkUrl(row.url)
    const name = parsed.kind === "valid" ? `${kindName(platformOf(parsed.url))} link` : "Link"
    commit(next, `${name} removed. ${next.length} of ${MAX_PROFILE_LINKS} links.`)
  }

  function move(index: number, delta: -1 | 1) {
    const to = index + delta
    if (to < 0 || to >= rows.length) return
    const next = rows.slice()
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved!)
    // Focus stays on the button that was pressed, on the row that moved. At
    // the end of the list that button is now disabled, so the other one takes it.
    const atEnd = delta === -1 ? to === 0 : to === next.length - 1
    const pressed = delta === -1 ? "up" : "down"
    const other = delta === -1 ? "down" : "up"
    pendingFocus.current = `${moved!.key}-${atEnd ? other : pressed}`
    commit(next, `Link moved to position ${to + 1} of ${next.length}.`)
  }

  function update(index: number, patch: Partial<DraftLink>) {
    commit(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const localIssues = checkLinks(rows)
  const issueFor = (index: number, field: "url" | "label", key: string): string | null => {
    const server = serverIssues.find((issue) => issue.index === index && issue.field === field)
    if (server) return server.message
    if (!showAllErrors && !touched.has(`${key}-${field}`)) return null
    return (
      localIssues.find((issue) => issue.index === index && issue.field === field)?.message ?? null
    )
  }
  const touch = (id: string) =>
    setTouched((current) => (current.has(id) ? current : new Set(current).add(id)))

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-[14px] text-[var(--color-ink)]">Links (optional)</legend>
      <p id={`${baseId}-hint`} className="-mt-1 text-[13px] text-[var(--color-ink-3)]">
        Your website, portfolio or social profiles, in the order you want them. Up to{" "}
        {MAX_PROFILE_LINKS}. Leave a label empty to use the site&rsquo;s name.
      </p>

      {rows.length > 0 ? (
        <ol className="flex flex-col gap-3" aria-describedby={`${baseId}-hint`}>
          {rows.map((row, index) => {
            const parsed = parseLinkUrl(row.url)
            const kind = parsed.kind === "valid" ? platformOf(parsed.url) : "website"
            const urlId = `${baseId}-${row.key}-url`
            const labelId = `${baseId}-${row.key}-label`
            const urlError = issueFor(index, "url", row.key)
            const labelError = issueFor(index, "label", row.key)
            const position = `link ${index + 1}`
            return (
              <li
                key={row.key}
                data-link-row
                className="flex flex-col gap-3 rounded-[12px] border border-[var(--color-rule)] p-3 sm:p-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-rule)] text-[var(--color-ink)]"
                  >
                    <LinkGlyph kind={kind} />
                  </span>
                  <span className="label-mono min-w-0 flex-1">
                    Link {index + 1}
                    {parsed.kind === "valid" ? ` · ${kindName(kind)}` : ""}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      ref={focusRef(`${row.key}-up`)}
                      label={`Move ${position} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <path d="M12 19V5M6 11l6-6 6 6" />
                    </IconButton>
                    <IconButton
                      ref={focusRef(`${row.key}-down`)}
                      label={`Move ${position} down`}
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <path d="M12 5v14M6 13l6 6 6-6" />
                    </IconButton>
                    <IconButton label={`Remove ${position}`} onClick={() => remove(index)}>
                      <path d="M6 6l12 12M18 6 6 18" />
                    </IconButton>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label htmlFor={urlId} className="text-[13px] text-[var(--color-ink-2)]">
                      Address
                    </label>
                    <input
                      ref={focusRef(`${row.key}-url`)}
                      id={urlId}
                      // The visible label, plus which row, so eight "Address" fields are told apart.
                      aria-label={`Address, ${position}`}
                      type="text"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={2048}
                      placeholder="yourstudio.com"
                      value={row.url}
                      onChange={(event) => update(index, { url: event.target.value })}
                      onBlur={() => touch(`${row.key}-url`)}
                      aria-invalid={urlError ? true : undefined}
                      aria-describedby={urlError ? `${urlId}-error` : undefined}
                      className={`${FIELD_INPUT_CLASS} aria-[invalid=true]:border-[var(--color-bad)]`}
                    />
                    <RowError id={`${urlId}-error`} message={urlError} />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label htmlFor={labelId} className="text-[13px] text-[var(--color-ink-2)]">
                      Label (optional)
                    </label>
                    <input
                      id={labelId}
                      aria-label={`Label (optional), ${position}`}
                      type="text"
                      maxLength={LINK_LABEL_MAX}
                      placeholder={parsed.kind === "valid" ? parsed.label : "Portfolio"}
                      value={row.label}
                      onChange={(event) => update(index, { label: event.target.value })}
                      onBlur={() => touch(`${row.key}-label`)}
                      aria-invalid={labelError ? true : undefined}
                      aria-describedby={labelError ? `${labelId}-error` : undefined}
                      className={`${FIELD_INPUT_CLASS} aria-[invalid=true]:border-[var(--color-bad)]`}
                    />
                    <RowError id={`${labelId}-error`} message={labelError} />
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          ref={addButton}
          type="button"
          onClick={add}
          disabled={rows.length >= MAX_PROFILE_LINKS}
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-4 text-[14px] text-[var(--color-ink)] hover:border-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add link
        </button>
        <span className="tabular text-[13px] text-[var(--color-ink-3)]">
          {rows.length} of {MAX_PROFILE_LINKS}
        </span>
      </div>

      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </fieldset>
  )
}

function IconButton({
  label,
  disabled = false,
  onClick,
  children,
  ref,
}: React.PropsWithChildren<{
  label: string
  disabled?: boolean
  onClick: () => void
  ref?: React.Ref<HTMLButtonElement>
}>) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-ink-2)] hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  )
}

function RowError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null
  return (
    <p id={id} className="flex items-center gap-2 text-[13px] text-[var(--color-ink)]">
      <ErrorGlyph />
      {message}
    </p>
  )
}
