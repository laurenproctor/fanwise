import { listProductAssets } from "@/lib/products/queries"
import { listChannels, listConnections, listProductListings } from "@/lib/channels/queries"
import { loadPublicationViews } from "@/lib/publishing/queries"
import { liveness, mergeManualSteps } from "@/lib/publishing/manual-steps"
import { planRun, runInputs, type RunPlan } from "@/lib/publishing/run"
import { listingCards } from "@/lib/channels/listing-cards"
import type { ChannelListingCard } from "@/components/channels/listing-panel"
import { fontMetadataSchema, type FontMetadata } from "@/lib/products/metadata"
import type { Product, ProductAsset } from "@/lib/products/types"
import { routes } from "@/lib/routes"
import { evaluateFontReadiness, type FontReadiness } from "./readiness"
import {
  detectFamily,
  fontFileViews,
  specimenImageViews,
  type ChannelDraftView,
  type DetectedFamily,
  type DraftFieldOrigin,
  type FontFileView,
  type FontProductValues,
  type SpecimenImageView,
} from "./workspace"

/**
 * Everything the font workspace reads, loaded once, through RLS.
 *
 * Shared by the page and by the publish gate so that what the screen says is
 * blocking and what the server refuses are computed from the same rows by the
 * same function.
 */

export interface FontWorkspaceData {
  assets: ProductAsset[]
  values: FontProductValues
  metadata: FontMetadata
  files: FontFileView[]
  family: DetectedFamily
  images: SpecimenImageView[]
  channels: ChannelDraftView[]
  /** The same cards the product page shows, with every per-channel action. */
  cards: ChannelListingCard[]
  hasLicenseFile: boolean
  plan: RunPlan
  canPublishSomewhere: boolean
  readiness: FontReadiness
}

export function productValues(product: Product): FontProductValues {
  return {
    name: product.name,
    canonicalTitle: product.canonical_title ?? "",
    slug: product.slug,
    shortDescription: product.short_description ?? "",
    canonicalDescription: product.canonical_description ?? "",
    brandName: product.brand_name ?? "",
    version: product.version ?? "",
    basePrice: product.base_price === null ? null : Number(product.base_price),
    currency: product.currency,
    licenseSummary: product.license_summary ?? "",
  }
}

/**
 * The stored font metadata, or an empty font record.
 *
 * A font product whose metadata predates this workspace, or was created as
 * another type and switched, reads as a font with nothing answered yet rather
 * than as generic. Nothing is written until the creator changes something.
 */
export function fontMetadataOf(product: Product): FontMetadata {
  const parsed = fontMetadataSchema.safeParse(product.metadata)
  return parsed.success ? parsed.data : { kind: "font" }
}

export async function loadFontWorkspace(params: {
  workspaceId: string
  workspaceSlug: string
  product: Product
}): Promise<FontWorkspaceData> {
  const { workspaceId, workspaceSlug, product } = params

  const [assets, channels, connections, listings] = await Promise.all([
    listProductAssets(product.id),
    listChannels(),
    listConnections(workspaceId),
    listProductListings(product, workspaceId),
  ])

  const publications = await loadPublicationViews(
    workspaceId,
    listings.map((l) => l.listing.id),
  )

  const listingByConnection = new Map(listings.map((l) => [l.listing.channel_connection_id, l]))

  const channelViews: ChannelDraftView[] = connections
    .filter((c) => c.adapter !== null)
    .map(({ connection, channel, adapter }) => {
      const view = listingByConnection.get(connection.id)
      const listing = view?.listing
      const steps = listing
        ? mergeManualSteps(adapter!.manualSteps, publications.manualSteps.get(listing.id) ?? [])
        : []
      // The draft as it reads (inherited where the row is empty), and, from the
      // row itself, which of those values are the channel's own.
      const draft = view?.draft
      const origin = (field: "title" | "description" | "price"): DraftFieldOrigin =>
        !adapter!.fields.includes(field)
          ? "absent"
          : listing && listing[field] !== null
            ? "customized"
            : "inherited"
      return {
        connectionId: connection.id,
        channelName: channel.name,
        integrationType: adapter!.integrationType,
        listingId: listing?.id ?? null,
        title: draft?.title ?? null,
        description: draft?.description ?? null,
        tags: draft?.tags ?? [],
        category: draft?.category ?? null,
        price: draft?.price ?? null,
        currency: draft?.currency ?? product.currency,
        origins: {
          title: origin("title"),
          description: origin("description"),
          price: origin("price"),
        },
        results: (view?.evaluation?.results ?? []).map((result) => ({
          key: result.key,
          label: result.label,
          severity: result.severity,
          satisfied: result.satisfied,
          ...(result.message ? { message: result.message } : {}),
        })),
        liveness: listing ? liveness(listing, steps) : "unpublished",
        externalUrl: listing?.external_url ?? null,
        editHref: routes.productChannel(workspaceSlug, product.slug, connection.id),
      }
    })

  const runChannels = runInputs({ channels, connections, listings })
  const files = fontFileViews(assets)
  const family = detectFamily(files)
  const images = specimenImageViews(assets)
  const values = productValues(product)
  const metadata = fontMetadataOf(product)
  const hasLicenseFile = assets.some(
    (asset) => asset.asset_type === "license" && asset.asset_state === "ready",
  )

  return {
    assets,
    values,
    metadata,
    files,
    family,
    images,
    channels: channelViews,
    cards: listingCards({ connections, listings, publications, assets }),
    hasLicenseFile,
    plan: planRun(runChannels),
    canPublishSomewhere: runChannels.some((channel) => channel.canPublish && channel.connected),
    readiness: evaluateFontReadiness({
      values,
      metadata,
      files,
      family,
      images,
      channels: channelViews,
      hasLicenseFile,
    }),
  }
}
