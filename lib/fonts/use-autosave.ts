"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { combinePatches, isEmptyPatch, type PatchField } from "./save"
import type { ProductPatch } from "./workspace"
import type { FontSaveResult } from "./actions"

/**
 * Autosave for the font workspace.
 *
 * Edits accumulate into one pending patch. Typing waits for a pause; a choice
 * (a toggle, a select, a reordered list) saves at once. Only one save is ever
 * in flight, and anything edited while it runs is sent after it lands, in
 * order. That ordering is the whole defence against a stale response: there is
 * never an older request that could finish after a newer one and write over it.
 *
 * What happens to a failure depends on whose failure it is:
 *
 *   retryable   the network or the database. The patch is kept, merged under
 *               anything typed since, and tried again with backoff, three
 *               times, then left for the creator's Try again.
 *   refused     the value itself (a taken address, a price below zero). That
 *               patch is not retried, since it would fail the same way, but the
 *               value stays on screen with the message beside its field until
 *               the creator changes it.
 *
 * Nothing here ever writes a server value back into the form. The screen is
 * the creator's; the server confirms or refuses.
 */

export type AutosaveStatus = "clean" | "dirty" | "saving" | "saved" | "error"

export interface AutosaveError {
  message: string
  field: PatchField | null
  retryable: boolean
}

const TYPING_IDLE_MS = 900
const RETRY_BASE_MS = 2000
const MAX_AUTOMATIC_RETRIES = 3

export function useAutosave(params: {
  save: (patch: ProductPatch) => Promise<FontSaveResult>
  onSaved?: (result: Extract<FontSaveResult, { ok: true }>, patch: ProductPatch) => void
}) {
  const saveRef = useRef(params.save)
  const onSavedRef = useRef(params.onSaved)
  useEffect(() => {
    saveRef.current = params.save
    onSavedRef.current = params.onSaved
  })

  const pending = useRef<ProductPatch>({})
  const inFlight = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retries = useRef(0)

  const [status, setStatus] = useState<AutosaveStatus>("clean")
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<AutosaveError | null>(null)

  // Named so it can call itself: a save that lands with more work pending, or a
  // retry timer, runs the same function again without a ref to it.
  const flush = useCallback(async function flushNow(): Promise<void> {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (inFlight.current) {
      // Wait for the running save, then send whatever is still pending. Checked
      // again rather than assumed, because the edit that called this may have
      // arrived after the running save decided there was nothing more to do.
      await inFlight.current
      return flushNow()
    }
    if (isEmptyPatch(pending.current)) return

    const sending = pending.current
    pending.current = {}
    setStatus("saving")

    /** What to do once this save has settled and is no longer in flight. */
    let next = "wait" as "flush" | "wait"

    const run = (async () => {
      let result: FontSaveResult
      try {
        result = await saveRef.current(sending)
      } catch {
        result = {
          ok: false,
          error: "Couldn't save. Check your connection.",
          field: null,
          retryable: true,
        }
      }

      if (result.ok) {
        retries.current = 0
        setError(null)
        setSavedAt(result.savedAt)
        onSavedRef.current?.(result, sending)
        const more = !isEmptyPatch(pending.current)
        setStatus(more ? "dirty" : "saved")
        next = more ? "flush" : "wait"
        return
      }

      setError({ message: result.error, field: result.field, retryable: result.retryable })
      setStatus("error")

      if (!result.retryable) {
        // The refused value stays on screen; edits made meanwhile still go.
        next = isEmptyPatch(pending.current) ? "wait" : "flush"
        return
      }

      // Keep the work. Anything typed since is newer and wins.
      pending.current = combinePatches(sending, pending.current)
      if (retries.current < MAX_AUTOMATIC_RETRIES) {
        const delay = RETRY_BASE_MS * 2 ** retries.current
        retries.current += 1
        if (retryTimer.current) clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null
          void flushNow()
        }, delay)
      }
    })()

    inFlight.current = run
    try {
      await run
    } finally {
      inFlight.current = null
    }
    if (next === "flush") await flushNow()
  }, [])

  /** Queues a change. `immediate` for choices, debounced for typing. */
  const queue = useCallback(
    (patch: ProductPatch, immediate = false) => {
      pending.current = combinePatches(pending.current, patch)
      setStatus((current) => (current === "saving" ? current : "dirty"))
      // A new edit to the field that was refused is a new attempt at it.
      setError((current) => (current && !current.retryable ? null : current))
      if (timer.current) clearTimeout(timer.current)
      if (immediate) {
        void flush()
      } else {
        timer.current = setTimeout(() => void flush(), TYPING_IDLE_MS)
      }
    },
    [flush],
  )

  /** The creator's Try again: resets the automatic budget and saves now. */
  const retry = useCallback(() => {
    retries.current = 0
    if (retryTimer.current) {
      clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    void flush()
  }, [flush])

  const unsaved = status === "dirty" || status === "saving" || (error?.retryable ?? false)

  /*
   * Warn before leaving only while something would actually be lost: a patch
   * not yet sent, one in flight, or one that failed and is waiting to retry. A
   * refused value is not in that list — it cannot be saved as it stands, and a
   * dialog about it on every navigation would teach the creator to ignore it.
   */
  useEffect(() => {
    if (!unsaved) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [unsaved])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (retryTimer.current) clearTimeout(retryTimer.current)
    },
    [],
  )

  return { status, savedAt, error, queue, flush, retry, unsaved }
}
