import { loadProfileCatalog } from "@/lib/public/queries"
import { ProductCard } from "./product-card"
import { ProfileCatalog } from "./profile-catalog"

/**
 * The catalog, as its own async component so it can stream.
 *
 * ## Why this is not a `loading.tsx`
 *
 * A `loading.tsx` beside the page creates a Suspense boundary around the whole
 * route, and a route-level boundary makes Next begin the response — with a
 * `200 OK` — before the page has decided anything. A profile that does not
 * exist then rendered its not-found page under a 200: the right words, the
 * wrong answer, and a crawler indexing "This page does not exist" as a live
 * page. Worse, a draft profile answered 200 too, which is a privacy promise
 * broken by a loading skeleton.
 *
 * Nesting the boundary here instead keeps the order right. The page resolves
 * the profile first, so `notFound()` still lands on an uncommitted response
 * and the status is a real 404; only then does the shell flush, with the grid
 * streaming in behind it. The header — avatar, name, bio, share — is the part
 * a visitor looks at first and it is no longer waiting on the catalog query.
 *
 * Found by an end-to-end test that asked for a draft profile as a stranger and
 * got 200.
 */
export async function CatalogSection({
  profileId,
  handle,
  displayName,
}: {
  profileId: string
  handle: string
  displayName: string
}) {
  const products = await loadProfileCatalog(profileId)

  if (products.length === 0) {
    return <EmptyCatalog displayName={displayName} />
  }

  const featured = products.filter((p) => p.featured)

  return (
    <>
      {featured.length > 0 ? (
        <section aria-labelledby="featured" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 id="featured" className="font-display text-[26px] tracking-[-0.03em]">
              Featured
            </h2>
            <p className="text-[14px] text-[var(--color-ink-3)]">Curated by {displayName}.</p>
          </div>
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((product, index) => (
              <ProductCard
                key={product.slug}
                handle={handle}
                product={product}
                priority={index < 3}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="catalog" className="flex flex-col gap-6">
        <h2 id="catalog" className="font-display text-[26px] tracking-[-0.03em]">
          {featured.length > 0 ? "All products" : "Products"}
        </h2>
        {/*
          The full catalog, featured items included. A visitor scanning "All
          products" for something they saw a moment ago should find it there,
          rather than learning that "all" excluded the three at the top.
        */}
        <ProfileCatalog handle={handle} products={products} />
      </section>
    </>
  )
}

/**
 * A published profile with nothing on it yet.
 *
 * A real and reasonable state — claiming a handle before the catalog is ready
 * is the sensible order to do things in — so it reads as a page that is
 * waiting rather than a page that is broken.
 */
function EmptyCatalog({ displayName }: { displayName: string }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-[16px] border border-dashed border-[var(--color-rule)] px-6 py-14">
      <span className="label-mono">Nothing published yet</span>
      <p className="max-w-prose text-[16px] text-[var(--color-ink-2)]">
        {displayName} has not published any products here yet. Check back soon.
      </p>
    </div>
  )
}

/**
 * What stands in while the grid loads: cards at the size real cards occupy, so
 * nothing moves when they arrive.
 */
export function CatalogSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading products</span>
      <div className="h-7 w-40 rounded bg-[var(--color-paper-2)]" />
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <li
            key={index}
            style={{ aspectRatio: "4 / 3" }}
            className="w-full rounded-[16px] bg-[var(--color-paper-2)]"
          />
        ))}
      </ul>
    </div>
  )
}
