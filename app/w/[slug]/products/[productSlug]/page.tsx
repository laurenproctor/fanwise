import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { getProductBySlug, groupDerivatives, listProductAssets } from "@/lib/products/queries"
import { listConnections, listProductListings } from "@/lib/channels/queries"
import { loadPublicationViews } from "@/lib/publishing/queries"
import { liveness, mergeManualSteps } from "@/lib/publishing/manual-steps"
import { ListingPanel, type ChannelListingCard } from "@/components/channels/listing-panel"
import { ProductForm } from "./product-form"
import { AssetManager } from "./asset-manager"

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
  const { sources, derivativesBySource } = groupDerivatives(assets)

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
        <Link href={`/w/${slug}/products`} className="label-mono hover:text-[var(--color-ink-2)]">
          ← Products
        </Link>
        <h1 className="font-display text-4xl font-extralight tracking-[-0.03em] text-balance">
          {product.name}
        </h1>
        <p className="font-mono text-[13px] text-[var(--color-ink-3)]">
          /w/{slug}/products/{product.slug}
        </p>
      </div>

      <section className="flex max-w-[640px] flex-col gap-5">
        <h2 className="label-mono">The canonical record</h2>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          This is the source of truth. Channels receive a translation of it; nothing here is shaped
          by any one marketplace.
        </p>
        <ProductForm workspaceSlug={slug} product={product} />
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="label-mono">Files</h2>
        <AssetManager
          workspaceSlug={slug}
          productId={product.id}
          sources={sources}
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
