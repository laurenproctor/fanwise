import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { signOutAction } from "@/lib/workspaces/actions"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"

/**
 * The tenancy boundary for every workspace-scoped surface.
 *
 * This re-checks the user and the workspace server-side rather than trusting the
 * middleware redirect, per docs/security.md rule 7. RLS is the real enforcement:
 * getWorkspaceBySlug() returns null for a workspace belonging to someone else,
 * which is indistinguishable here from one that does not exist. That is
 * deliberate, so a probe cannot confirm a slug is real.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--color-rule)]">
        <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-6 px-6 py-4">
          <Link href={`/w/${workspace.slug}`} className="flex flex-col gap-1">
            <span className="label-mono">Workspace</span>
            <span className="font-display text-[17px] font-normal tracking-[-0.01em]">
              {workspace.name}
            </span>
          </Link>
          <nav className="ml-auto mr-2 flex items-center gap-5">
            <Link
              href={`/w/${workspace.slug}/products`}
              className="text-[14px] text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
            >
              Products
            </Link>
          </nav>
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1160px] px-6 py-10">{children}</main>
    </div>
  )
}
