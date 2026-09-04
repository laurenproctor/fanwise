import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { NewProductForm } from "./new-product-form"

export const metadata = { title: "New product · Fanwise" }

export default async function NewProductPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  return (
    <div className="flex max-w-[520px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="label-mono">Catalog</span>
        <h1 className="font-display text-3xl font-extralight tracking-[-0.03em]">New product</h1>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          Name it and say what it is. Everything else, including the files, comes next.
        </p>
      </div>
      <NewProductForm workspaceSlug={slug} />
    </div>
  )
}
