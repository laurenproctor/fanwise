import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { listChannels, listConnections } from "@/lib/channels/queries"
import { findAdapter } from "@/lib/channels/registry"
import { CapabilityList } from "@/components/channels/capability-list"
import { ConnectButton } from "@/components/channels/connect-button"

export const metadata = { title: "Channels · Fanwise" }

/**
 * The channels surface.
 *
 * Every card states what the channel can actually do before it offers to
 * connect it. The capability list is read from the adapter, so a channel that
 * cannot publish cannot be made to look as though it can, whatever the database
 * says.
 */
export default async function ChannelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ error?: string }>
}) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const [channels, connections] = await Promise.all([listChannels(), listConnections(workspace.id)])

  const connectionByChannelId = new Map(connections.map((c) => [c.channel.id, c.connection]))

  // Surfaced by the OAuth callback, which redirects here rather than rendering
  // its own page: a failed authorization should leave the creator looking at
  // the thing they were trying to connect.
  const { error: connectError } = await searchParams

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="label-mono">Distribution</span>
        <h1 className="font-display text-4xl font-extralight tracking-[-0.03em]">Channels</h1>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          A channel is somewhere you sell. Fanwise keeps one canonical product and gives each
          channel its own translation of it.
        </p>
      </div>

      {connectError ? (
        <p
          role="alert"
          className="border-l-2 border-[var(--color-bad)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
        >
          {connectError}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {channels.map((channel) => {
          const adapter = findAdapter(channel.key)
          const connection = connectionByChannelId.get(channel.id) ?? null

          // A channel row with no adapter is not offered at all. It cannot be
          // connected, because nothing would know how to translate to it.
          if (!adapter) return null

          return (
            <section
              key={channel.id}
              className="flex flex-col gap-5 rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-card)] p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="grid gap-1">
                  <h2 className="font-display text-[22px] font-normal tracking-[-0.02em]">
                    {channel.name}
                  </h2>
                  <span className="label-mono">
                    {adapter.integrationType === "api" ? "Automatic" : "Assisted"}
                  </span>
                </div>
                {connection ? (
                  <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-ok)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ok)]">
                    <span className="h-[5px] w-[5px] rounded-full bg-current" aria-hidden />
                    Connected
                  </span>
                ) : null}
              </div>

              <p className="text-[14px] text-[var(--color-ink-2)]">
                {adapter.integrationType === "api"
                  ? "Fanwise can publish and update listings here directly."
                  : "Fanwise prepares the listing and you submit it. There is no API to publish through, so nothing here is automatic."}
              </p>

              <CapabilityList capabilities={adapter.capabilities} />

              <div className="mt-auto">
                <ConnectButton
                  workspaceSlug={slug}
                  channelKey={channel.key}
                  channelName={channel.name}
                  connectionId={connection?.id ?? null}
                  accountName={connection?.external_account_name ?? null}
                  disabled={channel.status !== "available"}
                  /*
                    Only the two strings the form needs. `adapter.oauth` holds
                    functions and a client secret's worth of behaviour; passing
                    the object itself would neither serialize nor belong in a
                    browser bundle.
                  */
                  oauth={
                    adapter.oauth
                      ? {
                          accountHintLabel: adapter.oauth.accountHintLabel,
                          accountHintPlaceholder: adapter.oauth.accountHintPlaceholder,
                        }
                      : null
                  }
                />
              </div>
            </section>
          )
        })}
      </div>

      {channels.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--color-rule)] p-10">
          <span className="label-mono">No channels yet</span>
        </div>
      ) : null}
    </div>
  )
}
