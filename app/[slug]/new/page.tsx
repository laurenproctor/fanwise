import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { routes } from "@/lib/routes"
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

      {/*
        The other way in. One link rather than a redesigned chooser: this page
        is the manual path and still works exactly as it did, and importing from
        a link is a different enough first step to deserve its own screen rather
        than a mode on this form.
      */}
      <p className="border-t border-[var(--color-rule)] pt-6 text-[15px] text-[var(--color-ink-2)]">
        Already have it online?{" "}
        <Link
          href={routes.importProduct(slug)}
          className="rounded-[4px] font-medium text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
        >
          Import a product from a link
        </Link>{" "}
        — or from a PDF, an HTML file or text you paste — and Fanwise will fill in what it can.
      </p>
    </div>
  )
}
