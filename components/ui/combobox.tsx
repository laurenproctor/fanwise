"use client"

import { useEffect, useId, useRef, useState } from "react"
import { FIELD_INPUT_CLASS } from "./field"

/**
 * A text field that suggests values and commits only a chosen one.
 *
 * The ARIA 1.2 combobox pattern: the input is the `combobox`, it owns a
 * `listbox` of `option`s, and the active option is `aria-activedescendant`,
 * so focus never leaves the text field and a screen reader follows the
 * highlight. Keyboard:
 *
 *   - ArrowDown / ArrowUp open the list and move through it, wrapping;
 *   - Enter chooses the highlighted option;
 *   - Escape closes the list, and a second Escape puts back the chosen value;
 *   - Tab leaves without choosing anything.
 *
 * Typing never commits a value by itself. The parent is told about the text
 * (`onQueryChange`, for a remote search) and about a choice (`onSelect`), and
 * those are different events. When focus leaves with text that is not a
 * choice, an exact match is taken; anything else puts the chosen value back
 * and says why, so a half-typed city is never quietly stored and never quietly
 * discarded. Emptying the field is a choice too: it clears the value.
 *
 * Loading, no results and a failed search are rows in the popup and are
 * announced in a polite live region, so a sighted keyboard user and a screen
 * reader user learn the same thing at the same moment.
 */

export interface ComboboxOption {
  value: string
  label: string
  /** A second, quieter line: the region that tells two Springfields apart. */
  detail?: string | null
}

export type ComboboxStatus = "idle" | "loading" | "error"

export function Combobox({
  id,
  label,
  hint,
  error,
  placeholder,
  disabled = false,
  selected,
  options,
  status = "idle",
  minQueryLength = 0,
  emptyMessage,
  errorMessage = "Suggestions couldn't load.",
  noun,
  onQueryChange,
  onSelect,
  onRetry,
}: {
  id?: string
  label: string
  hint?: string
  error?: string | null
  placeholder?: string
  disabled?: boolean
  /** The committed value, or null. Its label is what the field shows at rest. */
  selected: ComboboxOption | null
  options: readonly ComboboxOption[]
  status?: ComboboxStatus
  /** Text shorter than this shows no list (a remote search that needs a letter). */
  minQueryLength?: number
  emptyMessage: string
  errorMessage?: string
  /** "country", "city": used in the messages this component writes itself. */
  noun: string
  onQueryChange?: (query: string) => void
  onSelect: (option: ComboboxOption | null) => void
  onRetry?: () => void
}) {
  const generated = useId()
  const inputId = id ?? `${generated}-input`
  const listId = `${generated}-list`
  const hintId = `${generated}-hint`
  const errorId = `${generated}-error`
  const statusId = `${generated}-status`

  const selectedLabel = selected?.label ?? ""
  const [text, setText] = useState(selectedLabel)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)

  // The chosen value changed from outside (a choice landed, a parent cleared
  // it): show it, unless the creator is mid-edit. Adjusted during render, the
  // React way to follow a prop without an effect.
  const [shownSelection, setShownSelection] = useState(selectedLabel)
  if (shownSelection !== selectedLabel) {
    setShownSelection(selectedLabel)
    if (!editing) setText(selectedLabel)
  }

  const queryReady = text.trim().length >= minQueryLength
  const showList = open && !disabled && queryReady
  const activeOption = showList && active >= 0 ? options[active] : undefined

  useEffect(() => {
    if (!activeOption) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    node?.scrollIntoView({ block: "nearest" })
  }, [active, activeOption])

  function choose(option: ComboboxOption | null) {
    setText(option?.label ?? "")
    setOpen(false)
    setActive(-1)
    setEditing(false)
    setNotice(null)
    onSelect(option)
  }

  function onChange(value: string) {
    setText(value)
    setEditing(true)
    setOpen(true)
    setActive(-1)
    setNotice(null)
    onQueryChange?.(value)
    if (value.trim().length === 0 && selected) onSelect(null)
  }

  function settle() {
    setOpen(false)
    setActive(-1)
    setEditing(false)
    const typed = text.trim()
    if (typed === selectedLabel) return
    if (typed.length === 0) {
      if (selected) onSelect(null)
      setText("")
      return
    }
    const fold = (value: string) =>
      value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
    const exact = options.filter((option) => fold(option.label) === fold(typed))
    if (exact.length === 1) {
      choose(exact[0]!)
      return
    }
    setText(selectedLabel)
    setNotice(
      selected
        ? `“${typed}” isn’t one of the suggestions, so ${selectedLabel} is still your ${noun}.`
        : `“${typed}” isn’t one of the suggestions. Choose a ${noun} from the list.`,
    )
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault()
        if (!open) {
          setOpen(true)
          setActive(options.length > 0 ? (event.key === "ArrowDown" ? 0 : options.length - 1) : -1)
          return
        }
        if (options.length === 0) return
        const step = event.key === "ArrowDown" ? 1 : -1
        setActive((current) => (current + step + options.length) % options.length)
        return
      }
      case "Enter":
        if (showList && activeOption) {
          event.preventDefault()
          choose(activeOption)
        }
        return
      case "Escape":
        if (open) {
          event.preventDefault()
          setOpen(false)
          setActive(-1)
        } else if (text !== selectedLabel) {
          event.preventDefault()
          setText(selectedLabel)
          setEditing(false)
        }
        return
      case "Tab":
        setOpen(false)
        return
    }
  }

  const live = !showList
    ? ""
    : status === "loading"
      ? "Loading suggestions…"
      : status === "error"
        ? errorMessage
        : options.length === 0
          ? emptyMessage
          : `${options.length} ${options.length === 1 ? "suggestion" : "suggestions"}. Use the arrow keys to choose.`

  const message = error ?? notice
  const describedBy = [hint ? hintId : null, message ? errorId : null].filter(Boolean).join(" ")

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={inputId} className="text-[14px] text-[var(--color-ink)]">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${listId}-${active}` : undefined}
          aria-invalid={message ? true : undefined}
          aria-describedby={describedBy || undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setNotice(null)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={settle}
          className={`${FIELD_INPUT_CLASS} pr-10 disabled:cursor-not-allowed disabled:bg-[var(--color-paper-2)] disabled:text-[var(--color-ink-3)] aria-[invalid=true]:border-[var(--color-bad)]`}
        />
        {selected && !disabled ? (
          <button
            type="button"
            aria-label={`Clear ${noun}`}
            // Keeps focus in the field, so the blur that would settle a
            // half-typed value does not run before the clear.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(null)}
            className="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
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
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}

        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          hidden={!showList}
          className="absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-[264px] overflow-auto rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] py-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.25)]"
        >
          {status === "loading" && options.length === 0 ? (
            <li role="presentation" className="px-3 py-2.5 text-[14px] text-[var(--color-ink-3)]">
              Loading…
            </li>
          ) : status === "error" ? (
            <li
              role="presentation"
              className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[14px] text-[var(--color-ink)]"
            >
              {errorMessage}
              {onRetry ? (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onRetry}
                  className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  Try again
                </button>
              ) : null}
            </li>
          ) : options.length === 0 ? (
            <li role="presentation" className="px-3 py-2.5 text-[14px] text-[var(--color-ink-3)]">
              {emptyMessage}
            </li>
          ) : (
            options.map((option, index) => (
              <li
                key={`${option.value}-${index}`}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === active}
                // Chosen on mousedown's click without stealing focus from the field.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                onMouseMove={() => setActive(index)}
                className={`flex cursor-pointer flex-col px-3 py-2 text-[15px] ${
                  index === active ? "bg-[var(--color-paper-2)]" : ""
                }`}
              >
                <span className="text-[var(--color-ink)]">{option.label}</span>
                {option.detail ? (
                  <span className="text-[13px] text-[var(--color-ink-3)]">{option.detail}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
      <span id={statusId} aria-live="polite" className="sr-only">
        {live}
      </span>
      {hint ? (
        <span id={hintId} className="text-[13px] text-[var(--color-ink-3)]">
          {hint}
        </span>
      ) : null}
      {message ? (
        <p id={errorId} className="flex items-start gap-2 text-[13px] text-[var(--color-ink)]">
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            width="14"
            height="14"
            className="mt-[2px] shrink-0 text-[var(--color-bad)]"
            fill="currentColor"
          >
            <circle cx="8" cy="8" r="7" />
            <path
              d="M8 4.5v4.2M8 11.2v.1"
              stroke="var(--color-card)"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          {message}
        </p>
      ) : null}
    </div>
  )
}
