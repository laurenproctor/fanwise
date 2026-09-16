"use client"

import { useSyncExternalStore } from "react"
import {
  readPaletteOpened,
  subscribePreferences,
  writePaletteOpened,
} from "@/lib/commands/preferences"
import { ariaKeyShortcuts, formatShortcut } from "@/lib/commands/shortcuts"
import { PALETTE_SHORTCUT } from "@/lib/commands/workspace"
import { useCommandCenter } from "./command-provider"
import { Kbd } from "./kbd"

/**
 * "Commands ⌘K" in the workspace header, and the one-time "Try ⌘K" beside it.
 *
 * Desktop only: on a phone there is no ⌘ to print and the palette is
 * reached through the header's own links instead. The keycap says ⌘ or
 * Ctrl for the machine it is on, and says nothing at all until the browser
 * has said which — a server render does not know, and guessing wrong would
 * flash the wrong key at every Mac.
 *
 * The hint retires itself the first time the palette opens, by any route,
 * and can be dismissed by hand. It is never shown a second time.
 */
export function CommandsButton() {
  const center = useCommandCenter()
  const opened = useSyncExternalStore(subscribePreferences, readPaletteOpened, () => true)
  if (!center) return null

  const platform = center.platform
  const showHint = !opened && platform !== null

  return (
    <span className="relative hidden lg:inline-flex">
      <button
        type="button"
        onClick={center.openPalette}
        aria-keyshortcuts={platform ? ariaKeyShortcuts(PALETTE_SHORTCUT, platform) : undefined}
        aria-haspopup="dialog"
        aria-expanded={center.paletteOpen}
        title={platform ? `Commands (${formatShortcut(PALETTE_SHORTCUT, platform)})` : "Commands"}
        className="inline-flex min-h-[38px] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-transparent px-3.5 text-[13px] font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
      >
        Commands
        {platform ? (
          <Kbd className="text-[var(--color-ink-3)]">
            {formatShortcut(PALETTE_SHORTCUT, platform)}
          </Kbd>
        ) : null}
      </button>

      {showHint ? (
        <span
          role="note"
          className="absolute top-[calc(100%+8px)] right-0 z-30 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-[var(--color-card)] py-1 pr-1 pl-3 text-[12px] whitespace-nowrap text-[var(--color-ink-2)] shadow-[0_8px_24px_rgba(4,6,13,0.12)]"
        >
          Try <Kbd>{formatShortcut(PALETTE_SHORTCUT, platform)}</Kbd>
          <button
            type="button"
            onClick={() => writePaletteOpened()}
            aria-label="Dismiss this hint"
            className="grid h-6 w-6 place-items-center rounded-[var(--radius-pill)] text-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="m4 4 8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </span>
      ) : null}
    </span>
  )
}
