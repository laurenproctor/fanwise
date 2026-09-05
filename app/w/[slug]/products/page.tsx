import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { listProducts } from "@/lib/products/queries"
import { PRODUCT_TYPE_LABELS } from "@/lib/products/types"
import { ButtonLink } from "@/components/ui/button"

export const metadata = { title: "Products · Fanwise" }

export default async function ProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const products = await listProducts(workspace.id)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="label-mono">Catalog</span>
          <h1 className="font-display text-4xl font-extralight tracking-[-0.03em]">Products</h1>
        </div>
        <ButtonLink href={`/w/${slug}/products/new`}>New product</ButtonLink>
      </div>

      {products.length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-[14px] border border-dashed border-[var(--color-rule)] p-10">
          <span className="label-mono">Nothing here yet</span>
          <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
            A product is the canonical record of one thing you sell. You write it once here, and
            every channel gets its own translation of it later.
          </p>
          <ButtonLink href={`/w/${slug}/products/new`}>Create your first product</ButtonLink>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-[var(--color-rule)]">
          <table className="w-full border-collapse bg-[var(--color-card)] text-left">
            <thead>
              <tr className="border-b border-[var(--color-rule)]">
                <th className="label-mono p-4 font-normal">Product</th>
                <th className="label-mono p-4 font-normal">Type</th>
                <th className="label-mono p-4 font-normal">Status</th>
                <th className="label-mono p-4 font-normal">Updated</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product.id}
                  className="border-b border-[var(--color-rule-2)] last:border-b-0"
                >
                  <td className="p-4">
                    <Link
                      href={`/w/${slug}/products/${product.slug}`}
                      className="font-display text-[17px] font-normal hover:text-[var(--color-accent)]"
                    >
                      {product.name}
                    </Link>
                  </td>
                  <td className="p-4 font-mono text-[13px] text-[var(--color-ink-2)]">
                    {PRODUCT_TYPE_LABELS[product.product_type]}
                  </td>
                  <td className="p-4 font-mono text-[13px] text-[var(--color-ink-2)]">
                    {product.status}
                  </td>
                  <td className="tabular p-4 font-mono text-[13px] text-[var(--color-ink-2)]">
                    {new Date(product.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
