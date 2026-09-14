"use client"

import Link from "next/link"
import { ListingPanel } from "@/components/channels/listing-panel"
import { PublishEverywhere } from "@/components/channels/publish-everywhere"
import { FIELD_IDS } from "@/lib/fonts/readiness"
import { routes } from "@/lib/routes"
import { markdownToPlainText } from "@/lib/text/markdown"
import { liveDraftValue, type ChannelDraftView, type DraftFieldOrigin } from "@/lib/fonts/workspace"
import type { SectionContext } from "../context"
import { OriginBadge, QUIET_BUTTON_CLASS, SectionHeading } from "../controls"

/**
 * Each connected channel's draft, and the one action that sends them.
 *
 * The channel cards and Publish Everywhere are the same components the product
 * page uses, not a font-shaped copy: building, rebuilding, publishing, the
 * steps a creator does by hand on an assisted channel, and the plan that names
 * what a run will skip before it is pressed (ADR 0005) all mean exactly what
 * they mean everywhere else. Publish Everywhere is absent, not disabled, where
 * no connected channel can publish at all.
 *
 * What this section adds is the answer to "if I edit the product, what
 * changes?". Every inheritable value is labelled with whose it is, read from
 * the listing row rather than guessed by comparing strings: "From the product"
 * means the column is empty and the draft follows the value being typed here;
 * "Only this channel" means it was customized there, and the product never
 * overwrites it. Customizing happens in the channel editor each card links to.
 */
export function MarketplaceDraftsSection({ ctx }: { ctx: SectionContext }) {
  const { channels, cards } = ctx
  const built = channels.filter((channel) => channel.listingId !== null)
  // Read from the live readiness, so fixing the last blocker enables the
  // buttons below without waiting for the server. The server re-checks anyway.
  const first = ctx.readiness.blockingAll[0]
  const blocker = first
    ? ctx.readiness.blockingAll.length === 1
      ? `Publishing is blocked: ${first.label.toLowerCase()}.`
      : `Publishing is blocked by ${ctx.readiness.blockingAll.length} issues, starting with: ${first.label.toLowerCase()}.`
    : null

  return (
    <div id={FIELD_IDS.drafts} tabIndex={-1} className="flex flex-col gap-6 outline-none">
      <SectionHeading
        title="Marketplace drafts"
        description="What each connected channel will receive, derived from the product. Nothing is sent until you publish."
      />

      {cards.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-[12px] border border-dashed border-[var(--color-rule)] px-5 py-6">
          <p className="text-[14.5px] text-[var(--color-ink-2)]">
            No channels are connected yet. Connect a storefront or marketplace and a draft for this
            font is derived from what you have entered here.
          </p>
          <Link href={routes.channels(ctx.workspaceSlug)} className={QUIET_BUTTON_CLASS}>
            Connect a channel
          </Link>
        </div>
      ) : (
        <>
          {ctx.canPublishSomewhere ? (
            <PublishEverywhere
              workspaceSlug={ctx.workspaceSlug}
              productId={ctx.productId}
              attemptable={ctx.attemptableChannels}
              skips={ctx.skips}
              blocker={blocker}
            />
          ) : null}

          <ListingPanel
            workspaceSlug={ctx.workspaceSlug}
            productSlug={ctx.productSlug}
            productId={ctx.productId}
            cards={cards}
            blocker={blocker}
          />

          {built.length > 0 ? (
            <section aria-labelledby="font-draft-origins" className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 id="font-draft-origins" className="text-[15px]">
                  What each draft says
                </h3>
                <p className="text-[12.5px] text-[var(--color-ink-3)]">
                  “From the product” follows your edits here. “Only this channel” was customized in
                  that channel’s draft and is never overwritten by the product.
                </p>
              </div>
              <ul className="flex flex-col divide-y divide-[var(--color-rule-2)] border-y border-[var(--color-rule)]">
                {built.map((channel) => (
                  <DraftOrigins key={channel.connectionId} ctx={ctx} channel={channel} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

function DraftOrigins({ ctx, channel }: { ctx: SectionContext; channel: ChannelDraftView }) {
  const { values, metadata } = ctx
  const price = liveDraftValue(channel, "price", values)
  const currency = channel.origins.price === "inherited" ? values.currency : channel.currency

  return (
    <li className="flex flex-col gap-2 py-3">
      <h4 className="text-[14px]">{channel.channelName}</h4>
      <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[8rem_minmax(0,1fr)]">
        {channel.origins.title !== "absent" ? (
          <DraftValue
            term="Title"
            value={liveDraftValue(channel, "title", values) as string | null}
            origin={channel.origins.title}
          />
        ) : null}
        {channel.origins.description !== "absent" ? (
          <DraftValue
            term="Description"
            value={excerpt(liveDraftValue(channel, "description", values) as string | null)}
            origin={channel.origins.description}
          />
        ) : null}
        <DraftValue
          term="Tags"
          value={channel.tags.length > 0 ? channel.tags.join(", ") : null}
          origin={null}
          note={
            channel.tags.length === 0 && (metadata.tags ?? []).length > 0
              ? "Product tags are not copied into drafts automatically. Add them in the draft."
              : undefined
          }
        />
        {channel.origins.price !== "absent" ? (
          <DraftValue
            term="Price"
            value={price === null ? null : `${price} ${currency}`}
            origin={channel.origins.price}
          />
        ) : null}
      </dl>
    </li>
  )
}

function excerpt(markdown: string | null): string | null {
  const text = markdownToPlainText(markdown).replace(/\s+/g, " ").trim()
  if (!text) return null
  return text.length > 180 ? `${text.slice(0, 180)}…` : text
}

function DraftValue({
  term,
  value,
  origin,
  note,
}: {
  term: string
  value: string | null
  /** Whose value it is, or null where the field has no product counterpart. */
  origin: Exclude<DraftFieldOrigin, "absent"> | null
  note?: string
}) {
  return (
    <>
      <dt className="text-[var(--color-ink-3)]">{term}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={`min-w-0 break-words ${value ? "" : "text-[var(--color-ink-3)]"}`}>
            {value ?? "Empty"}
          </span>
          {value && origin !== null ? (
            <OriginBadge origin={origin === "inherited" ? "product" : "channel"} />
          ) : null}
        </span>
        {note ? <span className="text-[12.5px] text-[var(--color-ink-3)]">{note}</span> : null}
      </dd>
    </>
  )
}
