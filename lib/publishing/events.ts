import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"

/**
 * The activity log, and the only list of what an event means.
 *
 * `workspace_events.event_type` is text with a format check rather than an
 * enum, so that a new event does not need a migration between it and the code
 * that writes it. The cost of that freedom is that the vocabulary has to live
 * somewhere a reader can find, and this is it.
 *
 * Every event is a fact about something that already happened. Nothing here is
 * a state a later read has to reconcile, and nothing reads these rows to decide
 * what to do next: a run is a record, never a state machine (ADR 0005). The
 * table refuses updates and deletes, including the service role's, so an event
 * written in error is corrected by writing another one.
 */

export const WORKSPACE_EVENT_TYPES = [
  /** One Publish Everywhere click, with every connected channel and its decision. */
  "publish_run_started",
  /** One job inside a run reached a terminal outcome. */
  "publish_run_job_settled",
] as const

export type WorkspaceEventType = (typeof WORKSPACE_EVENT_TYPES)[number]

type EventClient = Pick<SupabaseClient<Database>, "from">

export interface WorkspaceEventInput {
  workspaceId: string
  type: WorkspaceEventType
  productId?: string | null
  listingId?: string | null
  runId?: string | null
  actorUserId?: string | null
  payload?: Record<string, unknown>
}

/**
 * Writes one event, and never fails the thing it is describing.
 *
 * A publish that worked and an activity row that did not is a worse outcome
 * than a missing line in a log, so the failure is logged where an operator can
 * see it and swallowed here. The caller's own errors are its own.
 */
export async function recordEvent(client: EventClient, event: WorkspaceEventInput): Promise<void> {
  const { error } = await client.from("workspace_events").insert({
    workspace_id: event.workspaceId,
    event_type: event.type,
    product_id: event.productId ?? null,
    channel_listing_id: event.listingId ?? null,
    run_id: event.runId ?? null,
    actor_user_id: event.actorUserId ?? null,
    payload: (event.payload ??
      {}) as Database["public"]["Tables"]["workspace_events"]["Insert"]["payload"],
  })

  if (error) {
    console.error("[publishing] could not record event", { type: event.type, error })
  }
}
