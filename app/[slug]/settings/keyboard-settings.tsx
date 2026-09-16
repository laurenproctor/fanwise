"use client"

import { useId, useSyncExternalStore } from "react"
import { useCommandCenter, usePlatform } from "@/components/commands/command-provider"
import { Kbd } from "@/components/commands/kbd"
import { Button } from "@/components/ui/button"
import {
  readSingleKeyPreference,
  subscribePreferences,
  writeSingleKeyPreference,
} from "@/lib/commands/preferences"
import { formatShortcut } from "@/lib/commands/shortcuts"
import { PALETTE_SHORTCUT } from "@/lib/commands/workspace"

/**
 * The keyboard, in Settings: one switch and one button.
 *
 * The switch turns plain single-key shortcuts off for this browser. The
 * palette, ⌘K and the other modifier shortcuts stay on, because they cannot
 * be typed by accident. Stored locally, not on the account: it is about
 * this keyboard, and a database column for it would be a migration for a
 * boolean nobody else reads.
 */
export function KeyboardSettings() {
  const center = useCommandCenter()
  const enabled = useSyncExternalStore(subscribePreferences, readSingleKeyPreference, () => true)
  const id = useId()
  const hintId = `${id}-hint`
  const platform = usePlatform()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={enabled}
          onChange={(event) => writeSingleKeyPreference(event.target.checked)}
          aria-describedby={hintId}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        />
        <label htmlFor={id} className="flex flex-col gap-1">
          <span className="text-[15px] text-[var(--color-ink)]">Single-key shortcuts</span>
          <span id={hintId} className="max-w-prose text-[13px] text-[var(--color-ink-2)]">
            Keys like <Kbd>C</Kbd> to create a product and <Kbd>F</Kbd> then a letter to move
            between sections. They only ever work when you are not typing in a field. Turn them off
            and the command palette
            {platform ? (
              <>
                {" "}
                (<Kbd>{formatShortcut(PALETTE_SHORTCUT, platform)}</Kbd>)
              </>
            ) : null}{" "}
            still works.
          </span>
        </label>
      </div>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {enabled ? "Single-key shortcuts are on." : "Single-key shortcuts are off."}
      </p>
      {center ? (
        <div>
          <Button type="button" variant="secondary" onClick={center.openReference}>
            Show all shortcuts
          </Button>
        </div>
      ) : null}
    </div>
  )
}
