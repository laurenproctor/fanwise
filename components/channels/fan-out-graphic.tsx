import { FanMark } from "@/components/marketing/logo"

/**
 * One source, many listings: the first-run picture of what Fanwise does.
 *
 * It lives with the channel components because it names channels, and
 * invariant 2 keeps provider names here (tests/unit/channel-boundaries.test.ts).
 * It names them as copy, the way the marketing site does, and imports nothing
 * from the adapter layer. This is a picture of where a product can go, not a
 * statement of what is connected or what a channel can do; the channels page
 * reads the registry and says that.
 *
 * Text tiles rather than marks. The repository holds no licensed channel logos,
 * and a drawn imitation of one is not ours to ship.
 *
 * The connectors are decoration and hidden from assistive technology. The names
 * are a real list.
 */
const DESTINATIONS = ["Etsy", "Creative Market", "Gumroad", "Shopify", "Adobe"] as const

/** Every row, the closing "And more" included, is one hundred units of the drawing. */
const ROW_UNITS = 100
const ROWS = DESTINATIONS.length + 1
const HEIGHT = ROWS * ROW_UNITS

function connector(row: number): string {
  const from = HEIGHT / 2
  const to = row * ROW_UNITS + ROW_UNITS / 2
  return `M0 ${from} C 55 ${from}, 45 ${to}, 100 ${to}`
}

const ROW = "flex h-14 items-center gap-3 lg:h-[72px] xl:h-[84px]"
const DOT = "h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--color-accent)]"
const TILE =
  "whitespace-nowrap rounded-[12px] border px-3.5 py-2 text-[14px] xl:px-4 xl:py-2.5 xl:text-[15px]"

export function FanOutGraphic({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-stretch ${className}`}>
      <div aria-hidden="true" className="flex shrink-0 items-center">
        <span className="grid h-16 w-16 place-items-center rounded-full border border-[var(--color-accent)]/25 bg-[var(--color-card)] text-[var(--color-ink)] shadow-[0_0_0_8px_var(--color-accent-soft)] lg:h-20 lg:w-20 xl:h-24 xl:w-24">
          <FanMark size={30} />
        </span>
      </div>

      {/*
        The drawing stretches to the list beside it, so each curve lands on its
        row's dot at any row height. The stroke does not stretch with it.
      */}
      <div aria-hidden="true" className="relative w-12 shrink-0 sm:w-24 lg:w-32 xl:w-44">
        <svg
          viewBox={`0 0 100 ${HEIGHT}`}
          preserveAspectRatio="none"
          focusable="false"
          className="absolute inset-0 h-full w-full overflow-visible text-[var(--color-accent)]"
        >
          {Array.from({ length: ROWS }, (_, row) => (
            <path
              key={row}
              d={connector(row)}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="2 4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      <ul aria-label="Channels" className="flex min-w-0 flex-col">
        {DESTINATIONS.map((name) => (
          <li key={name} className={ROW}>
            <span aria-hidden="true" className={DOT} />
            <span
              className={`${TILE} border-[var(--color-rule)] bg-[var(--color-card)] text-[var(--color-ink)]`}
            >
              {name}
            </span>
          </li>
        ))}
        <li className={ROW}>
          <span aria-hidden="true" className={DOT} />
          <span
            className={`${TILE} border-dashed border-[var(--color-rule)] text-[var(--color-ink-2)]`}
          >
            And more
          </span>
        </li>
      </ul>
    </div>
  )
}
