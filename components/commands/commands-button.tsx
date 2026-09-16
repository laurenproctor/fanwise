"use client"

import { useSyncExternalStore } from "react"
import { readPaletteOpened, subscribePreferences } from "@/lib/commands/preferences"
import { ariaKeyShortcuts, formatShortcut } from "@/lib/commands/shortcuts"
import { PALETTE_SHORTCUT } from "@/lib/commands/workspace"
import { useCommandCenter, usePaletteOpen, usePlatform } from "./command-provider"
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
 * and is never shown again. It has no dismiss control of its own: a button
 * in the header's tab order for a hint is more in the way than the hint.
 */
export function CommandsButton() {
  const center = useCommandCenter()
  const platform = usePlatform()
  const paletteOpen = usePaletteOpen()
  const opened = useSyncExternalStore(subscribePreferences, readPaletteOpened, () => true)
  if (!center) return null

  const showHint = !opened && platform !== null

  return (
    <span className="relative hidden lg:inline-flex">
      <button
        type="button"
        onClick={center.openPalette}
        aria-keyshortcuts={platform ? ariaKeyShortcuts(PALETTE_SHORTCUT, platform) : undefined}
        aria-haspopup="dialog"
        aria-expanded={paletteOpen}
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
          className="absolute top-[calc(100%+8px)] right-0 z-30 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-1 text-[12px] whitespace-nowrap text-[var(--color-ink-2)] shadow-[0_8px_24px_rgba(4,6,13,0.12)]"
        >
          Try <Kbd>{formatShortcut(PALETTE_SHORTCUT, platform)}</Kbd>
        </span>
      ) : null}
    </span>
  )
}
