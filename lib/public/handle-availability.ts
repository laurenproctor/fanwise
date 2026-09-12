import { classifyHandle } from "./handles"

/**
 * The studio-address field's availability check, as a plain object.
 *
 * Not a hook, so the timing rules can be tested with fake timers and a
 * hand-driven fetcher in a Node test, without a DOM. `useHandleAvailability`
 * is a thin wrapper around it.
 *
 * Three rules make this worth its own module.
 *
 *   1. Only the network is debounced. Shape and reservation are decided on
 *      the keystroke, so "reserved" appears the moment the word is complete
 *      and never flickers through "checking" first.
 *   2. A slow answer cannot overwrite a newer one. Every request carries a
 *      sequence number and an AbortSignal; a response whose number is not the
 *      latest is dropped even if the fetcher ignores the signal, which is what
 *      stops `northline` (slow, taken) landing after `northline-studio`
 *      (fast, available) and marking the address the creator settled on as
 *      taken.
 *   3. The creator's own current handle is available without asking. It is
 *      theirs; asking the server whether it is taken would be a request whose
 *      answer is known.
 */

export type AvailabilityState =
  | { status: "untouched" }
  | { status: "checking"; handle: string }
  | { status: "available"; handle: string }
  | { status: "unavailable"; handle: string }
  | { status: "invalid"; message: string }
  | { status: "reserved"; handle: string }
  | { status: "error"; handle: string }

export type AvailabilityAnswer = "available" | "unavailable"

export type AvailabilityFetcher = (
  handle: string,
  signal: AbortSignal,
) => Promise<AvailabilityAnswer>

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export const AVAILABILITY_DEBOUNCE_MS = 400

export interface HandleAvailabilityChecker {
  /** Call with the field's raw value on every change. */
  update(raw: string): void
  /** Re-run the last network check, after a failure. */
  retry(): void
  current(): AvailabilityState
  dispose(): void
}

export function createHandleAvailabilityChecker({
  fetcher,
  onChange,
  ownHandle,
  debounceMs = AVAILABILITY_DEBOUNCE_MS,
  timers = defaultTimers,
}: {
  fetcher: AvailabilityFetcher
  onChange: (state: AvailabilityState) => void
  /** The profile's live handle, which is always available to it. */
  ownHandle: string
  debounceMs?: number
  timers?: Timers
}): HandleAvailabilityChecker {
  let state: AvailabilityState = { status: "untouched" }
  let sequence = 0
  let timer: unknown = null
  let controller: AbortController | null = null
  let lastHandle: string | null = null
  let disposed = false

  function set(next: AvailabilityState) {
    state = next
    if (!disposed) onChange(next)
  }

  function cancelPending() {
    if (timer !== null) timers.clearTimeout(timer)
    timer = null
    controller?.abort()
    controller = null
  }

  function request(handle: string) {
    const mine = ++sequence
    controller = new AbortController()
    const signal = controller.signal

    fetcher(handle, signal).then(
      (answer) => {
        if (mine !== sequence || disposed) return
        controller = null
        set({ status: answer, handle })
      },
      () => {
        // An aborted request is a superseded one, not a failure.
        if (mine !== sequence || disposed || signal.aborted) return
        controller = null
        set({ status: "error", handle })
      },
    )
  }

  function schedule(handle: string) {
    set({ status: "checking", handle })
    timer = timers.setTimeout(() => {
      timer = null
      request(handle)
    }, debounceMs)
  }

  return {
    update(raw) {
      cancelPending()
      // Bumping the sequence here, not only when a request is sent, is what
      // invalidates an in-flight answer the moment the field changes, even if
      // the new value never needs a request at all.
      sequence += 1

      const classified = classifyHandle(raw)
      switch (classified.kind) {
        case "empty":
          lastHandle = null
          set({ status: "invalid", message: "Choose your studio address." })
          return
        case "invalid":
          lastHandle = null
          set({ status: "invalid", message: classified.message })
          return
        case "reserved":
          lastHandle = null
          set({ status: "reserved", handle: classified.value })
          return
        case "valid":
          lastHandle = classified.value
          if (classified.value === ownHandle.toLowerCase()) {
            set({ status: "available", handle: classified.value })
            return
          }
          schedule(classified.value)
      }
    },

    retry() {
      if (lastHandle === null || state.status !== "error") return
      cancelPending()
      sequence += 1
      set({ status: "checking", handle: lastHandle })
      request(lastHandle)
    },

    current: () => state,

    dispose() {
      disposed = true
      cancelPending()
    },
  }
}
