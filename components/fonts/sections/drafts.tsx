"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { buildListingAction } from "@/lib/channels/actions"
import { LIVENESS_LABELS, type ListingLiveness } from "@/lib/publishing/manual-steps"
import { FIELD_IDS } from "@/lib/fonts/readiness"
import { routes } from "@/lib/routes"
import { markdownToPlainText } from "@/lib/text/markdown"
import { liveDraftValue, type ChannelDraftView, type DraftFieldOrigin } from "@/lib/fonts/workspace"
import type { SectionContext } from "../context"
import {
  LINK_BUTTON_CLASS,
  OriginBadge,
  QUIET_BUTTON_CLASS,
  SectionHeading,
  StatusIcon,
} from "../controls"

/**
 * Each connected channel's draft, beside the product it was derived from.
 *
 * Every value is labelled with whose it is, read from the listing row rather
 * than guessed by comparing strings. "From the product" means the column is
 * empty and the draft inherits (docs/channel-adapters.md), so it is shown with
 * the value being typed on this screen; "Only this channel" means it was
 * customized there, and editing the product will not change it. That label is
 * the answer to "if I edit this, what changes?".
 *
 * This section builds a draft only where none exists and never regenerates an
 * existing one. Existing drafts open in the channel editor, which is where a
 * field is customized or handed back to the product.
 */
export function MarketplaceDraftsSection({ ctx }: { ctx: SectionContext }) {
  const { channels } = ctx

  return (
    <div id={FIELD_IDS.drafts} tabIndex={-1} className="flex flex-col gap-6 outline-none">
      <SectionHeading
        title="Marketplace drafts"
        description="What each connected channel will receive, derived from the product. Nothing is sent until you publish."
      />

      {channels.length === 0 ? (
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
        <ul className="flex flex-col gap-8">
          {channels.map((channel) => (
            <DraftCard key={channel.connectionId} ctx={ctx} channel={channel} />
          ))}
        </ul>
      )}
    </div>
  )
}

function DraftCard({ ctx, channel }: { ctx: SectionContext; channel: ChannelDraftView }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { values, metadata } = ctx

  const blocking = channel.results.filter((r) => r.severity === "error" && !r.satisfied)
  const warnings = channel.results.filter((r) => r.severity === "warning" && !r.satisfied)
  const passed = channel.results.filter((r) => r.satisfied && r.severity !== "info").length
  const status = blocking.length > 0 ? "error" : warnings.length > 0 ? "attention" : "complete"
  const livenessLabel =
    LIVENESS_LABELS[channel.liveness as ListingLiveness] ?? LIVENESS_LABELS.unpublished

  function build() {
    setError(null)
    startTransition(async () => {
      const result = await buildListingAction(
        ctx.workspaceSlug,
        ctx.productId,
        channel.connectionId,
      )
      if (result.error) setError(result.error)
      ctx.refresh()
    })
  }

  return (
    <li className="flex flex-col gap-4 border-t border-[var(--color-rule)] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-display text-[20px] font-normal tracking-[-0.01em]">
            {channel.channelName}
          </h3>
          <p className="text-[13px] text-[var(--color-ink-3)]">
            {channel.integrationType === "api" ? "Fanwise publishes" : "You submit it yourself"} ·{" "}
            {channel.listingId === null ? "No draft yet" : livenessLabel}
          </p>
        </div>
        {channel.listingId === null ? (
          <button type="button" className={QUIET_BUTTON_CLASS} onClick={build} disabled={pending}>
            {pending ? "Building…" : "Build draft"}
          </button>
        ) : (
          <span className="flex items-center gap-3">
            {channel.externalUrl ? (
              <a
                href={channel.externalUrl}
                target="_blank"
                rel="noreferrer"
                className={LINK_BUTTON_CLASS}
              >
                View on {channel.channelName}
              </a>
            ) : null}
            <Link href={channel.editHref} className={QUIET_BUTTON_CLASS}>
              Edit {channel.channelName} draft
            </Link>
          </span>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-[13.5px] text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {channel.listingId === null ? (
        <p className="text-[14px] text-[var(--color-ink-2)]">
          Build the draft to see its title, description, tags and price as {channel.channelName}{" "}
          will receive them, and what it would reject.
        </p>
      ) : (
        <>
          <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-[9rem_minmax(0,1fr)]">
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
            <DraftValue term="Category" value={channel.category} origin={null} />
            {channel.origins.price !== "absent" ? (
              <DraftValue
                term="Price"
                value={(() => {
                  const price = liveDraftValue(channel, "price", values)
                  const currency =
                    channel.origins.price === "inherited" ? values.currency : channel.currency
                  return price === null ? null : `${price} ${currency}`
                })()}
                origin={channel.origins.price}
              />
            ) : null}
          </dl>
          <p className="text-[12.5px] text-[var(--color-ink-3)]">
            “From the product” follows your edits here. “Only this channel” was customized in the{" "}
            {channel.channelName} draft and is never overwritten by the product.
          </p>

          <div className="flex flex-col gap-2">
            <h4 className="flex items-center gap-2 text-[14px]">
              <StatusIcon status={status} size={18} />
              {blocking.length > 0
                ? `${blocking.length} ${blocking.length === 1 ? "issue blocks" : "issues block"} ${channel.channelName}`
                : warnings.length > 0
                  ? `Ready for ${channel.channelName}, with ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`
                  : `Ready for ${channel.channelName}`}
              <span className="text-[12.5px] text-[var(--color-ink-3)]">
                · {passed} of {channel.results.filter((r) => r.severity !== "info").length} checks
                pass
              </span>
            </h4>
            {blocking.length + warnings.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {[...blocking, ...warnings].map((result) => (
                  <li key={result.key} className="flex items-start gap-2 text-[13.5px]">
                    <StatusIcon
                      status={result.severity === "error" ? "error" : "attention"}
                      size={16}
                    />
                    <span>
                      {result.message ?? result.label}{" "}
                      <span className="text-[var(--color-ink-3)]">
                        {result.severity === "error"
                          ? `Blocks ${channel.channelName} only.`
                          : "Does not block publishing."}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      )}
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
  const fromProduct = origin === null ? null : origin === "inherited"
  return (
    <>
      <dt className="text-[var(--color-ink-3)]">{term}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={`min-w-0 break-words ${value ? "" : "text-[var(--color-ink-3)]"}`}>
            {value ?? "Empty"}
          </span>
          {value && fromProduct !== null ? (
            <OriginBadge origin={fromProduct ? "product" : "channel"} />
          ) : null}
        </span>
        {note ? <span className="text-[12.5px] text-[var(--color-ink-3)]">{note}</span> : null}
      </dd>
    </>
  )
}
