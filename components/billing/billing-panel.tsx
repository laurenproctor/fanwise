"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { openBillingPortalAction, startCheckoutAction } from "@/lib/billing/actions"
import type { BillingInterval } from "@/lib/billing/gateway"
import { PRICING, TRIAL_DAYS, estimate, formatUsd } from "@/lib/billing/rules"
import type { BillingState } from "@/lib/billing/state"

/**
 * Subscribe, or manage what is subscribed.
 *
 * Two shapes decided by the state rather than by this component. Without a
 * subscription the panel offers a monthly and an annual checkout and says
 * what each would cost for the channels connected now. With one, it says
 * what the provider holds and hands the creator to the provider's portal for
 * everything else — card, interval, invoices, cancellation — because those
 * screens exist there and are not worth building twice.
 *
 * Both actions return a URL rather than redirecting, and the navigation is a
 * full one: the destination is the provider's own domain.
 */
export function BillingPanel({
  workspaceSlug,
  state,
  billableConnections,
  notice,
}: {
  workspaceSlug: string
  state: BillingState
  billableConnections: number
  /** From the return trip: subscribed, canceled, or portal. */
  notice: string | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function checkout(interval: BillingInterval) {
    setError(null)
    startTransition(async () => {
      const result = await startCheckoutAction(workspaceSlug, interval)
      if (result.error !== null) {
        setError(result.error)
        return
      }
      window.location.href = result.url
    })
  }

  function portal() {
    setError(null)
    startTransition(async () => {
      const result = await openBillingPortalAction(workspaceSlug)
      if (result.error !== null) {
        setError(result.error)
        return
      }
      window.location.href = result.url
    })
  }

  const returnNotice =
    notice === "subscribed"
      ? "Thank you. Your subscription is being confirmed and will appear here in a moment."
      : notice === "canceled"
        ? "Checkout was cancelled. Nothing was charged."
        : null

  return (
    <div className="grid gap-5 rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-card)] p-6">
      {returnNotice ? (
        <p
          role="status"
          className="border-l-2 border-[var(--color-ok)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
        >
          {returnNotice}
        </p>
      ) : null}

      {state.kind === "not_configured" ? (
        <p className="text-[14px] text-[var(--color-ink-2)]">
          Billing is not configured on this deployment. Every workspace here runs without a
          subscription.
        </p>
      ) : null}

      {state.kind === "trialing" || state.kind === "trial_ended" ? (
        <>
          <div className="grid gap-1">
            <span className="label-mono">
              {state.kind === "trialing" ? "Trial" : "Trial ended"}
            </span>
            <p className="font-display text-[22px] font-normal tracking-[-0.02em]">
              {state.kind === "trialing"
                ? state.daysLeft === 1
                  ? "One day left"
                  : `${state.daysLeft} days left`
                : "Subscribe to keep publishing"}
            </p>
            <p className="max-w-prose text-[14px] text-[var(--color-ink-2)]">
              Every new workspace has {TRIAL_DAYS} days before a subscription is needed. Fanwise is{" "}
              {formatUsd(PRICING.month.base)} a month, plus {formatUsd(PRICING.month.channel)} for
              each external marketplace you connect. Your own storefront is included.
            </p>
          </div>

          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-rule-2)] sm:grid-cols-2">
            {(["month", "year"] as const).map((interval) => (
              <div key={interval} className="flex flex-col gap-3 bg-[var(--color-card)] p-4">
                <dt className="label-mono">{interval === "month" ? "Monthly" : "Annual"}</dt>
                <dd className="grid gap-1">
                  <span className="font-display text-[28px] font-extralight tracking-[-0.03em]">
                    {formatUsd(estimate(interval, billableConnections))}
                    <span className="ml-1 text-[13px] text-[var(--color-ink-3)]">
                      per {interval}
                    </span>
                  </span>
                  <span className="text-[13px] text-[var(--color-ink-2)]">
                    {formatUsd(PRICING[interval].base)} base
                    {billableConnections > 0
                      ? ` + ${billableConnections} × ${formatUsd(PRICING[interval].channel)} marketplaces`
                      : ", no marketplaces connected yet"}
                    {interval === "year" ? ". Ten months for twelve." : ""}
                  </span>
                </dd>
                <Button
                  type="button"
                  variant={interval === "month" ? "primary" : "secondary"}
                  onClick={() => checkout(interval)}
                  disabled={pending}
                >
                  {pending
                    ? "Taking you there…"
                    : `Subscribe ${interval === "month" ? "monthly" : "annually"}`}
                </Button>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      {state.kind === "subscribed" ? (
        <>
          <div className="grid gap-1">
            <span className="label-mono">Subscription</span>
            <p className="font-display text-[22px] font-normal tracking-[-0.02em]">
              {describeStatus(state.status)}
            </p>
            <p className="max-w-prose text-[14px] text-[var(--color-ink-2)]">
              {state.interval
                ? `${formatUsd(PRICING[state.interval].base)} per ${state.interval} base, plus ${state.channelQuantity} × ${formatUsd(PRICING[state.interval].channel)} for connected marketplaces.`
                : "The plan's interval is not recorded yet."}{" "}
              {state.currentPeriodEnd
                ? state.cancelAtPeriodEnd
                  ? `Ends on ${formatDate(state.currentPeriodEnd)}.`
                  : `Renews on ${formatDate(state.currentPeriodEnd)}.`
                : null}
            </p>
            {state.channelQuantity !== billableConnections ? (
              <p className="border-l-2 border-[var(--color-warn)] pl-3 text-[13px] text-[var(--color-ink-2)]">
                {billableConnections} marketplace{billableConnections === 1 ? " is" : "s are"}{" "}
                connected and {state.channelQuantity} {state.channelQuantity === 1 ? "is" : "are"}{" "}
                on the subscription. The next sync brings them together.
              </p>
            ) : null}
          </div>
          <div>
            <Button type="button" variant="secondary" onClick={portal} disabled={pending}>
              {pending ? "Taking you there…" : "Manage billing"}
            </Button>
          </div>
        </>
      ) : null}

      <FormError message={error} />
    </div>
  )
}

function describeStatus(status: string): string {
  switch (status) {
    case "active":
      return "Active"
    case "trialing":
      return "Active, in a trial"
    case "past_due":
      return "Payment past due"
    case "unpaid":
      return "Unpaid"
    case "incomplete":
      return "Payment incomplete"
    case "paused":
      return "Paused"
    default:
      return status
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}
