"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { saveProfileProductsAction } from "@/lib/public/draft-actions"
import {
  createDraftAutosave,
  type AutosaveStatus,
  type DraftAutosave,
} from "@/lib/public/draft-autosave"
import {
  INELIGIBLE_MESSAGES,
  counts,
  isReorderKey,
  isShown,
  moveForKey,
  moveTo,
  setAllVisible,
  toDraftProducts,
  toPresentationProducts,
  toggleVisible,
  type ArrangementRow,
} from "@/lib/public/product-arrangement"
import type { DraftProduct } from "@/lib/public/profile-draft"
import type { ProfilePresentation } from "@/lib/public/profile-presentation"
import { routes } from "@/lib/routes"
import { UnsavedChangesGuard } from "../../unsaved-changes-guard"
import { DraftStatus } from "./builder-status"
import { ProfilePreview } from "./profile-preview"

/**
 * Step 2 of the builder: which products the profile shows, and in what order.
 *
 * All the rules live in `lib/public/product-arrangement.ts`; this file turns
 * gestures into calls to it and hands the result to three places at once: the
 * list, the preview (same render, so both change together), and the autosave.
 *
 * Reordering has two equal routes. A pointer drags the handle; a keyboard
 * focuses the same handle and uses the arrow keys, Home and End. Each row is
 * keyed by product id, so the handle's DOM node survives its own move and
 * focus stays on it through repeated presses. Every move is announced with
 * the new position.
 *
 * Nothing on this screen changes a listing. The switch removes a product from
 * the public profile only, and the copy says so.
 */

export function ManageProductsStep({
  workspaceSlug,
  origin,
  published,
  identity,
  initial,
  unlistedCount,
}: {
  workspaceSlug: string
  origin: string
  published: boolean
  /** Step 1's profile, without products; the products come from the rows. */
  identity: ProfilePresentation
  initial: {
    rows: ArrangementRow[]
    revision: number
    stored: boolean
    /** Whether the draft already holds an arrangement, as opposed to the default. */
    arranged: boolean
  }
  /** Ineligible products not on the list, counted so their absence is explained. */
  unlistedCount: number
}) {
  const router = useRouter()
  const [rows, setRows] = useState<readonly ArrangementRow[]>(initial.rows)
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>(initial.stored ? "saved" : "idle")
  const [announcement, setAnnouncement] = useState("")
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<"back" | "continue" | null>(null)
  const [formMessage, setFormMessage] = useState<string | null>(null)

  const autosave = useRef<DraftAutosave<DraftProduct[]> | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const latest = useRef<readonly ArrangementRow[]>(initial.rows)
  /** The order when a drag began, so a press that moves nothing saves nothing. */
  const dragOrigin = useRef<readonly ArrangementRow[] | null>(null)

  useEffect(() => {
    const controller = createDraftAutosave<DraftProduct[]>({
      initialRevision: initial.revision,
      debounceMs: 500,
      save: (products, revision) =>
        saveProfileProductsAction(workspaceSlug, { products, revision }),
      onStatus: setSaveStatus,
    })
    autosave.current = controller
    // A draft that has never been arranged is stored once, on open, so the
    // default selection the creator is looking at is the one that persists
    // and the one Step 3 will publish. An arranged draft is not rewritten.
    if (!initial.arranged && initial.rows.length > 0) {
      controller.change(toDraftProducts(initial.rows))
    }
    return () => controller.dispose()
    // The controller owns the revision from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug])

  function commit(next: readonly ArrangementRow[], message?: string) {
    latest.current = next
    setRows(next)
    setFormMessage(null)
    if (message) setAnnouncement(message)
    autosave.current?.change(toDraftProducts(next))
  }

  // ---- Visibility ----------------------------------------------------------

  function onToggle(row: ArrangementRow) {
    const next = toggleVisible(latest.current, row.product.id)
    const nowShown = next.find((r) => r.product.id === row.product.id)?.visible ?? false
    commit(
      next,
      nowShown
        ? `${row.product.title} is shown on your profile.`
        : `${row.product.title} is hidden from your profile. Its shop listings are unchanged.`,
    )
  }

  const { selected, selectable } = counts(rows)
  const allSelected = selectable > 0 && selected === selectable

  function onSelectAll() {
    commit(
      setAllVisible(latest.current, !allSelected),
      allSelected
        ? "All products hidden from your profile."
        : "All products shown on your profile.",
    )
  }

  // ---- Reordering ----------------------------------------------------------

  function positionMessage(next: readonly ArrangementRow[], productId: string): string {
    const index = next.findIndex((r) => r.product.id === productId)
    const title = next[index]?.product.title ?? "Product"
    return `${title} moved to position ${index + 1} of ${next.length}.`
  }

  function onHandleKeyDown(event: React.KeyboardEvent, productId: string) {
    if (!isReorderKey(event.key)) return
    event.preventDefault()
    const current = latest.current
    const next = moveForKey(current, productId, event.key)
    if (next === current) {
      const index = current.findIndex((r) => r.product.id === productId)
      const title = current[index]?.product.title ?? "Product"
      setAnnouncement(index === 0 ? `${title} is already first.` : `${title} is already last.`)
      return
    }
    commit(next, positionMessage(next, productId))
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>, productId: string) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragOrigin.current = latest.current
    setDraggingId(productId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>, productId: string) {
    if (draggingId !== productId || !listRef.current) return
    // The target index is the number of *other* rows whose midpoint sits above
    // the pointer. Measured live, so it holds while rows move under it.
    const others = [...listRef.current.querySelectorAll<HTMLElement>("[data-row-id]")].filter(
      (element) => element.dataset.rowId !== productId,
    )
    const target = others.filter((element) => {
      const box = element.getBoundingClientRect()
      return box.top + box.height / 2 < event.clientY
    }).length
    const next = moveTo(latest.current, productId, target)
    if (next !== latest.current) {
      latest.current = next
      setRows(next)
    }
  }

  function onPointerEnd(productId: string) {
    if (draggingId !== productId) return
    setDraggingId(null)
    const origin = dragOrigin.current
    dragOrigin.current = null
    if (origin === latest.current) return
    commit(latest.current, positionMessage(latest.current, productId))
  }

  // ---- Leaving -------------------------------------------------------------

  async function leave(direction: "back" | "continue") {
    const saver = autosave.current
    if (!saver) return
    setLeaving(direction)
    const stored = await saver.flush()
    if (!stored) {
      setLeaving(null)
      setFormMessage(
        saver.status() === "conflict"
          ? "This draft was changed in another tab. Reload to see the latest version."
          : "Your product choices could not be saved. Try again.",
      )
      return
    }
    router.push(
      direction === "back"
        ? routes.publicProfileBuilder(workspaceSlug)
        : routes.publicProfileBuilderPublish(workspaceSlug),
    )
  }

  // ---- Derived -------------------------------------------------------------

  const presentation = useMemo<ProfilePresentation>(
    () => ({ ...identity, products: toPresentationProducts(rows) }),
    [identity, rows],
  )

  const unsaved = saveStatus === "pending" || saveStatus === "saving" || saveStatus === "error"

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <UnsavedChangesGuard when={unsaved} />

      <section
        aria-labelledby="manage-products-heading"
        className="flex min-w-0 flex-col gap-5 px-5 py-8 sm:px-10"
      >
        <div className="flex flex-col gap-2">
          <span className="label-mono">Product display</span>
          <h2
            id="manage-products-heading"
            className="font-display text-[32px] leading-[1.1] font-light tracking-[-0.03em] sm:text-[38px]"
          >
            Choose what customers see
          </h2>
          <p className="text-[16px] text-[var(--color-ink-2)]">
            Select the products to feature and arrange the order they appear.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-[12px] border border-dashed border-[var(--color-rule)] px-5 py-8">
            <p className="text-[15px] text-[var(--color-ink)]">
              No products are live in a connected shop yet.
            </p>
            <p className="text-[14px] text-[var(--color-ink-2)]">
              Products appear here once at least one of their listings is live. You can continue now
              and add products later.
            </p>
            <Link
              href={routes.workspace(workspaceSlug)}
              className="text-[14px] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              Go to your products
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="tabular text-[15px] text-[var(--color-ink)]" aria-live="polite">
                {selected} of {selectable} selected
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={onSelectAll}
                disabled={selectable === 0}
                className="px-4 py-2 text-[14px]"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </Button>
            </div>

            <p id="reorder-instructions" className="sr-only">
              To reorder, focus a product&rsquo;s drag handle and press the up or down arrow keys.
              Home moves it first, End moves it last.
            </p>

            <ol
              ref={listRef}
              aria-label="Products on your profile, in display order"
              className="flex flex-col border-t border-[var(--color-rule)]"
            >
              {rows.map((row, index) => (
                <ProductRow
                  key={row.product.id}
                  row={row}
                  position={index + 1}
                  total={rows.length}
                  dragging={draggingId === row.product.id}
                  onToggle={() => onToggle(row)}
                  onHandleKeyDown={(event) => onHandleKeyDown(event, row.product.id)}
                  onPointerDown={(event) => onPointerDown(event, row.product.id)}
                  onPointerMove={(event) => onPointerMove(event, row.product.id)}
                  onPointerEnd={() => onPointerEnd(row.product.id)}
                />
              ))}
            </ol>
          </>
        )}

        <p className="text-[14px] text-[var(--color-ink-2)]">
          Drag products to reorder them. Hidden products stay published in their connected shops.
        </p>

        {unlistedCount > 0 ? (
          <p className="text-[13px] text-[var(--color-ink-3)]">
            {unlistedCount === 1
              ? "1 product isn't listed because it isn't live in a connected shop."
              : `${unlistedCount} products aren't listed because they aren't live in a connected shop.`}
          </p>
        ) : null}

        {rows.length > 0 && selected === 0 ? (
          <p className="flex items-start gap-2 border-l-2 border-[var(--color-rule)] py-1 pl-3 text-[14px] text-[var(--color-ink-2)]">
            No products are selected, so your profile will show an empty product section. You can
            still continue.
          </p>
        ) : null}

        {formMessage ? (
          <p
            role="alert"
            className="border-l-2 border-[var(--color-bad)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px]"
          >
            {formMessage}
          </p>
        ) : null}

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-2">
          <Button
            type="button"
            onClick={() => void leave("continue")}
            disabled={leaving !== null}
            className="min-w-[160px] max-sm:w-full"
          >
            {leaving === "continue" ? "Saving…" : "Continue"}
          </Button>
          <button
            type="button"
            onClick={() => void leave("back")}
            disabled={leaving !== null}
            className="inline-flex min-h-11 items-center rounded-[6px] text-[15px] text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            Back
          </button>
          <DraftStatus status={saveStatus} onRetry={() => autosave.current?.retry()} />
        </div>
      </section>

      <div className="min-w-0 border-t border-[var(--color-rule)] px-5 py-8 sm:px-8 lg:border-t-0 lg:border-l">
        <ProfilePreview
          heading="Live preview"
          subheading="Updates as you edit"
          origin={origin}
          presentation={presentation}
          published={published}
          emptyProductsMessage="No products selected yet. Turn a product on to show it here."
        />
      </div>
    </div>
  )
}

function ProductRow({
  row,
  position,
  total,
  dragging,
  onToggle,
  onHandleKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
}: {
  row: ArrangementRow
  position: number
  total: number
  dragging: boolean
  onToggle: () => void
  onHandleKeyDown: (event: React.KeyboardEvent) => void
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void
  onPointerEnd: () => void
}) {
  const { product } = row
  const eligible = product.eligibility.eligible
  const shown = isShown(row)
  const reasonId = `product-${product.id}-reason`

  return (
    <li
      data-row-id={product.id}
      data-shown={shown}
      className={`flex items-center gap-3 border-b border-[var(--color-rule)] py-3 sm:gap-4 ${
        dragging ? "bg-[var(--color-paper-2)]" : ""
      }`}
    >
      <button
        type="button"
        aria-label={`Reorder ${product.title}, position ${position} of ${total}`}
        aria-describedby="reorder-instructions"
        onKeyDown={onHandleKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className={`flex h-11 w-8 shrink-0 touch-none items-center justify-center rounded-[6px] text-[var(--color-ink-3)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        <HandleGlyph />
      </button>

      <Thumbnail title={product.title} url={product.imageUrl} dimmed={!shown} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`text-[16px] break-words ${shown ? "text-[var(--color-ink)]" : "text-[var(--color-ink-2)]"}`}
        >
          {product.title}
        </span>
        <span className="text-[14px] text-[var(--color-ink-3)]">{product.typeLabel}</span>
        {!eligible ? (
          <span id={reasonId} className="text-[13px] text-[var(--color-ink-2)]">
            {INELIGIBLE_MESSAGES[product.eligibility.reason]}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={shown}
        aria-label={`Show ${product.title} on your profile`}
        aria-describedby={eligible ? undefined : reasonId}
        // An ineligible product cannot be switched on. One still switched on can
        // be switched off, which is what step 3 asks for before publishing.
        disabled={!eligible && !row.visible}
        onClick={onToggle}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
          shown
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
            : "border-[var(--color-rule)] bg-[var(--color-paper-2)]"
        }`}
      >
        <span
          aria-hidden
          className={`absolute h-5 w-5 rounded-full bg-[var(--color-paper)] shadow transition-transform ${
            shown ? "translate-x-[22px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </li>
  )
}

function Thumbnail({ title, url, dimmed }: { title: string; url: string | null; dimmed: boolean }) {
  const box =
    "h-14 w-[72px] shrink-0 overflow-hidden rounded-[6px] border border-[var(--color-rule)]"
  if (!url) {
    return (
      <span
        role="img"
        aria-label={`${title} has no image yet`}
        className={`${box} flex items-center justify-center bg-[var(--color-paper-2)] text-[var(--color-ink-3)]`}
      >
        <NoImageGlyph />
      </span>
    )
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- a members-only preview route. */
    <img
      src={url}
      alt=""
      width={72}
      height={56}
      loading="lazy"
      className={`${box} bg-[var(--color-paper-2)] object-cover ${dimmed ? "opacity-60" : ""}`}
    />
  )
}

function HandleGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      {[6, 12, 18].flatMap((y) =>
        [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />),
      )}
    </svg>
  )
}

function NoImageGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="m3.5 16 5-5 4 4 3-3 5 5" strokeLinejoin="round" />
      <circle cx="15.5" cy="9" r="1.5" />
    </svg>
  )
}
