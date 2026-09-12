import Link from "next/link"
import { publicRoutes } from "@/lib/routes"
import { PublicImage } from "./public-image"
import type { PublicProductCard } from "@/lib/public/types"

/**
 * One product in a creator's catalog.
 *
 * The whole card is a single link. A card with a link on the title and another
 * on the image is two tab stops and two announcements for one destination, and
 * the space between them is a dead zone the cursor falls into.
 *
 * The channel count is the only badge, and it is set in mono rather than a
 * pill. A row of coloured pills reads as a marketplace; a quiet figure reads
 * as a fact, which is what it is.
 */
export function ProductCard({
  handle,
  product,
  priority = false,
}: {
  handle: string
  product: PublicProductCard
  priority?: boolean
}) {
  return (
    <li className="min-w-0">
      <Link
        href={publicRoutes.product(handle, product.slug)}
        className="group flex h-full flex-col overflow-hidden rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] transition-colors hover:border-[var(--color-ink-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        {product.coverAssetId ? (
          <PublicImage
            assetId={product.coverAssetId}
            alt={product.coverAlt}
            priority={priority}
            ratio="4 / 3"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          // No cover is a real state, not an error: a product can be published
          // before its images are. A ruled panel holds the same box the image
          // would, so a grid of mixed cards does not stagger.
          <span
            aria-hidden
            style={{ aspectRatio: "4 / 3" }}
            className="flex w-full items-center justify-center border-b border-[var(--color-rule)] bg-[var(--color-paper-2)]"
          >
            <span className="label-mono">{product.typeLabel}</span>
          </span>
        )}

        <span className="flex flex-1 flex-col gap-2 p-5">
          <span className="flex items-baseline justify-between gap-4">
            <span className="font-display truncate text-[18px] tracking-[-0.02em] text-[var(--color-ink)]">
              {product.title}
            </span>
            {product.startingPrice ? (
              <span className="tabular shrink-0 text-[15px] text-[var(--color-ink)]">
                <span className="text-[13px] text-[var(--color-ink-3)]">From </span>
                {formatPrice(product.startingPrice)}
              </span>
            ) : null}
          </span>

          <span className="label-mono">{product.typeLabel}</span>

          {product.summary ? (
            <span className="line-clamp-2 text-[14px] text-[var(--color-ink-2)]">
              {product.summary}
            </span>
          ) : null}

          {product.channelCount > 0 ? (
            <span className="mt-auto pt-3 text-[13px] text-[var(--color-ink-3)]">
              Available on {product.channelCount}{" "}
              {product.channelCount === 1 ? "channel" : "channels"}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  )
}

/**
 * A price, in the currency it was quoted in.
 *
 * `Intl.NumberFormat` with an explicit `en-US` locale rather than the
 * visitor's: this runs on the server for a page that is cached and served to
 * everyone, so a locale-dependent string would be whichever visitor rendered
 * it first. The currency is still the real one.
 */
export function formatPrice(price: { amount: number; currency: string }): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: price.currency,
      maximumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
    }).format(price.amount)
  } catch {
    // An unrecognised currency code is not a reason to drop the number.
    return `${price.amount} ${price.currency}`
  }
}
