import type { SequenceDestination } from "./types"

/**
 * The `F` layer: press F, then one letter.
 *
 * A small controller rather than a reducer in a component, so the timing —
 * the part that goes wrong — can be run under fake timers in Node. It owns
 * one timer and a boolean, and reports through `subscribe` so React can read
 * it with useSyncExternalStore.
 *
 * Rules, all of them here and nowhere else:
 *
 * - `F` opens the guide. Case-insensitive; a held key does not reopen it.
 * - A destination key runs its command and closes the guide.
 * - Any other key closes it. A mistyped sequence should not linger for a
 *   second and a half waiting to swallow the next thing pressed.
 * - Escape closes it.
 * - With nothing pressed, it closes itself after `timeoutMs`.
 * - Modifier keys on their own (Shift, for a capital) are ignored: the guide
 *   stays open and the next real key decides.
 */

export const SEQUENCE_TIMEOUT_MS = 1500
export const SEQUENCE_KEY = "f"

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"])

export type SequenceOutcome =
  | { kind: "opened" }
  | { kind: "navigate"; destination: SequenceDestination }
  | { kind: "closed" }
  | { kind: "ignored" }

export interface SequenceController {
  /** Feed one key; the outcome says what to do with the event. */
  press(key: string): SequenceOutcome
  close(): void
  isOpen(): boolean
  subscribe(listener: () => void): () => void
  /** Clears the timer. Call on unmount. */
  dispose(): void
}

export function createSequenceController({
  destinations,
  timeoutMs = SEQUENCE_TIMEOUT_MS,
}: {
  destinations: readonly SequenceDestination[]
  timeoutMs?: number
}): SequenceController {
  let open = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) listener()
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  function setOpen(next: boolean) {
    clearTimer()
    if (open === next) return
    open = next
    notify()
  }

  function close() {
    setOpen(false)
  }

  return {
    press(key) {
      const folded = key.length === 1 ? key.toLowerCase() : key

      if (!open) {
        if (folded !== SEQUENCE_KEY) return { kind: "ignored" }
        setOpen(true)
        timer = setTimeout(close, timeoutMs)
        return { kind: "opened" }
      }

      if (MODIFIER_KEYS.has(key)) return { kind: "ignored" }

      const destination = destinations.find((d) => d.key === folded)
      close()
      return destination ? { kind: "navigate", destination } : { kind: "closed" }
    },
    close,
    isOpen: () => open,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      clearTimer()
      listeners.clear()
    },
  }
}
