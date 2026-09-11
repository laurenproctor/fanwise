import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { signOutAction } from "@/lib/workspaces/actions"
import { getCurrentUser, listWorkspaces } from "@/lib/workspaces/queries"
import { routes } from "@/lib/routes"

export const metadata = { title: "Setting up · Fanwise" }

/**
 * The failure state of first-run provisioning: the database refused the
 * workspace or did not answer. The reason was logged where it happened and is
 * not repeated here.
 */
export default async function OnboardingUnavailablePage() {
  if (!(await getCurrentUser())) redirect("/sign-in")

  // Reached by a back button after a retry succeeded, say.
  const [first] = await listWorkspaces()
  if (first) redirect(routes.workspace(first.slug))

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <span className="label-mono">Your studio</span>
        <h1 className="font-display text-3xl font-extralight tracking-[-0.03em]">
          Your studio is not ready yet
        </h1>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          Fanwise could not set up your workspace just now. Nothing was lost. Try again in a moment.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-6">
        {/*
          A plain GET form rather than a link. /onboarding is a route handler
          that provisions, and next/link would prefetch it in the background.
        */}
        <form action="/onboarding" method="get">
          <Button type="submit">Try again</Button>
        </form>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)]"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  )
}
