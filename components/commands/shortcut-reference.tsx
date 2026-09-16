"use client"

import { useEffect, useId, useRef } from "react"
import { SEQUENCE_DESTINATIONS } from "@/lib/commands/navigation"
import { isPrintableSingleKey, type Platform } from "@/lib/commands/shortcuts"
import type { CommandScope, FanwiseCommand } from "@/lib/commands/types"
import { Kbd, SequenceKeys, ShortcutKeys } from "./kbd"

/**
 * Every shortcut that is live right now, read from the registry.
 *
 * "Right now" is the point: a product editor's ⌘S is listed while the
 * editor is on screen and not from the catalog, because the list is the
 * registry and the registry is what the keys do. The F sequences come from
 * the same destinations table the guide draws.
 */

const SCOPE_SECTIONS: ReadonlyArray<{ scope: CommandScope; heading: string; note?: string }> = [
  { scope: "global", heading: "Everywhere" },
  { scope: "page", heading: "This page" },
  {
    scope: "selection",
    heading: "Product list",
    note: "While a product in the list has keyboard focus.",
  },
]

export function ShortcutReference({
  open,
  onClose,
  commands,
  platform,
  singleKeysEnabled,
}: {
  open: boolean
  onClose: () => void
  commands: readonly FanwiseCommand[]
  platform: Platform
  singleKeysEnabled: boolean
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const headingId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const sequenceCommands = SEQUENCE_DESTINATIONS.map((destination) => ({
    destination,
    command: commands.find((c) => c.id === destination.commandId),
  }))

  return (
    <dialog
      ref={dialogRef}
      data-command-dialog="reference"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      onClose={() => {
        if (opener.current?.isConnected) opener.current.focus()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close()
      }}
      className="w-[min(640px,calc(100vw-32px))] [margin:8vh_auto_0] rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] p-0 text-[var(--color-ink)] shadow-[0_24px_64px_rgba(4,6,13,0.28)] backdrop:bg-black/40"
    >
      <div className="flex max-h-[84vh] flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-rule)] px-6 py-5">
          <div className="flex flex-col gap-1">
            <h2
              id={headingId}
              className="font-display text-[24px] leading-[1.15] font-light tracking-[-0.02em]"
            >
              Keyboard shortcuts
            </h2>
            <p id={descriptionId} className="text-[14px] text-[var(--color-ink-2)]">
              {singleKeysEnabled
                ? "Single keys work anywhere you are not typing. Turn them off in Settings if they get in the way."
                : "Single-key shortcuts are off in Settings. The command palette and modifier shortcuts still work."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--color-rule)] text-[var(--color-ink-2)] hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="m4 4 8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-7 overflow-y-auto px-6 py-5">
          {SCOPE_SECTIONS.map((section) => {
            const rows = commands.filter(
              (command) => command.scope === section.scope && command.shortcuts?.length,
            )
            if (rows.length === 0) return null
            return (
              <section key={section.scope} className="flex flex-col gap-2">
                <h3 className="label-mono">{section.heading}</h3>
                {section.note ? (
                  <p className="text-[13px] text-[var(--color-ink-3)]">{section.note}</p>
                ) : null}
                <dl className="flex flex-col">
                  {rows.map((command) => {
                    const shortcut = command.shortcuts![0]!
                    const off = !singleKeysEnabled && isPrintableSingleKey(shortcut)
                    return (
                      <div
                        key={command.id}
                        className="flex items-center justify-between gap-4 border-b border-[var(--color-rule-2)] py-2 last:border-b-0"
                      >
                        <dt className={`text-[14px] ${off ? "text-[var(--color-ink-3)]" : ""}`}>
                          {command.label}
                          {off ? <span className="label-mono ml-2">Off</span> : null}
                        </dt>
                        <dd className="flex items-center gap-2">
                          {command.shortcuts!.map((s, index) => (
                            <ShortcutKeys key={index} shortcut={s} platform={platform} />
                          ))}
                          <span className="sr-only">
                            {command.shortcuts!.map((s) => s.key).join(", ")}
                          </span>
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </section>
            )
          })}

          <section className="flex flex-col gap-2">
            <h3 className="label-mono">Fanwise navigation</h3>
            <p className="text-[13px] text-[var(--color-ink-3)]">
              Press <Kbd>F</Kbd> for Fanwise, then one letter.
              {singleKeysEnabled ? "" : " Off while single-key shortcuts are off."}
            </p>
            <dl className="flex flex-col">
              {sequenceCommands.map(({ destination, command }) => (
                <div
                  key={destination.key}
                  className="flex items-center justify-between gap-4 border-b border-[var(--color-rule-2)] py-2 last:border-b-0"
                >
                  <dt className="text-[14px]">{command?.label ?? destination.label}</dt>
                  <dd>
                    <SequenceKeys second={destination.key} />
                    <span className="sr-only">F, then {destination.key.toUpperCase()}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </dialog>
  )
}
