import type { LedgerEntry } from "@/lib/billing/queries"

/**
 * The ledger, newest first.
 *
 * Every connection and disconnection is here whether or not it cost
 * anything, because a creator asking "what am I being charged for" deserves
 * the whole list and not the expensive half. The status column says which
 * rows reached the provider.
 */
export function BillingLedger({ entries }: { entries: LedgerEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[var(--color-rule)] p-6">
        <span className="label-mono">No billing events yet</span>
        <p className="mt-2 text-[13px] text-[var(--color-ink-3)]">
          Connecting or disconnecting a channel is recorded here.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-[var(--color-rule)]">
      <table className="w-full border-collapse bg-[var(--color-card)] text-left">
        <thead>
          <tr className="border-b border-[var(--color-rule)]">
            <th className="label-mono p-4 font-normal">Event</th>
            <th className="label-mono p-4 font-normal">Channel</th>
            <th className="label-mono p-4 font-normal">Status</th>
            <th className="label-mono p-4 font-normal">When</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-[var(--color-rule-2)] last:border-b-0">
              <td className="p-4 text-[14px]">
                {entry.kind === "channel_connected" ? "Connected" : "Disconnected"}
              </td>
              <td className="p-4 text-[14px]">{entry.channelName}</td>
              <td className="p-4 font-mono text-[12px] text-[var(--color-ink-2)]">
                {describe(entry)}
              </td>
              <td className="tabular p-4 font-mono text-[12px] text-[var(--color-ink-2)]">
                {new Date(entry.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function describe(entry: LedgerEntry): string {
  if (!entry.billable) return "included"
  switch (entry.status) {
    case "pending":
      return "not yet billed"
    case "applied":
      return "on the subscription"
    case "skipped":
      return "included"
    case "failed":
      return entry.message ? `failed: ${entry.message}` : "failed"
  }
}
