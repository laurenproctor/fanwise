import { readAltText, readAltTextSource } from "@/lib/products/image-metadata"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import {
  getDraftDeletionEligibility,
  getProductBySlug,
  groupDerivatives,
  listProductAssets,
} from "@/lib/products/queries"
import { listChannels, listConnections, listProductListings } from "@/lib/channels/queries"
import { listProductEvents, loadPublicationViews } from "@/lib/publishing/queries"
import { planRun, runInputs } from "@/lib/publishing/run"
import { PublishEverywhere } from "@/components/channels/publish-everywhere"
import { ActivityLog } from "@/components/channels/activity-log"
import { ListingPanel } from "@/components/channels/listing-panel"
import { listingCards } from "@/lib/channels/listing-cards"
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
import { PublicPageForm, type ProductWording } from "./public-page-form"
import { DeleteProductDraft } from "./delete-product-draft"
import { offeredDraftDeletion } from "@/lib/products/draft-deletion"
import { loadFontWorkspace } from "@/lib/fonts/queries"
import { FontWorkspace } from "@/components/fonts/font-workspace"

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

  /*
   * A font gets the publishing workspace: one surface with its files, family,
   * coverage, specimens, licensing and channel drafts. Every other product type
   * renders the page below exactly as it did before. The workspace reads the
   * same rows through the same queries; it is a different arrangement of the
   * canonical product, not a different product model.
   */
  if (product.product_type === "font") {
    const data = await loadFontWorkspace({
      workspaceId: workspace.id,
      workspaceSlug: slug,
      product,
    })
    const [events, publicPage, eligibility] = await Promise.all([
      listProductEvents(workspace.id, product.id),
      getProductPageForEditor(workspace.id, product.id),
      getDraftDeletionEligibility(product.id),
    ])
    const deletion = offeredDraftDeletion(eligibility)

    return (
      <div data-workspace-canvas="full" className="flex flex-col gap-14 pb-16">
        <FontWorkspace
          workspaceSlug={slug}
          productId={product.id}
          defaultSection="family"
          initialValues={data.values}
          initialMetadata={data.metadata}
          files={data.files}
          family={data.family}
          images={data.images}
          channels={data.channels}
          cards={data.cards}
          skips={data.plan.skips.map((skip) => ({
            channelName: skip.channelName,
            reason: skip.reason,
            needs: skip.needs,
          }))}
          hasLicenseFile={data.hasLicenseFile}
          attemptableChannels={data.plan.starts.length}
          canPublishSomewhere={data.canPublishSomewhere}
        />

        <div className="mx-auto grid w-full max-w-[1560px] gap-x-10 gap-y-12 border-t border-[var(--color-rule)] pt-10 xl:grid-cols-2">
          <section className="flex flex-col gap-5">
            <h2 className="label-mono">Public page</h2>
            <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
              A page on the open web that shows this product and sends buyers to its channels.
              Fanwise takes no payment here.
            </p>
            <PublicPageSection
              workspaceSlug={slug}
              productSlug={product.slug}
              publicPage={publicPage}
              productWording={{
                title: product.canonical_title ?? product.name,
                summary: product.short_description ?? "",
                description: product.canonical_description ?? "",
              }}
              hasDestinations={data.channels.some((channel) => channel.externalUrl !== null)}
              hasContact={false}
            />
          </section>
          <section className="flex flex-col gap-5">
            <h2 className="label-mono">Activity</h2>
            <ActivityLog events={events} />
          </section>
          {deletion ? (
            <div className="xl:col-span-2">
              <DeleteProductDraft
                workspaceSlug={slug}
                productId={product.id}
                productName={product.name}
                eligibility={deletion}
              />
            </div>
          ) : null}
        </div>
      </div>
    )
  }

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
            altText: readAltText(asset.metadata),
            altTextSource: readAltTextSource(asset.metadata),
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

  const cards = listingCards({ connections, listings, publications, assets })

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

  // Whether this caller may delete the product outright, asked of the same
  // database function the deletion itself runs under lock, and whether that
  // answer is worth a section on the page.
  const deletion = offeredDraftDeletion(await getDraftDeletionEligibility(product.id))

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
              needs: skip.needs,
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
          productWording={{
            title: product.canonical_title ?? product.name,
            summary: product.short_description ?? "",
            description: product.canonical_description ?? "",
          }}
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

      {/*
        After everything, including history. Only when there is something to
        do: absent for anyone who does not own the workspace, and absent for a
        product that has left Fanwise, which this can never delete.
      */}
      {deletion ? (
        <DeleteProductDraft
          workspaceSlug={slug}
          productId={product.id}
          productName={product.name}
          eligibility={deletion}
        />
      ) : null}
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
  productWording,
  hasDestinations,
}: {
  workspaceSlug: string
  productSlug: string
  productWording: ProductWording
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
        <ButtonLink href={routes.profile(workspaceSlug)} variant="secondary">
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
      onProfile={publicPage.page.status === "published" || publicPage.chosenInDraft}
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
      product={productWording}
    />
  )
}
