import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { getProductBySlug, groupDerivatives, listProductAssets } from "@/lib/products/queries"
import { listChannels, listConnections, listProductListings } from "@/lib/channels/queries"
import { listProductEvents, loadPublicationViews } from "@/lib/publishing/queries"
import { planRun, runInputs } from "@/lib/publishing/run"
import { PublishEverywhere } from "@/components/channels/publish-everywhere"
import { ActivityLog } from "@/components/channels/activity-log"
import { liveness, mergeManualSteps } from "@/lib/publishing/manual-steps"
import { ListingPanel, type ChannelListingCard } from "@/components/channels/listing-panel"
import { ListingImages, type ListingImage } from "@/components/channels/listing-images"
import { listingImageSlots } from "@/lib/channels/images"
import { isReorderable } from "@/lib/products/image-order"
import { ProductForm } from "./product-form"
import { AssetManager } from "./asset-manager"
import { routes } from "@/lib/routes"
import { appOrigin } from "@/lib/channels/oauth"
import { getProductPageForEditor } from "@/lib/public/workspace-queries"
import { createPublicProductPageAction } from "@/lib/public/actions"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button"
import { PublicPageForm } from "./public-page-form"
import { awaitingReview } from "@/lib/ai/review"

export const metadata = { title: "Product · Fanwise" }

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string }>
}) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug, productSlug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const product = await getProductBySlug(workspace.id, productSlug)
  if (!product) notFound()

  const assets = await listProductAssets(product.id)

  // The same ordering the adapter uses, so the grid on this page and the images
  // a channel receives cannot disagree.
  const productImages: ListingImage[] = listingImageSlots(assets).flatMap((asset) =>
    isReorderable(asset.asset_type)
      ? [
          {
            id: asset.id,
            filename: asset.filename,
            assetType: asset.asset_type,
            state: asset.asset_state,
            checksum: asset.checksum,
          },
        ]
      : [],
  )
  const { sources, derivativesBySource } = groupDerivatives(assets)

  /*
   * Files lists what a buyer receives and the working files behind it. The
   * cover and preview images are neither: they are shop-window pictures, they
   * are managed in the Images section above, and listing them here a second
   * time reads as though they ship inside the download. Every other asset type
   * stays, including image types that are not part of the gallery.
   */
  const fileSources = sources.filter((asset) => !isReorderable(asset.asset_type))

  const [channels, connections, listings] = await Promise.all([
    // Every channel Fanwise knows about, not only the connected ones: a run
    // reports what it skipped and why, and a list that omitted the unconnected
    // would be hiding what Fanwise could do (ADR 0005).
    listChannels(),
    listConnections(workspace.id),
    listProductListings(product, workspace.id),
  ])

  const publications = await loadPublicationViews(
    workspace.id,
    listings.map((l) => l.listing.id),
  )

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

  // One card per connected channel, whether or not a listing exists yet. The
  // capability flags come from the adapter and never from the listing row, so a
  // channel that cannot publish cannot acquire the affordance by having data.
  const listingByConnection = new Map(listings.map((l) => [l.listing.channel_connection_id, l]))

  const cards: ChannelListingCard[] = connections
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
        listingId,
        title: view?.listing.title ?? null,
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

  // What one Publish Everywhere click would do, decided from the same facts the
  // action will read and by the same function, so the button cannot promise
  // something the server then refuses.
  const runChannels = runInputs({ channels, connections, listings })
  const publishRun = planRun(runChannels)

  /*
   * Offered only where some connected channel can actually publish.
   *
   * Not disabled, absent. A greyed-out Publish Everywhere on a workspace whose
   * only connection is an assisted channel promises an action that will never
   * work there, which is the rule the listing cards already follow and journey
   * 3 holds every surface to. Once a channel that can publish is connected the
   * section appears, and the button disables itself while nothing is ready —
   * that one is a "not yet", which is a different sentence.
   */
  const canPublishSomewhere = runChannels.some((channel) => channel.canPublish && channel.connected)

  // The record of what previous clicks did. Read here rather than inside the
  // log so the page makes one round trip per section and the component stays a
  // rendering of rows it was handed.
  const events = await listProductEvents(workspace.id, product.id)

  // The public showcase, which is a different question from "which channels
  // carry this". A product can be on four marketplaces with no public page, or
  // have a public page and be on none.
  const publicPage = await getProductPageForEditor(workspace.id, product.id)

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-2">
        <Link href={routes.workspace(slug)} className="label-mono hover:text-[var(--color-ink-2)]">
          ← Products
        </Link>
        <h1 className="font-display text-4xl font-extralight tracking-[-0.03em] text-balance">
          {product.name}
        </h1>
        <p className="font-mono text-[13px] text-[var(--color-ink-3)]">
          {routes.product(slug, product.slug)}
        </p>
      </div>

      {/* Heading and description live in the form, so the save status can sit
          on the heading line rather than at the bottom of a long column. */}
      <section className="flex max-w-[640px] flex-col gap-5">
        <ProductForm workspaceSlug={slug} product={product} />
      </section>

      {/*
        Images before Files, and separate from it. Images were uploadable all
        along — through the asset manager's type select — and nobody found
        them, because "cover image" was the fourth of twelve enum values in a
        dropdown labelled File type. A thing every product needs should not be
        reachable only by knowing which enum to pick.
      */}
      {/*
        Rendered bare, with no wrapping section and no heading of its own. The
        panel carries both, and the wrapper this used to have put a second
        "Images" heading above it in a band that was not part of the drop
        target. A file aimed at that heading — the obvious place to aim — fell
        through to the page, and the browser navigated away to the file. The
        panel's whole point is that a near miss is impossible, and the wrapper
        quietly reintroduced the miss it was built to prevent. The channel
        listing page always called it this way; this is the page that differed.
      */}
      <ListingImages
        workspaceSlug={slug}
        productId={product.id}
        channelName={null}
        images={productImages}
      />

      <section className="flex flex-col gap-5">
        <h2 className="label-mono">Files</h2>
        <AssetManager
          workspaceSlug={slug}
          productId={product.id}
          sources={fileSources}
          derivativesBySource={Object.fromEntries(derivativesBySource)}
        />
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="label-mono">Channels</h2>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          Each channel judges this product by its own rules. Readiness is computed from those rules,
          never estimated.
        </p>
        {/*
          The one action that acts on several channels at once, above the cards
          that carry the detail. The same plan the action will make is made
          here, so the button can say how many channels it would send to and
          name the ones it would not, before it is pressed rather than after.
        */}
        {canPublishSomewhere ? (
          <PublishEverywhere
            workspaceSlug={slug}
            productId={product.id}
            attemptable={publishRun.starts.length}
            skips={publishRun.skips.map((skip) => ({
              channelName: skip.channelName,
              reason: skip.reason,
            }))}
          />
        ) : null}

        <ListingPanel
          workspaceSlug={slug}
          productSlug={product.slug}
          productId={product.id}
          cards={cards}
        />
      </section>

      {/*
        Below Channels, because a public page is a shop window onto the
        listings above rather than another channel. It sells nothing itself: it
        routes a visitor to whichever of those channels they prefer, so it only
        makes sense once there is something for it to point at.
      */}
      <section className="flex flex-col gap-5">
        <h2 className="label-mono">Public page</h2>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          A page on the open web that shows this product and sends buyers to the channels above.
          Fanwise takes no payment here.
        </p>
        <PublicPageSection
          workspaceSlug={slug}
          productSlug={product.slug}
          publicPage={publicPage}
          hasDestinations={cards.some((card) => card.externalUrl !== null)}
          hasContact={false}
        />
      </section>

      {/*
        Last, because it is history rather than an action. The cards above show
        the present; a job that settles after the tab is closed, or a channel
        that was tried again a quarter of an hour later, is only visible here.
      */}
      <section className="flex flex-col gap-5">
        <h2 className="label-mono">Activity</h2>
        <ActivityLog events={events} />
      </section>
    </div>
  )
}

/**
 * Three states, deliberately distinguished.
 *
 * No profile, no page, and a page. Collapsing the first two into "not
 * published" would send a creator looking for a Publish button that is not
 * there, because the thing they are missing is a handle, one screen away.
 */
function PublicPageSection({
  workspaceSlug,
  productSlug,
  publicPage,
  hasDestinations,
}: {
  workspaceSlug: string
  productSlug: string
  publicPage: Awaited<ReturnType<typeof getProductPageForEditor>>
  hasDestinations: boolean
  hasContact: boolean
}) {
  if (publicPage.handle === null) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-[14px] border border-dashed border-[var(--color-rule)] px-5 py-8">
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          Claim a public handle for the studio first. Every product page lives under it, at{" "}
          <span className="font-mono text-[13px]">/@your-handle/{productSlug}</span>.
        </p>
        <ButtonLink href={routes.publicProfileSettings(workspaceSlug)} variant="secondary">
          Set up a public profile
        </ButtonLink>
      </div>
    )
  }

  if (publicPage.page === null) {
    const create = createPublicProductPageAction.bind(null, workspaceSlug, productSlug)
    return (
      <div className="flex flex-col items-start gap-4 rounded-[14px] border border-dashed border-[var(--color-rule)] px-5 py-8">
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          This product has no public page yet. Creating one makes a draft at{" "}
          <span className="font-mono text-[13px]">
            /@{publicPage.handle}/{productSlug}
          </span>
          , visible only to you until you publish it.
        </p>
        {/*
          Said here rather than discovered at the bottom of the public page. A
          product with no live listing anywhere still gets a page — it can carry
          the studio's contact action — but a creator should know that is what
          they are publishing before they publish it.
        */}
        {!hasDestinations ? (
          <p className="max-w-prose text-[13px] text-[var(--color-ink-3)]">
            Nothing is live on a channel yet, so the page will show your profile&rsquo;s contact
            action instead of a Buy option, or say the product is not available to buy yet if you
            have not set one.
          </p>
        ) : null}
        <form action={create}>
          <Button type="submit" variant="secondary">
            Create a public page
          </Button>
        </form>
      </div>
    )
  }

  return (
    <PublicPageForm
      workspaceSlug={workspaceSlug}
      productSlug={productSlug}
      handle={publicPage.handle}
      appOrigin={appOrigin()}
      status={publicPage.page.status}
      profileStatus={publicPage.profileStatus ?? "draft"}
      page={{
        slug: publicPage.page.slug,
        titleOverride: publicPage.page.title_override ?? "",
        summaryOverride: publicPage.page.summary_override ?? "",
        descriptionOverride: publicPage.page.description_override ?? "",
        coverAssetId: publicPage.page.cover_asset_id ?? "",
        seoTitle: publicPage.page.seo_title ?? "",
        seoDescription: publicPage.page.seo_description ?? "",
      }}
      images={publicPage.images}
    />
  )
}
