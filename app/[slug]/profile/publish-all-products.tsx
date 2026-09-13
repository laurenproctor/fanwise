"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useId, useRef, useState } from "react"
import { Button, ButtonLink } from "@/components/ui/button"
import { publishAllProductsAction, type PublishAllResult } from "@/lib/public/publish-actions"
import { routes } from "@/lib/routes"

/**
 * "Publish all products on my profile": every eligible product, onto the
 * public Fanwise profile, in one deliberate step.
 *
 * The copy carries the boundary because the word "publish" also means sending
 * a listing to a channel in Fanwise. This control never does that, and it
 * says so beside the button and again in the confirmation: it changes what
 * the profile at /@handle shows, and nothing on any channel.
 *
 * Many products at once is behind a confirmation that states the number, and
 * the products that cannot be included are listed by name with a way to fix
 * each, so nothing is left out silently. The confirm button disables itself
 * while the request runs, which with the database's own row lock makes a
 * double press publish once.
 *
 * This is a bulk action on the products that exist now, not a setting: a
 * product created tomorrow still waits to be chosen in step 2 of the builder,
 * where each product also keeps its own switch.
 */

export interface PublishAllItem {
  id: string
  title: string
  /** The product's page in the workspace, where a creator can fix it. */
  href: string | null
}

export function PublishAllProducts({
  workspaceSlug,
  profileLive,
  toPublish,
  alreadyShownCount,
  needsAttention,
  archivedCount,
}: {
  workspaceSlug: string
  profileLive: boolean
  toPublish: PublishAllItem[]
  alreadyShownCount: number
  needsAttention: Array<PublishAllItem & { reason: string }>
  archivedCount: number
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const headingId = useId()
  const descriptionId = useId()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<PublishAllResult | null>(null)

  const count = toPublish.length
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  useEffect(() => {
    if (result) resultRef.current?.focus()
  }, [result])

  function openConfirm() {
    setResult(null)
    dialogRef.current?.showModal()
  }

  function closeConfirm() {
    dialogRef.current?.close()
    openerRef.current?.focus()
  }

  async function confirm() {
    if (pending) return
    setPending(true)
    let outcome: PublishAllResult
    try {
      outcome = await publishAllProductsAction(workspaceSlug, {
        productIds: toPublish.map((item) => item.id),
      })
    } catch {
      outcome = {
        ok: false,
        kind: "failed",
        message: "Your products could not be published. Nothing changed; try again.",
      }
    }
    setPending(false)
    dialogRef.current?.close()
    setResult(outcome)
    if (outcome.ok) router.refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Count label="On your profile" value={alreadyShownCount} />
        <Count label="Ready to add" value={count} />
        <Count label="Need attention" value={needsAttention.length} />
      </dl>

      {!profileLive ? (
        <div className="flex flex-col items-start gap-3 rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-4 text-[14px]">
          <p className="text-[var(--color-ink-2)]">
            Your profile isn&rsquo;t published, so products can&rsquo;t appear on it yet. Choose
            products and publish them together in the builder.
          </p>
          <ButtonLink href={routes.publicProfileBuilderProducts(workspaceSlug)} variant="secondary">
            Choose products
          </ButtonLink>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <Button
            ref={openerRef}
            type="button"
            onClick={openConfirm}
            disabled={count === 0 || pending}
          >
            Publish all products on my profile
          </Button>
          <p className="max-w-prose text-[13px] text-[var(--color-ink-3)]">
            {count === 0
              ? "Every product that can be on your profile already is."
              : `Adds ${plural(count, "product", "products")} to your public Fanwise profile. It doesn't publish anything to your channels or change any listing.`}
          </p>
        </div>
      )}

      <div ref={resultRef} tabIndex={-1} className="outline-none" role="status" aria-live="polite">
        {result?.ok ? (
          <p className="border-l-2 border-[var(--color-ok)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]">
            {result.outcome === "unchanged"
              ? "Those products were already on your profile. Nothing changed."
              : `Published ${plural(result.publishedCount, "product", "products")} on your profile.`}
            {result.noLongerEligible > 0
              ? ` ${plural(result.noLongerEligible, "product was", "products were")} left out because ${result.noLongerEligible === 1 ? "it" : "they"} can no longer be shown.`
              : ""}
          </p>
        ) : result ? (
          <p
            role="alert"
            className="border-l-2 border-[var(--color-bad)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
          >
            {result.message}
          </p>
        ) : null}
      </div>

      {needsAttention.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="label-mono">Not included, and why</h3>
          <ul className="flex flex-col divide-y divide-[var(--color-rule)] rounded-[12px] border border-[var(--color-rule)]">
            {needsAttention.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="min-w-0 text-[15px] text-[var(--color-ink)]">{item.title}</span>
                <span className="flex flex-wrap items-baseline gap-3 text-[13px] text-[var(--color-ink-2)]">
                  {item.reason}
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                    >
                      Open product<span className="sr-only">: {item.title}</span>
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {archivedCount > 0 ? (
        <p className="text-[13px] text-[var(--color-ink-3)]">
          {plural(archivedCount, "archived product is", "archived products are")} never shown on
          your profile.
        </p>
      ) : null}

      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        onCancel={(event) => {
          if (pending) event.preventDefault()
        }}
        onClose={() => openerRef.current?.focus()}
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] p-0 text-[var(--color-ink)] backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-5 p-6">
          <h2
            id={headingId}
            className="font-display text-[26px] leading-[1.15] font-light tracking-[-0.02em]"
          >
            Publish {plural(count, "product", "products")} on your profile?
          </h2>
          <div
            id={descriptionId}
            className="flex flex-col gap-3 text-[15px] text-[var(--color-ink-2)]"
          >
            <p>
              {count === 1 ? "It appears" : "They appear"} on your public Fanwise profile straight
              away, in the order you arranged in the profile builder, beside the{" "}
              {plural(alreadyShownCount, "product", "products")} already there.
            </p>
            <p>
              This only changes your Fanwise profile. Nothing is published to your channels, and no
              listing changes.
            </p>
          </div>
          {count > 0 ? (
            <ul className="max-h-[200px] overflow-auto rounded-[10px] border border-[var(--color-rule)] px-4 py-2 text-[14px]">
              {toPublish.map((item) => (
                <li key={item.id} className="py-1">
                  {item.title}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={closeConfirm} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={confirm} disabled={pending} autoFocus>
              {pending ? "Publishing…" : `Publish ${plural(count, "product", "products")}`}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-[var(--color-rule)] px-4 py-3">
      <dt className="label-mono">{label}</dt>
      <dd className="font-display tabular text-[26px] font-light">{value}</dd>
    </div>
  )
}
