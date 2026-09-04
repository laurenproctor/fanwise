import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { getProductBySlug, listProductAssets } from "@/lib/products/queries"
import { listProductListings } from "@/lib/channels/queries"
import { listingToDraft } from "@/lib/channels/listings"
import { isChannelKey } from "@/lib/channels/registry"
import { ListingEditor } from "@/components/channels/listing-editor"

export const metadata = { title: "Listing · Fanwise" }

/**
 * One listing, on one channel, for one product.
 *
 * A route rather than a panel on the product page: six channels edited inline
 * becomes unusable at the third, and a listing worth arguing about is a listing
 * worth linking to.
 */
export default async function ListingPage({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string; connectionId: string }>
}) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug, productSlug, connectionId } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const product = await getProductBySlug(workspace.id, productSlug)
  if (!product) notFound()

  const listings = await listProductListings(product, workspace.id)
  const view = listings.find((l) => l.listing.channel_connection_id === connectionId)

  // No listing on this connection, or a channel whose adapter has been retired.
  // Both are "nothing to edit here" rather than an error worth explaining.
  if (!view || !view.adapter || !isChannelKey(view.channel.key)) notFound()

  const assets = await listProductAssets(product.id)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href={`/w/${slug}/products/${productSlug}`}
          className="label-mono hover:text-[var(--color-ink-2)]"
        >
          ← {product.name}
        </Link>
        <h1 className="font-display text-4xl font-extralight tracking-[-0.03em] text-balance">
          {view.channel.name}
        </h1>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          {view.adapter.integrationType === "api"
            ? "Written by hand for this channel. Fanwise can publish it once publishing exists."
            : "Written by hand for this channel. You will submit it yourself; this channel has no API to publish through."}
        </p>
      </div>

      <ListingEditor
        workspaceSlug={slug}
        listingId={view.listing.id}
        channelKey={view.channel.key}
        subject={{ product, assets }}
        initial={listingToDraft(view.listing)}
        canonical={{
          title: product.canonical_title ?? product.name,
          description: product.canonical_description ?? "",
          shortDescription: product.short_description ?? "",
          price: product.base_price === null ? "" : String(product.base_price),
        }}
      />
    </div>
  )
}
