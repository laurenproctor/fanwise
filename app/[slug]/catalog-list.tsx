import Link from "next/link"
import { InfoTip, Tip } from "@/components/ui/info-tip"
import { PRODUCT_TYPE_LABELS } from "@/lib/products/types"
import { routes } from "@/lib/routes"
import {
  CONCERN_TONES,
  concernDetail,
  concernLabel,
  liveChannelsDetail,
  liveChannelsLabel,
  nextAction,
  summarise,
  type CatalogAction,
  type CatalogConcern,
  type ConcernTone,
} from "@/lib/catalog/summary"
import type { CatalogEntry } from "@/lib/catalog/queries"

/**
 * The populated catalog: one line per product, four facts on each.
 *
 * A list rather than a `<table>`, which is a departure from the design system's
 * "tables are the workhorse" and is worth the sentence. The four columns have
 * to stack on a phone, and the usual way to stack a table — `display: block` on
 * its rows and cells — silently removes the table semantics that were the
 * reason to use one, in exactly the assistive technology it was meant to serve.
 * A list stacks natively, so the desktop grid is styling over a structure that
 * is already correct at every width, and every cell carries its own label
 * rather than depending on a header row that a phone never draws.
 *
 * The visual language is the table's regardless: hairline rules between rows,
 * mono column headers, the display face at 17px in the first column, no border
 * around each row. docs/design-system.md warns against stamping a card on every
 * block, and a catalog of bordered cards is that warning ignored twelve times.
 */

/** The four columns, in one place, so the header and the rows cannot drift. */
const COLUMNS =
  "md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.9fr)_minmax(0,1.15fr)_minmax(0,1.05fr)] md:items-center md:gap-4 lg:gap-6"

/** What one row renders. Derived once, in `toRow`, never recomputed in markup. */
export interface CatalogRow {
  id: string
  name: string
  typeLabel: string
  href: string
  updatedLabel: string
  thumbnailSrc: string | null
  concern: CatalogConcern
  tone: ConcernTone
  statusLabel: string
  statusDetail: string | null
  liveCount: number
  liveLabel: string
  liveDetail: string | null
  action: CatalogAction
}

/**
 * One loaded product to one rendered row.
 *
 * Exported and pure so the state-to-action mapping can be asserted directly
 * rather than read out of markup: the rules live in `lib/catalog/summary.ts`
 * and this is the only place they meet a URL.
 */
export function toRow(entry: CatalogEntry, workspaceSlug: string): CatalogRow {
  const { product } = entry
  const summary = summarise(entry.facts)

  return {
    id: product.id,
    name: product.name,
    typeLabel: PRODUCT_TYPE_LABELS[product.product_type],
    href: routes.product(workspaceSlug, product.slug),
    updatedLabel: new Date(product.updated_at).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    thumbnailSrc: entry.thumbnail
      ? routes.assetPreview(workspaceSlug, entry.thumbnail.assetId)
      : null,
    concern: summary.concern,
    tone: CONCERN_TONES[summary.concern],
    statusLabel: concernLabel(summary),
    statusDetail: concernDetail(summary),
    liveCount: entry.liveChannelNames.length,
    liveLabel: liveChannelsLabel(entry.liveChannelNames.length),
    liveDetail: liveChannelsDetail(entry.liveChannelNames),
    action: nextAction(summary, routes.product(workspaceSlug, product.slug)),
  }
}

const TONE_DOT: Record<ConcernTone, string> = {
  bad: "bg-[var(--color-bad)]",
  warn: "bg-[var(--color-warn)]",
  working: "bg-[var(--color-accent)]",
  ok: "bg-[var(--color-ok)]",
  quiet: "bg-[var(--color-ink-3)]",
}

export function CatalogList({ rows }: { rows: readonly CatalogRow[] }) {
  return (
    <div className="flex flex-col">
      {/*
        Visible from the width the grid appears at, and not before. Below that
        the rows are stacked and a header row would be four words floating over
        nothing — which is why every cell below carries its own label rather
        than relying on this.
      */}
      <div className={`${COLUMNS} hidden border-b border-[var(--color-rule)] px-2 pb-3`}>
        <span className="label-mono inline-flex items-center gap-1.5">
          Product
          <InfoTip term="canonicalProduct" />
        </span>
        <span className="label-mono inline-flex items-center gap-1.5">
          Status
          <InfoTip term="catalogStatus" />
        </span>
        <span className="label-mono inline-flex items-center gap-1.5">
          Live channels
          <InfoTip term="liveChannels" />
        </span>
        <span className="label-mono inline-flex items-center gap-1.5">
          Next action
          <InfoTip term="nextAction" />
        </span>
      </div>

      <ul role="list" aria-label="Products" className="flex flex-col">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`${COLUMNS} group flex flex-col gap-3 border-b border-[var(--color-rule-2)] px-2 py-4 transition-colors last:border-b-0 hover:bg-[var(--color-paper-2)]`}
          >
            {/*
              The link is the name, stretched over the whole cell by a
              pseudo-element, so the thumbnail and the space beside it are
              clickable while the accessible name stays "Meridian Serif" rather
              than the name, the type and a date read as one string.
            */}
            <div className="relative flex min-w-0 items-center gap-4">
              <Thumbnail src={row.thumbnailSrc} />
              <span className="flex min-w-0 flex-col gap-1">
                <Link
                  href={row.href}
                  className="font-display text-[17px] font-normal tracking-[-0.01em] break-words transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  {row.name}
                </Link>
                <span className="label-mono">
                  {row.typeLabel} · Updated {row.updatedLabel}
                </span>
              </span>
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-2 text-[15px] text-[var(--color-ink)]">
                {/*
                  A dot and a word, never a dot alone. docs/design-system.md:
                  state must be readable from form as well as colour, and the
                  colour here is spent on a 6px dot rather than on the text,
                  which is the variant that stays legible in both themes.
                */}
                <span
                  aria-hidden="true"
                  className={`h-[6px] w-[6px] shrink-0 rounded-full ${TONE_DOT[row.tone]}`}
                />
                <span className="sr-only">Status: </span>
                {row.statusLabel}
              </span>
              {row.statusDetail ? (
                <span className="text-[13px] leading-[1.45] text-[var(--color-ink-2)]">
                  {row.statusDetail}
                </span>
              ) : null}
            </div>

            <span className="inline-flex items-center gap-1.5 text-[15px] text-[var(--color-ink)]">
              <span className="tabular">{row.liveLabel}</span>
              {/*
                The count is a sentence on its own, and the tip adds the names.
                At zero there is no tip at all: a control that opens to say
                "none" has charged the reader for the word the label already
                gave them.
              */}
              {row.liveDetail ? (
                <Tip
                  label="Live channels"
                  body={row.liveDetail}
                  triggerLabel={`Which channels ${row.name} is live on`}
                />
              ) : null}
            </span>

            <span className="text-[15px]">
              <NextActionCell action={row.action} productName={row.name} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The action, as a link or as nothing you can press.
 *
 * `inert` is not a disabled control. A product whose files are still being
 * finalized is waiting on a background job, and a greyed-out button would
 * suggest the wait is a decision the creator could make differently.
 */
function NextActionCell({ action, productName }: { action: CatalogAction; productName: string }) {
  if (action.kind === "inert") {
    return (
      <span className="inline-flex items-center gap-2 text-[var(--color-ink-3)]">
        <span className="sr-only">Next action: </span>
        {action.label}
        <span className="sr-only">, nothing to do while this finishes</span>
      </span>
    )
  }

  return (
    <Link
      href={action.href}
      /*
        Raised above the product link's stretched overlay. The overlay is
        bounded by the product cell, so this is belt and braces — but the two
        controls are one tap apart on a phone and the wrong one winning is a
        bug nobody reports, they just stop using the row.
      */
      className="relative z-10 inline-flex items-center gap-1.5 rounded-[6px] text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      <span className="sr-only">Next action: </span>
      {action.label}
      <span className="sr-only"> for {productName}</span>
      <ArrowIcon />
    </Link>
  )
}

/**
 * The product's cover image, or a placeholder that does not pretend.
 *
 * The image is decorative: the product's name is the link it sits inside, and
 * an alt text here would read that name out twice. The same reasoning, and the
 * same plain `<img>`, as the listing image grid — the source redirects to a
 * short-lived signed URL on a private bucket, so there is nothing for the
 * optimizer to cache and a stale optimized copy would outlive its signature.
 */
function Thumbnail({ src }: { src: string | null }) {
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-[var(--color-rule)] bg-[var(--color-paper-2)]">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={48} height={48} className="h-full w-full object-cover" />
      ) : (
        <PlaceholderIcon />
      )}
    </span>
  )
}

function PlaceholderIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="text-[var(--color-ink-3)]"
    >
      <rect x="2.5" y="4" width="15" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="7.5" cy="8.5" r="1.3" fill="currentColor" />
      <path
        d="m4 14 3.8-3.6L11 13l2.3-2 2.7 2.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8h10m-4-4 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
