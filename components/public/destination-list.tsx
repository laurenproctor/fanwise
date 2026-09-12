"use client"

import { useRef } from "react"
import { ChannelMark } from "@/components/channels/channel-mark"
import { publicMediaRoutes } from "@/lib/public/media-routes"
import { formatPrice } from "./product-card"
import type { PublicDestination } from "@/lib/public/types"

/**
 * Where a visitor can buy this, and the click that takes them there.
 *
 * ## The links
 *
 * Every href here was validated server-side by `safeExternalUrl`, so nothing
 * but a plain https URL reaches this component. It still carries
 * `rel="noopener noreferrer nofollow"` and `target="_blank"`:
 *
 *   - `noopener` because a new tab opened without it can reach back through
 *     `window.opener` and navigate the page that opened it. That is a
 *     marketplace listing, edited by whoever owns the shop, being able to
 *     replace a Fanwise page with anything.
 *   - `noreferrer` so the destination is not told which creator's page sent
 *     the visitor.
 *   - `nofollow` because these are creator-submitted outbound links, and a
 *     page of them is exactly the shape a link farm takes.
 *
 * ## The click record
 *
 * `sendBeacon`, not `fetch`. A beacon is queued by the browser and survives
 * the navigation that is about to happen; a `fetch` from a page that is
 * unloading is cancelled, which is why click tracking so often either loses
 * the click or blocks it with an `await` first. Nothing here is awaited and
 * nothing prevents the default — the link navigates exactly as it would if
 * this handler did not exist, including a middle click or a right-click open,
 * which is also why the handler is on the anchor rather than replacing it with
 * a button.
 *
 * The payload is two ids. Everything stored — the workspace, the profile, the
 * referrer host — is re-derived server-side, so a crafted beacon cannot write
 * a row that says something untrue.
 */
export function DestinationList({
  pageId,
  destinations,
  campaign,
}: {
  pageId: string
  destinations: PublicDestination[]
  campaign?: string | null
}) {
  const listRef = useRef<HTMLUListElement>(null)

  function record(channelId: string) {
    // Absent in older browsers and in some privacy modes. The click is the
    // point; the record is not worth a single broken navigation.
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return

    try {
      const body = JSON.stringify({
        pageId,
        channelId,
        ...(campaign ? { campaign } : {}),
      })
      navigator.sendBeacon(
        publicMediaRoutes.outboundClick(),
        new Blob([body], { type: "application/json" }),
      )
    } catch {
      // Nothing to do and nobody to tell: the visitor is already leaving.
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] p-5">
      <h2 id="where-to-buy" className="label-mono">
        Available from
      </h2>

      <ul ref={listRef} aria-labelledby="where-to-buy" className="flex flex-col">
        {destinations.map((destination, index) => (
          <li
            key={destination.channelId}
            className={
              index === 0
                ? "flex items-center gap-3 py-3"
                : "flex items-center gap-3 border-t border-[var(--color-rule-2)] py-3"
            }
          >
            <ChannelMark
              channelKey={destination.channelKey}
              channelName={destination.channelName}
              size={32}
            />
            <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--color-ink)]">
              {destination.channelName}
            </span>
            {destination.price !== null ? (
              <span className="tabular shrink-0 text-[15px] text-[var(--color-ink)]">
                {formatPrice({ amount: destination.price, currency: destination.currency })}
              </span>
            ) : (
              // A channel that has not quoted a price still gets a row: the
              // link is the useful part, and an invented number is not.
              <span className="shrink-0 text-[13px] text-[var(--color-ink-3)]">See price</span>
            )}
            <a
              href={destination.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={() => record(destination.channelId)}
              onAuxClick={(event) => {
                // A middle click opens a tab too, and is how a lot of people
                // browse a list like this one.
                if (event.button === 1) record(destination.channelId)
              }}
              className="shrink-0 rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-4 py-2 text-[14px] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              {/*
                The channel's name is in the accessible label because "View" on
                its own, read out of a list of four, says nothing about which
                shop it opens.
              */}
              <span aria-hidden>View</span>
              <span className="sr-only">View on {destination.channelName}, opens in a new tab</span>
            </a>
          </li>
        ))}
      </ul>

      <p className="border-t border-[var(--color-rule-2)] pt-3 text-[13px] text-[var(--color-ink-3)]">
        Prices and licenses may vary by channel.
      </p>
    </div>
  )
}

/**
 * The primary call to action, which scrolls to the list rather than choosing
 * a shop on the visitor's behalf.
 *
 * Picking one for them would mean ranking marketplaces, and Fanwise has no
 * basis to: the cheapest is not always the one with the license they need,
 * and a creator's own store is not always the one they want pushed. So the
 * button's whole job is to get the list in front of them.
 *
 * An anchor, not a button with a scroll handler, so it works before hydration
 * and so the destination is a real place the browser can put the focus.
 */
export function ChooseWhereToBuy({ count }: { count: number }) {
  return (
    <a
      href="#where-to-buy"
      className="inline-flex items-center justify-center rounded-[var(--radius-pill)] border border-[var(--color-action)] bg-[var(--color-action)] px-[22px] py-[12px] text-[15px] font-medium text-[var(--color-on-action)] transition-colors hover:border-[var(--color-action-hover)] hover:bg-[var(--color-action-hover)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
    >
      Choose where to buy
      <span className="sr-only">
        {" "}
        — {count} {count === 1 ? "channel" : "channels"} below
      </span>
    </a>
  )
}
