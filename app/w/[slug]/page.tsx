import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug, listWorkspaceMembers } from "@/lib/workspaces/queries"

export const metadata = { title: "Workspace · Fanwise" }

export default async function WorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const members = await listWorkspaceMembers(workspace.id)

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <span className="label-mono">Step A1 · tenancy</span>
        <h1 className="font-display text-5xl font-extralight tracking-[-0.04em] text-balance">
          {workspace.name}
        </h1>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          Your workspace exists and is isolated. Products arrive in the next step; until then there
          is nothing here to publish.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="label-mono">Details</h2>
        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-rule-2)] sm:grid-cols-3">
          {[
            { term: "Address", value: `/w/${workspace.slug}` },
            { term: "Your role", value: members.find((m) => m.user_id === user.id)?.role ?? "—" },
            { term: "Created", value: new Date(workspace.created_at).toLocaleDateString() },
          ].map(({ term, value }) => (
            <div key={term} className="flex flex-col gap-1.5 bg-[var(--color-card)] p-4">
              <dt className="label-mono">{term}</dt>
              <dd className="font-mono text-[13px] text-[var(--color-ink)]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="label-mono">Members</h2>
        <div className="overflow-x-auto rounded-[14px] border border-[var(--color-rule)]">
          <table className="w-full border-collapse bg-[var(--color-card)] text-left">
            <thead>
              <tr className="border-b border-[var(--color-rule)]">
                <th className="label-mono p-4 font-normal">Member</th>
                <th className="label-mono p-4 font-normal">Role</th>
                <th className="label-mono p-4 font-normal">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr
                  key={member.user_id}
                  className="border-b border-[var(--color-rule-2)] last:border-b-0"
                >
                  <td className="p-4 font-display text-[17px] font-normal">
                    {member.user_id === user.id ? (user.email ?? "You") : member.user_id}
                  </td>
                  <td className="p-4 font-mono text-[13px] text-[var(--color-ink-2)]">
                    {member.role}
                  </td>
                  <td className="tabular p-4 font-mono text-[13px] text-[var(--color-ink-2)]">
                    {new Date(member.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-[var(--color-ink-3)]">
          Inviting people is not part of V1. Every workspace has exactly one owner.
        </p>
      </section>
    </div>
  )
}
