import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { getProductBySlug, groupDerivatives, listProductAssets } from "@/lib/products/queries"
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
    </div>
  )
}
