import type { WorkspaceEvent } from "@/lib/publishing/queries"

/**
 * What happened, in the order it happened.
 *
 * A run is a record rather than a state machine (ADR 0005), and this is where
 * that record is read back. It exists because the interesting moment is over by
 * the time a creator looks: jobs settle in the background, a re-attempt lands a
 * quarter of an hour later, and the cards above only ever show the present.
 *
 * Everything here is rendered from the event's own payload, written when the
 * thing happened. Nothing is recomputed from the world as it stands now, which
 * is the point of keeping the rows immutable.
 */

interface RunStartedPayload {
  starts?: { channel?: string; kind?: string }[]
  skips?: { channel?: string; reason?: string }[]
}

interface JobSettledPayload {
  kind?: string
  status?: string
  errorCode?: string | null
}

function asRecord(payload: WorkspaceEvent["payload"]): Record<string, unknown> {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {}
}

/** One line of plain English per event, and never an adjective about the product. */
function describe(event: WorkspaceEvent): string {
  const payload = asRecord(event.payload)

  if (event.event_type === "publish_run_started") {
    const { starts = [], skips = [] } = payload as RunStartedPayload
    const sending =
      starts.length === 1 ? "Publishing to 1 channel" : `Publishing to ${starts.length} channels`
    const skipped = skips.length === 0 ? "" : ` · ${skips.length} skipped`
    const named = starts
      .map((start) => start.channel)
      .filter(Boolean)
      .join(", ")
    return `${starts.length === 0 ? "Nothing to publish" : sending}${skipped}${named ? `: ${named}` : ""}`
  }

  if (event.event_type === "publish_run_job_settled") {
    const { kind = "publish", status, errorCode } = payload as JobSettledPayload
    if (status === "succeeded") return `A ${kind} finished`
    if (status === "failed") return `A ${kind} failed${errorCode ? ` (${errorCode})` : ""}`
    return `A ${kind} settled`
  }

  // A type this build does not know how to phrase is still shown. An activity
  // log that hides what it cannot describe is one that lies by omission.
  return event.event_type.replace(/_/g, " ")
}

export function ActivityLog({ events }: { events: readonly WorkspaceEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-[14px] text-[var(--color-ink-2)]">
        Nothing has been published from here yet. What Fanwise does on your behalf will be listed
        here.
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-px overflow-hidden rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-rule-2)]">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-[var(--color-card)] px-4 py-3"
        >
          <span className="text-[14px] text-[var(--color-ink)]">{describe(event)}</span>
          <time
            dateTime={event.created_at}
            className="tabular font-mono text-[12px] text-[var(--color-ink-3)]"
          >
            {new Date(event.created_at).toLocaleString()}
          </time>
        </li>
      ))}
    </ol>
  )
}
