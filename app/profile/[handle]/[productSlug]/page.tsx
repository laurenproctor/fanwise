import type { Metadata } from "next"
import Link from "next/link"
import { notFound, permanentRedirect } from "next/navigation"
import { PublicShell } from "@/components/public/public-shell"
import { PublicAvatar } from "@/components/public/public-image"
import { ProductGallery } from "@/components/public/product-gallery"
import { ChooseWhereToBuy, DestinationList } from "@/components/public/destination-list"
import { ProductCard, formatPrice } from "@/components/public/product-card"
import { ShareButton } from "@/components/public/share-button"
import { ButtonLink } from "@/components/ui/button"
import { initialsOf } from "@/lib/public/avatars"
import { loadProfileCatalog, resolveProductPage, resolveProfile } from "@/lib/public/queries"
import { publicMediaRoutes } from "@/lib/public/media-routes"
import { publicRoutes, publicUrl } from "@/lib/routes"
import type { PublicProductView } from "@/lib/public/types"
import { appOrigin } from "@/lib/channels/oauth"

/**
 * A product's public page, served at `/@<handle>/<slug>`.
 *
 * The canonical showcase for one product and a router to wherever it is
 * actually sold. Fanwise takes no payment here and holds no cart: every
 * purchase path leaves for a channel the creator already sells on, which is
 * why the destination list is the centre of the page rather than a footnote
 * under a Buy button.
 *
 * Read as `anon`, like the profile. A draft page, or one whose profile is a
 * draft, is invisible to this query and 404s — the same answer a page that
 * never existed gets, so nothing here confirms what is being worked on.
 */

export const revalidate = 300

interface Params {
  params: Promise<{ handle: string; productSlug: string }>
  searchParams: Promise<{ c?: string }>
}

async function resolve(handle: string, productSlug: string) {
  const profileResolution = await resolveProfile(handle)
  if (profileResolution.kind !== "found") return { profileResolution, page: null } as const
  const page = await resolveProductPage(profileResolution.value, productSlug)
  return { profileResolution, page } as const
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle, productSlug } = await params
  const { profileResolution, page } = await resolve(handle, productSlug)

  if (profileResolution.kind !== "found" || !page || page.kind !== "found") {
    return { title: "Not found · Fanwise", robots: { index: false, follow: false } }
  }

  const product = page.value
  const canonical = publicUrl(
    appOrigin(),
    publicRoutes.product(product.profile.handle, product.slug),
  )
  const title = product.seoTitle ?? `${product.title} by ${product.profile.displayName} · Fanwise`
  const description =
    product.seoDescription ??
    product.summary ??
    `${product.typeLabel} by ${product.profile.displayName}, available on Fanwise.`

  // The cover, absolute, because a relative OG image is ignored by most
  // scrapers. Absent rather than a stand-in when there is no cover: a generic
  // placeholder in a share card says less than no card image at all.
  const image = product.coverAssetId
    ? publicUrl(appOrigin(), publicMediaRoutes.asset(product.coverAssetId))
    : null

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      siteName: "Fanwise",
      ...(image ? { images: [{ url: image, alt: product.title }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}

export default async function PublicProductPage({ params, searchParams }: Params) {
  const { handle, productSlug } = await params
  const { profileResolution, page } = await resolve(handle, productSlug)

  if (profileResolution.kind === "redirect") {
    permanentRedirect(publicRoutes.product(profileResolution.to, productSlug))
  }
  if (profileResolution.kind === "missing" || !page) notFound()
  if (page.kind === "redirect") {
    permanentRedirect(publicRoutes.product(profileResolution.value.handle, page.to))
  }
  if (page.kind === "missing") notFound()

  const product = page.value
  const profile = product.profile
  const { c: campaign } = await searchParams

  const canonical = publicUrl(appOrigin(), publicRoutes.product(profile.handle, product.slug))
  const siblings = (await loadProfileCatalog(profile.id))
    .filter((p) => p.slug !== product.slug)
    .slice(0, 3)

  const details = [
    product.formats.length > 0 ? { term: "File formats", value: product.formats.join(", ") } : null,
    product.version ? { term: "Version", value: product.version } : null,
    product.brandName ? { term: "Designed by", value: product.brandName } : null,
    { term: "Updated", value: formatDate(product.updatedAt) },
  ].filter((row): row is { term: string; value: string } => row !== null)

  return (
    <PublicShell>
      {/*
        Structured data, and only the parts that are true. There is no
        `aggregateRating` and no `review`, because Fanwise holds neither and a
        Product node claiming them would be a fabricated rich result. `offers`
        appears only when a channel has actually quoted a price.
      */}
      <script
        type="application/ld+json"
        // The payload is JSON.stringify of a server-built object, and the one
        // sequence that could break out of a script element is escaped.
        dangerouslySetInnerHTML={{ __html: productJsonLd(product, canonical) }}
      />

      <div className="mx-auto w-full max-w-[1160px] px-5 pt-6 sm:px-8 sm:pt-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-ink-3)]">
            <li>
              <Link
                href={publicRoutes.profile(profile.handle)}
                className="underline-offset-4 hover:text-[var(--color-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                {profile.displayName}
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>{product.typeLabel}</li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-[var(--color-ink-2)]">
              {product.title}
            </li>
          </ol>
        </nav>
      </div>

      <div className="mx-auto grid w-full max-w-[1160px] grid-cols-1 gap-10 px-5 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-14">
        <div className="min-w-0">
          <ProductGallery assetIds={product.galleryAssetIds} title={product.title} />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <span className="label-mono">{product.typeLabel}</span>

          <h1 className="font-display text-[36px] leading-[1.03] font-extralight tracking-[-0.04em] text-balance sm:text-[44px]">
            {product.title}
          </h1>

          <Link
            href={publicRoutes.profile(profile.handle)}
            className="flex w-fit items-center gap-2.5 rounded-[8px] text-[15px] text-[var(--color-ink-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            <PublicAvatar
              profileId={profile.id}
              displayName={profile.displayName}
              initials={initialsOf(profile.displayName)}
              hasAvatar={profile.hasAvatar}
              size={28}
            />
            by <span className="underline underline-offset-4">{profile.displayName}</span>
          </Link>

          {product.summary ? (
            <p className="max-w-prose text-[16px] text-[var(--color-ink-2)]">{product.summary}</p>
          ) : null}

          {(product.formats.length > 0 || product.version) && (
            <ul className="flex flex-wrap items-center gap-2">
              {product.formats.map((format) => (
                <li
                  key={format}
                  className="rounded-[6px] border border-[var(--color-rule)] px-2.5 py-1 font-mono text-[11px] tracking-[0.08em] text-[var(--color-ink-2)] uppercase"
                >
                  {format}
                </li>
              ))}
              <li className="text-[13px] text-[var(--color-ink-3)]">
                Updated {formatDate(product.updatedAt)}
              </li>
            </ul>
          )}

          {product.startingPrice ? (
            <p className="font-display text-[28px] tracking-[-0.03em] text-[var(--color-ink)]">
              <span className="text-[15px] text-[var(--color-ink-3)]">From </span>
              <span className="tabular">{formatPrice(product.startingPrice)}</span>
            </p>
          ) : null}

          {/*
            The purchase path, or an honest alternative. A product with no live
            listing anywhere gets the creator's contact action instead of a
            button that leads nowhere; with neither, it gets a sentence. There
            is deliberately no disabled "Choose where to buy" — a dead primary
            action is the single most common way a page like this lies.
          */}
          <div className="flex flex-col gap-3">
            {product.destinations.length > 0 ? (
              <ChooseWhereToBuy count={product.destinations.length} />
            ) : profile.contactUrl ? (
              <ButtonLink
                href={profile.contactUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                Contact {profile.displayName}
                <span className="sr-only"> (opens in a new tab)</span>
              </ButtonLink>
            ) : (
              <p className="rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-4 py-3 text-[14px] text-[var(--color-ink-2)]">
                This product is not available to buy through Fanwise yet.
              </p>
            )}

            <ShareButton url={canonical} title={product.title} />
          </div>

          {product.destinations.length > 0 ? (
            <DestinationList
              pageId={product.id}
              destinations={product.destinations}
              campaign={campaign ?? null}
            />
          ) : null}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-14 px-5 pt-16 sm:px-8">
        {product.description ? (
          <section aria-labelledby="overview" className="flex flex-col gap-4">
            <h2 id="overview" className="font-display text-[26px] tracking-[-0.03em]">
              Overview
            </h2>
            {/*
              Rendered as text, split on blank lines. Not as HTML and not
              through a Markdown renderer: this string is creator input, and
              the moment it is rendered as markup the public page becomes a
              place to put a script tag. Paragraphs are the whole of the
              formatting on offer, and that is a deliberate ceiling.
            */}
            <div className="flex max-w-prose flex-col gap-4 text-[16px] leading-relaxed text-[var(--color-ink-2)]">
              {product.description
                .split(/\n{2,}/)
                .map((paragraph) => paragraph.trim())
                .filter((paragraph) => paragraph.length > 0)
                .map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
            </div>
          </section>
        ) : null}

        {(product.includedItems.length > 0 || details.length > 0 || product.licenseSummary) && (
          <div className="grid grid-cols-1 gap-12 border-t border-[var(--color-rule)] pt-12 lg:grid-cols-2 lg:gap-16">
            {product.includedItems.length > 0 ? (
              <section aria-labelledby="included" className="flex flex-col gap-4">
                <h2 id="included" className="font-display text-[24px] tracking-[-0.03em]">
                  What&rsquo;s included
                </h2>
                <ul className="flex flex-col gap-2">
                  {product.includedItems.map((item) => (
                    <li key={item} className="text-[15px] text-[var(--color-ink-2)]">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="details" className="flex flex-col gap-4">
              <h2 id="details" className="font-display text-[24px] tracking-[-0.03em]">
                Product details
              </h2>
              <dl className="flex flex-col">
                {details.map((row) => (
                  <div
                    key={row.term}
                    className="flex justify-between gap-6 border-b border-[var(--color-rule-2)] py-3"
                  >
                    <dt className="text-[14px] text-[var(--color-ink-3)]">{row.term}</dt>
                    <dd className="text-right text-[14px] text-[var(--color-ink)]">{row.value}</dd>
                  </div>
                ))}
              </dl>

              {product.licenseSummary ? (
                <div className="flex flex-col gap-2 pt-2">
                  <h3 className="label-mono">Licensing</h3>
                  <p className="max-w-prose text-[14px] text-[var(--color-ink-2)]">
                    {product.licenseSummary}
                  </p>
                  <p className="text-[13px] text-[var(--color-ink-3)]">
                    Each channel sells under its own license. Check the terms where you buy.
                  </p>
                </div>
              ) : null}
            </section>
          </div>
        )}

        {siblings.length > 0 ? (
          <section
            aria-labelledby="more"
            className="flex flex-col gap-6 border-t border-[var(--color-rule)] pt-12"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 id="more" className="font-display text-[26px] tracking-[-0.03em]">
                More from {profile.displayName}
              </h2>
              <Link
                href={publicRoutes.profile(profile.handle)}
                className="text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                View all
              </Link>
            </div>
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {siblings.map((sibling) => (
                <ProductCard key={sibling.slug} handle={profile.handle} product={sibling} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PublicShell>
  )
}

/**
 * A Product node carrying only facts Fanwise holds.
 *
 * No rating, no review count, no availability it cannot verify. A structured
 * data block is a claim made to a search engine on the creator's behalf, and
 * the rich results it produces are read by people who never see this page — so
 * an invented figure here travels further than an invented figure anywhere
 * else on the site. `offers` appears only when a channel has actually quoted a
 * price, and `image` only when there is a real cover.
 */
function productJsonLd(product: PublicProductView, canonical: string): string {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    url: canonical,
    category: product.typeLabel,
    brand: { "@type": "Brand", name: product.brandName ?? product.profile.displayName },
  }

  if (product.summary) node.description = product.summary
  if (product.coverAssetId) {
    node.image = [publicUrl(appOrigin(), publicMediaRoutes.asset(product.coverAssetId))]
  }

  if (product.destinations.length > 0) {
    const priced = product.destinations.filter(
      (d): d is typeof d & { price: number } => d.price !== null,
    )
    if (priced.length > 0) {
      node.offers = priced.map((destination) => ({
        "@type": "Offer",
        price: destination.price,
        priceCurrency: destination.currency,
        url: destination.url,
        availability: "https://schema.org/InStock",
        seller: { "@type": "Organization", name: destination.channelName },
      }))
    }
  }

  /*
    `</script>` inside a JSON string would close this element early, and the
    rest of the payload would be parsed as markup. Escaping the `<` is the
    standard fix and leaves the JSON valid, because `\u003c` is the same
    character to every JSON parser.
  */
  return JSON.stringify(node).replace(/</g, "\\u003c")
}

function formatDate(value: string): string {
  // Fixed locale, like every other formatted value on a cached public page.
  return new Date(value).toLocaleDateString("en-US", { month: "short", year: "numeric" })
}
