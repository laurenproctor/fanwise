import type { ChannelListingCard } from "@/components/channels/listing-panel"
import type { ConnectionWithChannel, ListingView } from "@/lib/channels/queries"
import { liveness, mergeManualSteps } from "@/lib/publishing/manual-steps"
import type { loadPublicationViews } from "@/lib/publishing/queries"
import { awaitingReview } from "@/lib/ai/review"
import type { ProductAsset } from "@/lib/products/types"

/**
 * One card per connected channel, whether or not a listing exists yet.
 *
 * Shared by the product page and the font workspace, so a channel offers the
 * same actions on both: the capability flags come from the adapter and never
 * from the listing row, so a channel that cannot publish cannot acquire the
 * affordance by having data.
 */
export function listingCards(params: {
  connections: readonly ConnectionWithChannel[]
  listings: readonly ListingView[]
  publications: Awaited<ReturnType<typeof loadPublicationViews>>
  assets: readonly ProductAsset[]
}): ChannelListingCard[] {
  const { connections, listings, publications, assets } = params

  /**
   * The file a creator hands to a channel that cannot receive one through its
   * API. Sorted the same way the asset manager sorts, so "the deliverable"
   * means the same file in both places.
   */
  const deliverable =
    assets.find(
      (asset) =>
        asset.asset_state === "ready" &&
        (asset.asset_type === "deliverable" || asset.asset_type === "archive"),
    ) ?? null

  const listingByConnection = new Map(listings.map((l) => [l.listing.channel_connection_id, l]))

  return connections
    .filter((c) => c.adapter !== null)
    .map(({ connection, channel, adapter }) => {
      const view = listingByConnection.get(connection.id)
      const listingId = view?.listing.id ?? null

      const steps = view
        ? mergeManualSteps(
            adapter!.manualSteps,
            publications.manualSteps.get(view.listing.id) ?? [],
          )
        : []

      const lastJob = listingId ? publications.latestJob.get(listingId) : undefined

      return {
        connectionId: connection.id,
        channelName: channel.name,
        integrationType: adapter!.integrationType,
        canPublish: adapter!.capabilities.automaticPublish,
        /*
         * Offered only where all three are true: the provider can take an
         * update, the channel already has the product, and the listing holds
         * something it has not been sent. The third is what stops this being a
         * button whose only outcome is already_done — the same reason there is
         * no second Publish.
         */
        canPublishChanges:
          adapter!.capabilities.automaticUpdate &&
          view !== undefined &&
          view.listing.status === "published" &&
          view.listing.external_listing_id !== null &&
          view.unsentChanges,
        /*
         * A channel that serves a Fanwise download address, on a listing that
         * has one to replace.
         */
        canReplaceDeliveryLink:
          adapter!.deliversByLink === true &&
          view !== undefined &&
          view.listing.status === "published" &&
          view.listing.external_listing_id !== null,
        listingId,
        title: view?.draft.title ?? null,
        statusSource: view?.listing.status_source ?? null,
        readiness: view?.evaluation?.readiness ?? null,
        results: view?.evaluation?.results ?? [],
        // Derived, never stored. ADR 0001: published and live are not the same
        // claim, and only one of them may be made about a product a buyer
        // cannot yet receive anything from.
        liveness: view ? liveness(view.listing, steps) : "unpublished",
        externalUrl: view?.listing.external_url ?? null,
        manualSteps: steps.map((state) => ({
          key: state.spec.key,
          label: state.spec.label,
          description: state.spec.description,
          instructions: [...state.spec.instructions],
          completed: state.completedAt !== null,
          needsDeliverable: state.spec.needsDeliverable,
        })),
        // Only a failure that is still the latest word. A message from an
        // attempt that has since been superseded is a message about the past.
        lastError: lastJob?.status === "failed" ? (lastJob.normalized_error_message ?? null) : null,
        awaitingReview: view ? awaitingReview(view.listing) : false,
        deliverable: deliverable
          ? { assetId: deliverable.id, filename: deliverable.filename }
          : null,
      }
    })
}
