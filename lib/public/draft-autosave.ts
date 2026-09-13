import type { Timers } from "./handle-availability"

/**
 * Debounced, serialized autosave for a draft, as a plain object.
 *
 * The rules, each of which is a bug somebody has shipped:
 *
 *   - Typing is never delayed. `change()` records the value and returns; the
 *     save happens later, off the keystroke.
 *   - One save at a time. A change that arrives while a save is in flight is
 *     remembered and saved after it, with the revision the first save
 *     returned. Two overlapping saves would race on `revision` and the second
 *     would be reported as a conflict with itself.
 *   - A failure keeps the value. The controller never discards what the
 *     creator typed; it reports `error`, and the next change or `retry()`
 *     tries again with the latest value.
 *   - A conflict stops saving. Another tab has written a newer revision, and
 *     retrying would overwrite it. The creator is told, and their text stays
 *     on screen to copy.
 *
 * Nothing here knows what a draft is or where it goes. The save function is
 * injected, which is also what lets the tests assert that no path through
 * this module reaches publication.
 */

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "conflict"

export type AutosaveResult =
  { ok: true; revision: number } | { ok: false; reason: "failed" | "conflict" }

export interface DraftAutosave<T> {
  change(value: T): void
  /** Saves now if anything is unsaved. Resolves true when the latest value is stored. */
  flush(): Promise<boolean>
  retry(): void
  /**
   * Takes a revision written outside this controller — Step 1's Continue
   * stores the fields itself — so the next autosave does not conflict with it.
   */
  adopt(revision: number): void
  revision(): number
  status(): AutosaveStatus
  dispose(): void
}

export const AUTOSAVE_DEBOUNCE_MS = 800

export function createDraftAutosave<T>({
  save,
  initialRevision,
  onStatus,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
  timers = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
}: {
  save: (value: T, revision: number) => Promise<AutosaveResult>
  initialRevision: number
  onStatus: (status: AutosaveStatus) => void
  debounceMs?: number
  timers?: Timers
}): DraftAutosave<T> {
  let status: AutosaveStatus = "idle"
  let revision = initialRevision
  let latest: { value: T } | null = null
  let dirty = false
  let timer: unknown = null
  let inFlight: Promise<void> | null = null
  let disposed = false

  function setStatus(next: AutosaveStatus) {
    status = next
    if (!disposed) onStatus(next)
  }

  function clearTimer() {
    if (timer !== null) timers.clearTimeout(timer)
    timer = null
  }

  function schedule() {
    clearTimer()
    timer = timers.setTimeout(() => {
      timer = null
      void run()
    }, debounceMs)
  }

  async function run(): Promise<void> {
    if (inFlight) return inFlight
    clearTimer()
    if (!dirty || latest === null || status === "conflict") return

    const snapshot = latest.value
    dirty = false
    setStatus("saving")

    inFlight = (async () => {
      let result: AutosaveResult
      try {
        result = await save(snapshot, revision)
      } catch {
        result = { ok: false, reason: "failed" }
      }

      if (result.ok) {
        revision = result.revision
        if (dirty) {
          setStatus("pending")
          schedule()
        } else {
          setStatus("saved")
        }
      } else if (result.reason === "conflict") {
        dirty = true
        setStatus("conflict")
      } else {
        // The value that failed is still the one to save, unless something
        // newer has arrived since, which supersedes it either way.
        dirty = true
        setStatus("error")
      }
    })()

    try {
      await inFlight
    } finally {
      inFlight = null
    }
  }

  return {
    change(value) {
      if (disposed) return
      latest = { value }
      dirty = true
      if (status === "conflict") return
      if (!inFlight) setStatus("pending")
      schedule()
    },

    async flush() {
      clearTimer()
      if (inFlight) await inFlight
      if (dirty) await run()
      return !dirty && status !== "error" && status !== "conflict"
    },

    retry() {
      if (status !== "error") return
      clearTimer()
      void run()
    },

    adopt(next) {
      if (next > revision) revision = next
    },

    revision: () => revision,
    status: () => status,

    dispose() {
      disposed = true
      clearTimer()
    },
  }
}
