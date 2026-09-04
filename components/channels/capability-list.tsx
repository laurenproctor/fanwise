import { CAPABILITY_KEYS, CAPABILITY_LABELS, type ChannelCapabilities } from "@/lib/channels/types"

/**
 * What a channel can and cannot do, stated plainly.
 *
 * This exists because the alternative is a creator discovering the limit after
 * they have relied on it. A channel that cannot upload a file says so here,
 * before anyone builds a workflow around the assumption that it can.
 */
export function CapabilityList({ capabilities }: { capabilities: ChannelCapabilities }) {
  return (
    <ul className="grid gap-1.5">
      {CAPABILITY_KEYS.map((key) => {
        const supported = capabilities[key]
        return (
          <li key={key} className="flex items-start gap-2 text-[13.5px]">
            <span
              aria-hidden
              className={`mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full ${
                supported ? "bg-[var(--color-ok)]" : "bg-[var(--color-ink-3)]"
              }`}
            />
            <span className={supported ? "text-[var(--color-ink-2)]" : "text-[var(--color-ink-3)]"}>
              {CAPABILITY_LABELS[key]}
              {/* Never colour alone: the word carries the meaning too. */}
              {supported ? "" : " — not supported"}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
