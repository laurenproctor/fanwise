import { redirect } from "next/navigation"
import { getCurrentUser, listWorkspaces } from "@/lib/workspaces/queries"
import { CreateWorkspaceForm } from "./create-workspace-form"
import { routes } from "@/lib/routes"

export const metadata = { title: "Create a workspace · Fanwise" }

export default async function OnboardingPage() {
  if (!(await getCurrentUser())) redirect("/sign-in")

  // One workspace per user in V1. Someone who already has one has no business here.
  const workspaces = await listWorkspaces()
  const first = workspaces[0]
  if (first) redirect(routes.workspace(first.slug))

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <span className="label-mono">Step one of one</span>
        <h1 className="font-display text-3xl font-extralight tracking-[-0.03em]">
          Name your workspace
        </h1>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          Your workspace holds your products and the channels you publish them to. You can rename it
          later; the address stays put.
        </p>
      </div>
      <CreateWorkspaceForm />
    </main>
  )
}
