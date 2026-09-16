"use client"

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { flattenSections, searchCommands } from "@/lib/commands/search"
import type { Platform } from "@/lib/commands/shortcuts"
import type { FanwiseCommand, InvocationMethod } from "@/lib/commands/types"
import { readRecentProducts, subscribePreferences } from "@/lib/commands/preferences"
import { Kbd, ShortcutKeys } from "./kbd"

/**
 * The command palette: ⌘K, type, Enter.
 *
 * A native <dialog> opened with showModal(), as the delete confirmation and
 * the profile's Publish all are, so the browser does the focus trapping and
 * the rest of the page is inert while it is up. The search field is an ARIA
 * combobox over a listbox: focus stays in the field, the highlighted row is
 * `aria-activedescendant`, and a screen reader follows the highlight
 * without focus ever leaving the text.
 *
 * Whatever opened it gets focus back. The element that was focused is
 * remembered at open and focused at close; when a command runs, that
 * happens before the command does, so a command that moves focus itself
 * (`/`, to the search box) is not undone a tick later by the restore.
 */

const SUGGESTED_PREFIX = "product.open:"

export function CommandPalette({
  open,
  onClose,
  commands,
  platform,
  run,
  workspaceSlug,
}: {
  open: boolean
  onClose: () => void
  commands: readonly FanwiseCommand[]
  platform: Platform
  run: (command: FanwiseCommand, method: InvocationMethod) => void
  workspaceSlug?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const restoreOnClose = useRef(true)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const ids = useId()
  const listId = `${ids}-list`
  const headingId = `${ids}-heading`
  const descriptionId = `${ids}-description`

  const recent = useSyncExternalStore(
    subscribePreferences,
    () => (workspaceSlug ? readRecentProducts(workspaceSlug).join("\n") : ""),
    () => "",
  )
  const suggested = useMemo(
    () => (recent ? recent.split("\n").map((slug) => `${SUGGESTED_PREFIX}${slug}`) : []),
    [recent],
  )

  const sections = useMemo(
    () => searchCommands(commands, query, { suggested }),
    [commands, query, suggested],
  )
  const rows = useMemo(() => flattenSections(sections), [sections])
  const activeIndex = rows.length === 0 ? -1 : Math.min(active, rows.length - 1)
  const activeCommand = activeIndex >= 0 ? rows[activeIndex] : undefined

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      restoreOnClose.current = true
      dialog.showModal()
      inputRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  // The highlighted row is kept in view as the arrow keys walk the list.
  useEffect(() => {
    if (!open || !activeCommand) return
    document
      .getElementById(optionId(listId, activeCommand.id))
      ?.scrollIntoView({ block: "nearest" })
  }, [open, activeCommand, listId])

  function handleClosed() {
    if (restoreOnClose.current && opener.current?.isConnected) opener.current.focus()
    restoreOnClose.current = true
    setQuery("")
    setActive(0)
    onClose()
  }

  function execute(command: FanwiseCommand) {
    if (!command.enabled) return
    restoreOnClose.current = false
    dialogRef.current?.close()
    if (opener.current?.isConnected) opener.current.focus()
    run(command, "palette")
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        if (rows.length) setActive((activeIndex + 1) % rows.length)
        break
      case "ArrowUp":
        event.preventDefault()
        if (rows.length) setActive((activeIndex - 1 + rows.length) % rows.length)
        break
      case "Home":
        if (query === "") {
          event.preventDefault()
          setActive(0)
        }
        break
      case "End":
        if (query === "") {
          event.preventDefault()
          setActive(Math.max(0, rows.length - 1))
        }
        break
      case "Enter":
        event.preventDefault()
        if (activeCommand) execute(activeCommand)
        break
      default:
        break
    }
  }

  const count = rows.length
  const countSentence =
    count === 0 ? "No commands match." : count === 1 ? "1 command." : `${count} commands.`

  return (
    <dialog
      ref={dialogRef}
      data-command-dialog="palette"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      onClose={handleClosed}
      onClick={(event) => {
        // The backdrop is the dialog's own box outside its content.
        if (event.target === event.currentTarget) dialogRef.current?.close()
      }}
      className="w-[min(620px,calc(100vw-32px))] [margin:10vh_auto_0] rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] p-0 text-[var(--color-ink)] shadow-[0_24px_64px_rgba(4,6,13,0.28)] backdrop:bg-black/40"
    >
      <div className="flex flex-col" onClick={(event) => event.stopPropagation()}>
        <h2 id={headingId} className="sr-only">
          Commands
        </h2>
        <p id={descriptionId} className="sr-only">
          Search for a command, then press Enter to run it. Use the arrow keys to move through the
          results and Escape to close.
        </p>

        <div className="relative flex items-center border-b border-[var(--color-rule)]">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeCommand ? optionId(listId, activeCommand.id) : undefined}
            aria-label="Search commands"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Type a command, a product, or a page"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            className="min-h-[56px] w-full bg-transparent py-3 pr-4 pl-11 text-[16px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)]"
          />
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {countSentence}
        </p>

        <div
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="max-h-[min(60vh,480px)] overflow-y-auto p-2"
        >
          {rows.length === 0 ? (
            <div className="flex flex-col gap-1 px-3 py-8 text-center">
              <p className="font-display text-[18px] font-light tracking-[-0.02em]">
                Nothing matches &ldquo;{query.trim()}&rdquo;.
              </p>
              <p className="text-[14px] text-[var(--color-ink-2)]">
                Try a product&rsquo;s name, or a page: products, channels, profile, settings.
              </p>
            </div>
          ) : (
            sections.map((section) => (
              <div
                key={section.group}
                role="group"
                aria-labelledby={`${listId}-${section.group}`}
                className="pb-1"
              >
                <div id={`${listId}-${section.group}`} className="label-mono px-3 pt-3 pb-1.5">
                  {section.label}
                </div>
                {section.commands.map((command) => {
                  const isActive = command === activeCommand
                  const shortcut = command.shortcuts?.[0]
                  return (
                    <div
                      key={command.id}
                      id={optionId(listId, command.id)}
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={command.enabled ? undefined : true}
                      onMouseMove={() => {
                        const index = rows.indexOf(command)
                        if (index !== activeIndex) setActive(index)
                      }}
                      onClick={() => execute(command)}
                      className={`flex cursor-default items-center gap-3 rounded-[10px] px-3 py-2.5 ${
                        isActive
                          ? "bg-[var(--color-paper-2)] outline-2 -outline-offset-2 outline-[var(--color-accent)]"
                          : ""
                      } ${command.enabled ? "" : "text-[var(--color-ink-3)]"}`}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-2 text-[15px]">
                          <span className="truncate">{command.label}</span>
                          {!command.enabled ? (
                            <span className="label-mono text-[var(--color-ink-3)]">
                              Unavailable
                            </span>
                          ) : null}
                        </span>
                        {!command.enabled && command.disabledReason ? (
                          <span className="text-[13px] leading-[1.4] text-[var(--color-ink-2)]">
                            {command.disabledReason}
                          </span>
                        ) : command.description ? (
                          <span className="truncate text-[13px] text-[var(--color-ink-3)]">
                            {command.description}
                          </span>
                        ) : null}
                      </span>
                      {shortcut ? <ShortcutKeys shortcut={shortcut} platform={platform} /> : null}
                      <span
                        aria-hidden="true"
                        className={`w-3 text-[var(--color-ink-3)] ${isActive ? "" : "invisible"}`}
                      >
                        ›
                      </span>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-rule)] px-4 py-2.5 text-[12px] text-[var(--color-ink-3)]">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Enter</Kbd> run
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </div>
    </dialog>
  )
}

function optionId(listId: string, commandId: string): string {
  return `${listId}-${commandId.replace(/[^a-zA-Z0-9_-]/g, "_")}`
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="pointer-events-none absolute left-4 text-[var(--color-ink-3)]"
    >
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
