import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { getProductBySlug, groupDerivatives, listProductAssets } from "@/lib/products/queries"
import { listConnections, listProductListings } from "@/lib/channels/queries"
import { loadPublicationViews } from "@/lib/publishing/queries"
import { liveness, mergeManualSteps } from "@/lib/publishing/manual-steps"
import { ListingPanel, type ChannelListingCard } from "@/components/channels/listing-panel"
import { ListingImages, type ListingImage } from "@/components/channels/listing-images"
import { listingImageSlots } from "@/lib/channels/images"
import { isReorderable } from "@/lib/products/image-order"
import { ProductForm } from "./product-form"
import { AssetManager } from "./asset-manager"
import { routes } from "@/lib/routes"

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

  const [connections, listings] = await Promise.all([
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
        deliverable: deliverable
          ? { assetId: deliverable.id, filename: deliverable.filename }
          : null,
      }
    })

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
        <ListingPanel
          workspaceSlug={slug}
          productSlug={product.slug}
          productId={product.id}
          cards={cards}
        />
      </section>
    </div>
  )
}
