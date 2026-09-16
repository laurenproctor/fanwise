"use client"

import { ariaKeyShortcuts } from "@/lib/commands/shortcuts"
import { useCommandCenter, useShortcut } from "./command-provider"
import { ShortcutKeys } from "./kbd"

/**
 * The keycaps beside a button that a shortcut also presses.
 *
 * Reads the registry, so the label can only show a shortcut that is live
 * and can never show one the registry does not have. Nothing renders until
 * the platform is known, and nothing renders where single keys are off and
 * the shortcut is a single key: a label for a key that will not work is
 * worse than no label.
 */
export function ShortcutHint({
  commandId,
  className = "",
}: {
  commandId: string
  className?: string
}) {
  const center = useCommandCenter()
  const shortcut = useShortcut(commandId)
  if (!center || !shortcut) return null
  const single = !shortcut.shortcut.mod && !shortcut.shortcut.alt
  if (single && !center.singleKeysEnabled) return null
  return (
    <ShortcutKeys shortcut={shortcut.shortcut} platform={shortcut.platform} className={className} />
  )
}

/** The `aria-keyshortcuts` value for the same button, or undefined. */
export function useAriaKeyShortcuts(commandId: string): string | undefined {
  const shortcut = useShortcut(commandId)
  return shortcut ? ariaKeyShortcuts(shortcut.shortcut, shortcut.platform) : undefined
}
