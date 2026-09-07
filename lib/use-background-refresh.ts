"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * Re-fetches the page while a background job is still running.
 *
 * Work that leaves the request — finalizing an upload, publishing a listing —
 * finishes after the response that started it, so the page which queued it has
 * no idea when it is done. `router.refresh()` at the end of the action runs
 * while the row still says `pending`, and nothing asks again. The screen then
 * says "Uploading" about a file that has been ready for a minute, and the only
 * way to find out is to reload.
 *
 * That raced the right way for a long time. A local Supabase finalized fast
 * enough that the refresh usually landed after the job, so the bug was
 * invisible until the same code ran against a hosted project, where the job
 * makes real network round trips and the refresh always wins.
 *
 * Bounded rather than indefinite. A job that has not landed inside forty
 * seconds has failed in a way polling will not discover, and a tab that
 * refreshes itself forever is worse than one that stops.
 */

const POLL_MS = 2000
const POLL_LIMIT = 20

export function useBackgroundRefresh(active: boolean): void {
  const router = useRouter()

  useEffect(() => {
    if (!active) return
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      if (ticks > POLL_LIMIT) {
        clearInterval(timer)
        return
      }
      router.refresh()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [active, router])
}
