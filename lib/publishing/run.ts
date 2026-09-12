/**
 * What one Publish Everywhere click decides, per channel.
 *
 * The decision is separated from the doing on purpose. This module takes plain
 * facts about each channel and returns what a run would do; the action feeds it
 * from the registry, the workspace's connections and the listings, then starts
 * the jobs the plan names. That split is what makes every case here testable
 * without a database, a network or an adapter, including the ones nobody has
 * arranged in real life yet.
 *
 * Two rules from ADR 0005 shape the shape of it.
 *
 * The channel list is the registry's, not a shorter one. A channel Fanwise
 * knows about and this workspace has not connected is reported as skipped with
 * a reason, because a run that silently omitted it would be hiding something
 * Fanwise could do.
 *
 * And a run reports per channel with a count, never an adjective over the
 * product. There is no "partially published" here and no product status
 * anywhere: each channel was sent, failed, or skipped for a stated reason.
 */

import { findAdapter } from "@/lib/channels/registry"
import type { Channel } from "@/lib/channels/types"
import type { ConnectionWithChannel, ListingView } from "@/lib/channels/queries"

/** Why a run did not attempt a channel. Always stated, never implied. */
export type SkipReason = "assisted" | "not_connected" | "not_ready" | "already_published"

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  assisted: "Fanwise cannot publish here. You submit this listing yourself.",
  not_connected: "Not connected to this workspace.",
  not_ready: "Not ready yet: fix what this channel would reject.",
  already_published: "Already published. Nothing new to send.",
}

/** What a run knows about one channel before it decides anything. */
export interface RunChannelInput {
  /** Null when the workspace has no connection to this channel. */
  connectionId: string | null
  channelName: string
  /** From the adapter's capabilities, never from a row. */
  canPublish: boolean
  canUpdate: boolean
  /** A connection that exists and is usable. */
  connected: boolean
  /** Null when nothing has been built for this channel yet. */
  listingId: string | null
  ready: boolean
  hasExternalId: boolean
  unsentChanges: boolean
}

export type RunStart = {
  kind: "publish" | "update"
  connectionId: string
  listingId: string
  channelName: string
}

export type RunSkip = {
  connectionId: string | null
  channelName: string
  reason: SkipReason
}

export interface RunPlan {
  starts: RunStart[]
  skips: RunSkip[]
}

/**
 * The decision for one channel, in the order the reasons are worth stating.
 *
 * Capability first, because a channel that cannot publish is not a channel
 * having a bad day: no connection, no readiness and no listing changes that,
 * and saying anything else about it would be answering a different question.
 */
function decide(channel: RunChannelInput): RunStart | RunSkip {
  const { connectionId, channelName } = channel

  if (!channel.canPublish) return { connectionId, channelName, reason: "assisted" }
  if (!channel.connected || connectionId === null) {
    return { connectionId, channelName, reason: "not_connected" }
  }

  /*
   * Nothing built for this channel yet reads as not ready, and it is: a listing
   * that does not exist cannot satisfy the channel's requirements. It gets the
   * same word rather than a fifth one, because the creator's next move is
   * identical — open the channel's card and deal with what it says.
   */
  if (channel.listingId === null) return { connectionId, channelName, reason: "not_ready" }

  if (channel.hasExternalId) {
    /*
     * The channel already holds the product. An edit it has not received is
     * still worth sending, and that is an update rather than a second create.
     *
     * A channel that can publish but cannot update is not reachable today —
     * every adapter that declares one declares both — so the fall-through says
     * "already published" rather than inventing a reason for a case the
     * capability matrix does not produce.
     */
    if (channel.unsentChanges && channel.canUpdate) {
      return { kind: "update", connectionId, listingId: channel.listingId, channelName }
    }
    return { connectionId, channelName, reason: "already_published" }
  }

  if (!channel.ready) return { connectionId, channelName, reason: "not_ready" }

  return { kind: "publish", connectionId, listingId: channel.listingId, channelName }
}

/**
 * The facts a run needs, gathered from what the page already loaded.
 *
 * Here rather than in the action because the page has to ask the same question
 * to decide what the button should say, and two mappings of the same three
 * lists would answer it differently the first time one of them was edited.
 *
 * Capabilities come from the adapter and readiness from the evaluation made in
 * this request. Neither is read from a row: a stored capability is a promise no
 * provider made, and a stored readiness score is stale the moment a requirement
 * or the listing moves.
 */
export function runInputs(params: {
  channels: readonly Channel[]
  connections: readonly ConnectionWithChannel[]
  listings: readonly ListingView[]
}): RunChannelInput[] {
  const connectionsByChannel = new Map<string, ConnectionWithChannel[]>()
  for (const connection of params.connections) {
    const list = connectionsByChannel.get(connection.channel.id) ?? []
    list.push(connection)
    connectionsByChannel.set(connection.channel.id, list)
  }
  const listingByConnection = new Map(
    params.listings.map((l) => [l.listing.channel_connection_id, l]),
  )

  return params.channels.flatMap((channel): RunChannelInput[] => {
    const adapter = findAdapter(channel.key)
    // A channel row whose adapter has left the registry is not offered at all,
    // the same way the channels page treats it: nothing knows how to translate
    // to it, so there is no honest decision to report about it.
    if (!adapter) return []

    const canPublish = adapter.capabilities.automaticPublish && adapter.publish !== undefined
    const canUpdate = adapter.capabilities.automaticUpdate && adapter.update !== undefined
    const connections = connectionsByChannel.get(channel.id) ?? []

    // A channel nobody has connected is still reported, once, so the run's list
    // is everything Fanwise could do rather than everything it was set up to do.
    if (connections.length === 0) {
      return [
        {
          connectionId: null,
          channelName: adapter.name,
          canPublish,
          canUpdate,
          connected: false,
          listingId: null,
          ready: false,
          hasExternalId: false,
          unsentChanges: false,
        },
      ]
    }

    /*
     * One entry per connection, not per channel.
     *
     * A workspace may hold two connections to the same channel — two stores —
     * and each carries its own listing, which is why the product page draws a
     * card per connection. A run that collapsed them would publish to the first
     * store and say nothing about the second.
     *
     * The account's name joins the label only when the channel has more than
     * one connection, because that is the only time it tells the reader
     * anything: two shops on one channel need telling apart, while a single row
     * repeating its own channel's name back at itself is noise.
     */
    const many = connections.length > 1

    return connections.map((connected) => {
      const view = listingByConnection.get(connected.connection.id)
      const account = connected.connection.external_account_name

      return {
        connectionId: connected.connection.id,
        channelName: many && account ? `${adapter.name} · ${account}` : adapter.name,
        canPublish,
        canUpdate,
        connected: connected.connection.status === "active",
        listingId: view?.listing.id ?? null,
        ready: view?.evaluation?.readiness.ready ?? false,
        hasExternalId: Boolean(view?.listing.external_listing_id),
        unsentChanges: view?.unsentChanges ?? false,
      }
    })
  })
}

export function planRun(channels: readonly RunChannelInput[]): RunPlan {
  const starts: RunStart[] = []
  const skips: RunSkip[] = []

  for (const channel of channels) {
    const decision = decide(channel)
    if ("kind" in decision) starts.push(decision)
    else skips.push(decision)
  }

  return { starts, skips }
}

/**
 * The headline, which is a count and never an adjective.
 *
 * The mockup's footer is the spec: "3 live · 2 pending · 1 needs attention".
 * A run that started nothing is still a run, and saying so plainly beats a
 * spinner that resolves into silence.
 */
export function runSummary(plan: RunPlan): string {
  const started = plan.starts.length
  const skipped = plan.skips.length

  if (started === 0) {
    return skipped === 1
      ? "Nothing to publish: 1 channel skipped."
      : `Nothing to publish: ${skipped} channels skipped.`
  }

  const sending = started === 1 ? "Publishing to 1 channel" : `Publishing to ${started} channels`
  if (skipped === 0) return `${sending}.`
  return `${sending} · ${skipped} skipped.`
}
