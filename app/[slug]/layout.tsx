import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { signOutAction } from "@/lib/workspaces/actions"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { routes } from "@/lib/routes"
import { FanMark } from "@/components/marketing/logo"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { WorkspaceNav } from "./workspace-nav"

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
        {/*
          One row on a laptop and wider, with the sections centred between the
          identity and the account controls. Narrower than that the sections take
          a second row of their own rather than squeezing a long workspace name
          into nothing.
        */}
        <div className="mx-auto flex w-full max-w-[1160px] flex-wrap items-center gap-x-4 px-6 pt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-x-6 lg:py-3">
          <Link
            href={routes.workspace(workspace.slug)}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] sm:gap-4 lg:justify-self-start"
          >
            <span className="flex shrink-0 items-center gap-2 text-[var(--color-ink)]">
              <FanMark size={22} />
              <span className="font-display text-[19px] font-normal tracking-[-0.02em] max-sm:sr-only">
                Fanwise
              </span>
            </span>
            <span aria-hidden="true" className="h-5 w-px shrink-0 bg-[var(--color-rule)]" />
            <span className="truncate text-[15px] text-[var(--color-ink)]">{workspace.name}</span>
          </Link>
          {/*
            Products is listed although the identity link to the left also goes
            to the catalog. The identity says whose workspace this is; the
            sections say where in it you are, and a section list with the
            catalog missing has nowhere to put the current-page marker.
          */}
          <WorkspaceNav
            workspaceSlug={workspace.slug}
            className="order-last -mx-3 w-[calc(100%+1.5rem)] lg:order-none lg:mx-0 lg:w-auto"
          />
          <div className="flex shrink-0 items-center gap-3 lg:justify-self-end lg:gap-4">
            <ThemeToggle />
            <span aria-hidden="true" className="h-5 w-px bg-[var(--color-rule)]" />
            <form action={signOutAction}>
              <button
                type="submit"
                className="min-h-11 rounded-[6px] text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1160px] px-6 py-10">{children}</main>
    </div>
  )
}
