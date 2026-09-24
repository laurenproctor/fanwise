import Link from "next/link"
import {
  ANALYTICS_PERIODS,
  percentChange,
  type AnalyticsPeriod,
  type ProfileAnalytics,
} from "@/lib/public/analytics"

/**
 * The Visitors section of the Profile page: how many people looked at the
 * public profile and its product pages, what sent them, which products they
 * opened, and where they went to buy.
 *
 * A server component with no client code. The period is a link (`?days=`), so
 * it survives a refresh and the back button, and the chart's hover labels are
 * CSS; the same numbers are in a table under it for anyone who cannot hover.
 *
 * The figures are an honest floor and the copy says so: a visitor without
 * JavaScript, a crawler and the creator themselves are not counted.
 */
export function ProfileAnalyticsView({
  analytics,
  period,
  basePath,
  live,
}: {
  analytics: ProfileAnalytics | null
  period: AnalyticsPeriod
  basePath: string
  live: boolean
}) {
  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Period" className="flex flex-wrap items-center gap-2">
        {ANALYTICS_PERIODS.map((days) => (
          <Link
            key={days}
            href={`${basePath}?days=${days}#visitors`}
            scroll={false}
            aria-current={days === period ? "true" : undefined}
            className={`inline-flex min-h-9 items-center rounded-[var(--radius-pill)] border px-4 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
              days === period
                ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]"
                : "border-[var(--color-rule)] text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
            }`}
          >
            Last {days} days
          </Link>
        ))}
      </nav>

      {analytics === null ? (
        <p className="rounded-[14px] border border-dashed border-[var(--color-rule)] px-5 py-8 text-[14px] text-[var(--color-ink-2)]">
          Visitor numbers could not be loaded just now. Refresh the page to try again.
        </p>
      ) : (
        <Loaded analytics={analytics} live={live} />
      )}
    </div>
  )
}

function Loaded({ analytics, live }: { analytics: ProfileAnalytics; live: boolean }) {
  const total = analytics.profileViews + analytics.productViews + analytics.outboundClicks
  const nothingYet = total === 0

  return (
    <>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="Profile views"
          value={analytics.profileViews}
          previous={analytics.previousProfileViews}
          days={analytics.days}
        />
        <StatTile
          label="Product page views"
          value={analytics.productViews}
          previous={analytics.previousProductViews}
          days={analytics.days}
        />
        <StatTile
          label="Clicks to your channels"
          value={analytics.outboundClicks}
          previous={analytics.previousOutboundClicks}
          days={analytics.days}
        />
      </dl>

      {nothingYet ? (
        <p className="rounded-[14px] border border-dashed border-[var(--color-rule)] px-5 py-8 text-[14px] text-[var(--color-ink-2)]">
          {live
            ? "No visits in this period yet. Share your profile's address and they will show up here, usually within a minute."
            : "Your profile is not live, so nobody can visit it yet. Publish it and visits will show up here."}
        </p>
      ) : (
        <>
          <DailyChart daily={analytics.daily} />
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <RankedTable
              caption="Top products"
              columns={["Product", "Views", "Clicks"]}
              rows={analytics.products.map((product) => [
                product.title,
                product.views,
                product.clicks,
              ])}
              empty="No product pages visited in this period."
            />
            <RankedTable
              caption="Where visitors came from"
              columns={["Source", "Views"]}
              rows={analytics.referrers.map((referrer) => [
                referrer.host ?? "Direct or unknown",
                referrer.views,
              ])}
              empty="No visits in this period."
            />
            <RankedTable
              caption="Where visitors went to buy"
              columns={["Channel", "Clicks"]}
              rows={analytics.channels.map((channel) => [channel.name, channel.clicks])}
              empty="Nobody clicked through to a channel in this period."
            />
          </div>
        </>
      )}

      <p className="text-[13px] text-[var(--color-ink-3)]">
        Counts are in UTC days. A reload in the same tab counts once, and visits from you, your
        teammates, search crawlers and link previews are left out. Fanwise stores no visitor
        identity: no IP address, no cookie, only the page, the time and the site that sent them.
      </p>
    </>
  )
}

function StatTile({
  label,
  value,
  previous,
  days,
}: {
  label: string
  value: number
  previous: number
  days: number
}) {
  const change = percentChange(value, previous)
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-4">
      <dt className="label-mono">{label}</dt>
      <dd className="font-display tabular text-[34px] leading-none font-light tracking-[-0.03em] text-[var(--color-ink)]">
        {value.toLocaleString("en-US")}
      </dd>
      <dd className="text-[13px] text-[var(--color-ink-2)]">
        {change === null
          ? previous === 0 && value > 0
            ? `None in the ${days} days before`
            : `Same as the ${days} days before`
          : change === 0
            ? `Same as the ${days} days before`
            : `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% on the ${days} days before`}
      </dd>
    </div>
  )
}

/**
 * Views per day, profile and product pages together. One series, so no
 * legend: the heading names it. A bar per day, anchored to the baseline, with
 * a 2px gap between bars; a day with no views keeps a hairline so the axis
 * reads as continuous time rather than missing data.
 */
function DailyChart({ daily }: { daily: ProfileAnalytics["daily"] }) {
  const values = daily.map((day) => day.profileViews + day.productViews)
  const max = Math.max(1, ...values)
  const first = daily[0]
  const last = daily[daily.length - 1]

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="text-[14px] text-[var(--color-ink)]">Views per day</span>
        <span className="label-mono tabular">Peak {max.toLocaleString("en-US")}</span>
      </figcaption>
      <div
        aria-hidden
        className="flex h-40 items-end gap-[2px] border-b border-[var(--color-rule)]"
      >
        {daily.map((day, index) => {
          const value = values[index]!
          return (
            <div key={day.day} className="group relative flex h-full min-w-0 flex-1 items-end">
              <div
                className="w-full rounded-t-[4px] bg-[var(--color-accent)] transition-opacity group-hover:opacity-80"
                style={{ height: value === 0 ? "1px" : `${(value / max) * 100}%` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-[8px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2 text-[12px] whitespace-nowrap text-[var(--color-ink)] shadow-sm group-hover:block">
                <span className="block text-[var(--color-ink-2)]">{formatDay(day.day)}</span>
                <span className="tabular block">
                  {value.toLocaleString("en-US")} {value === 1 ? "view" : "views"}
                </span>
                <span className="tabular block text-[var(--color-ink-3)]">
                  Profile {day.profileViews} · Products {day.productViews}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      {first && last ? (
        <div aria-hidden className="flex justify-between text-[12px] text-[var(--color-ink-3)]">
          <span>{formatDay(first.day)}</span>
          <span>{formatDay(last.day)}</span>
        </div>
      ) : null}
      <details className="text-[13px] text-[var(--color-ink-2)]">
        <summary className="cursor-pointer select-none hover:text-[var(--color-ink)]">
          Show as a table
        </summary>
        <table className="mt-3 w-full text-left">
          <caption className="sr-only">Views per day</caption>
          <thead>
            <tr className="border-b border-[var(--color-rule)]">
              <th scope="col" className="py-2 font-normal">
                Day
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Profile
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Products
              </th>
            </tr>
          </thead>
          <tbody>
            {daily.map((day) => (
              <tr key={day.day} className="border-b border-[var(--color-rule-2)]">
                <th scope="row" className="py-1.5 font-normal">
                  {formatDay(day.day)}
                </th>
                <td className="tabular py-1.5 text-right">{day.profileViews}</td>
                <td className="tabular py-1.5 text-right">{day.productViews}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

function RankedTable({
  caption,
  columns,
  rows,
  empty,
}: {
  caption: string
  columns: string[]
  rows: Array<Array<string | number>>
  empty: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[14px] text-[var(--color-ink)]">{caption}</h3>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[var(--color-ink-3)]">{empty}</p>
      ) : (
        <table className="w-full text-left text-[14px]">
          <thead>
            <tr className="border-b border-[var(--color-rule)]">
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={`label-mono py-2 font-normal ${index === 0 ? "" : "text-right"}`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-[var(--color-rule-2)] last:border-b-0">
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th
                      key={cellIndex}
                      scope="row"
                      className="max-w-0 truncate py-2 pr-4 font-normal text-[var(--color-ink)]"
                    >
                      {cell}
                    </th>
                  ) : (
                    <td
                      key={cellIndex}
                      className="tabular w-16 py-2 text-right whitespace-nowrap text-[var(--color-ink-2)]"
                    >
                      {typeof cell === "number" ? cell.toLocaleString("en-US") : cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** "Sep 12", from a UTC calendar day. Fixed locale: this renders on the server. */
function formatDay(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}
