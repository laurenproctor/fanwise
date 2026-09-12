"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FanLines } from "@/components/ui/fan-lines"
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
 * Every figure on it is read: the days come from the workspace's own age, the
 * marketplace count from the connections table, the total from the pricing
 * rules the pricing page uses. Nothing here is illustrative.
 *
 * Both actions return a URL rather than redirecting, and the navigation is a
 * full one: the destination is the provider's own domain. Neither is a save —
 * this section has no save button, because none of it is a draft.
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
    <div className="flex flex-col gap-6">
      {returnNotice ? (
        <p
          role="status"
          className="border-l-2 border-[var(--color-ok)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
        >
          {returnNotice}
        </p>
      ) : null}

      {state.kind === "not_configured" ? (
        <Pill tone="neutral" label="Not configured" />
      ) : state.kind === "trialing" ? (
        <Pill tone="ok" label="Trial active" />
      ) : state.kind === "trial_ended" ? (
        <Pill tone="warn" label="Trial ended" />
      ) : (
        <Pill
          tone={state.status === "active" ? "ok" : "warn"}
          label={describeStatus(state.status)}
        />
      )}

      {/*
        The headline figure and the fan behind it. The artwork is clipped by this
        container and hidden from assistive technology, so it can never widen the
        page or be read out.
      */}
      <div className="relative isolate overflow-hidden">
        <FanLines className="-top-2 -right-4 -z-10 hidden h-[185px] w-[225px] opacity-70 lg:block" />

        <div className="flex max-w-[46ch] flex-col gap-2">
          <p className="font-display text-[34px] leading-[1.1] font-extralight tracking-[-0.03em] sm:text-[40px]">
            {headline(state)}
          </p>
          <p className="text-[15px] text-[var(--color-ink-2)]">
            {state.kind === "not_configured" ? (
              "Billing is not configured on this deployment. Every workspace here runs without a subscription."
            ) : state.kind === "subscribed" ? (
              <>
                {state.interval
                  ? `${formatUsd(PRICING[state.interval].base)} per ${state.interval}, plus ${formatUsd(PRICING[state.interval].channel)} for each connected marketplace.`
                  : "The plan's interval is not recorded yet."}{" "}
                {state.currentPeriodEnd
                  ? state.cancelAtPeriodEnd
                    ? `Ends on ${formatDate(state.currentPeriodEnd)}.`
                    : `Renews on ${formatDate(state.currentPeriodEnd)}.`
                  : null}
              </>
            ) : (
              <>
                Fanwise is {formatUsd(PRICING.month.base)} monthly, plus{" "}
                {formatUsd(PRICING.month.channel)} per connected marketplace. Every new workspace
                has {TRIAL_DAYS} days before a subscription is needed.
              </>
            )}
          </p>
        </div>
      </div>

      {/* The figures. Read, aligned, and the same arithmetic the pricing page uses. */}
      <dl className="max-w-[520px] text-[15px]">
        <Figure
          term="Connected marketplaces"
          value={String(state.kind === "subscribed" ? state.channelQuantity : billableConnections)}
        />
        {state.kind === "subscribed" ? (
          state.interval ? (
            <Figure
              term={state.interval === "month" ? "Monthly total" : "Annual total"}
              value={formatUsd(estimate(state.interval, state.channelQuantity))}
            />
          ) : null
        ) : (
          <>
            <Figure
              term="Estimated monthly total"
              value={formatUsd(estimate("month", billableConnections))}
            />
            <Figure
              term="Estimated annual total"
              value={formatUsd(estimate("year", billableConnections))}
              hint="Ten months for twelve"
            />
          </>
        )}
      </dl>

      {state.kind === "subscribed" && state.channelQuantity !== billableConnections ? (
        <p className="max-w-prose border-l-2 border-[var(--color-warn)] pl-3 text-[13px] text-[var(--color-ink-2)]">
          {billableConnections} marketplace{billableConnections === 1 ? " is" : "s are"} connected
          and {state.channelQuantity} {state.channelQuantity === 1 ? "is" : "are"} on the
          subscription. The next sync brings them together.
        </p>
      ) : null}

      {/*
        Named for what they do. "Choose a plan" would be one button for two
        different charges; these say which one is about to be made, which is the
        rule for an action that takes money.
      */}
      {state.kind === "trialing" || state.kind === "trial_ended" ? (
        <div className="flex flex-wrap gap-3">
          {(["month", "year"] as const).map((interval) => (
            <Button
              key={interval}
              type="button"
              variant={interval === "month" ? "primary" : "secondary"}
              onClick={() => checkout(interval)}
              disabled={pending}
              className="max-sm:w-full"
            >
              {pending
                ? "Taking you there…"
                : `Subscribe ${interval === "month" ? "monthly" : "annually"} · ${formatUsd(estimate(interval, billableConnections))}`}
            </Button>
          ))}
        </div>
      ) : null}

      {state.kind === "subscribed" ? (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={portal}
            disabled={pending}
            className="max-sm:w-full"
          >
            {pending ? "Taking you there…" : "Manage subscription and invoices"}
          </Button>
        </div>
      ) : null}

      <FormError message={error} />
    </div>
  )
}

/**
 * State readable from form as well as colour (docs/design-system.md): a dot, a
 * word, and the semantic colour spent on the border and the dot rather than on
 * the text, which is the variant that passes a contrast check.
 */
function Pill({ tone, label }: { tone: "ok" | "warn" | "neutral"; label: string }) {
  const border =
    tone === "ok"
      ? "border-[var(--color-ok)]"
      : tone === "warn"
        ? "border-[var(--color-warn)]"
        : "border-[var(--color-rule)]"
  const dot =
    tone === "ok"
      ? "bg-[var(--color-ok)]"
      : tone === "warn"
        ? "bg-[var(--color-warn)]"
        : "bg-[var(--color-ink-3)]"

  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-[var(--color-ink)] uppercase ${border}`}
    >
      <span aria-hidden="true" className={`h-[5px] w-[5px] rounded-full ${dot}`} />
      {label}
    </span>
  )
}

function Figure({ term, value, hint }: { term: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-rule-2)] py-3 last:border-b-0">
      <dt className="text-[var(--color-ink-2)]">
        {term}
        {hint ? <span className="ml-2 text-[13px] text-[var(--color-ink-3)]">{hint}</span> : null}
      </dt>
      <dd className="tabular font-mono text-[var(--color-ink)]">{value}</dd>
    </div>
  )
}

function headline(state: BillingState): string {
  switch (state.kind) {
    case "not_configured":
      return "No subscription needed"
    case "trialing":
      return state.daysLeft === 1 ? "One day left" : `${state.daysLeft} days left`
    case "trial_ended":
      return "Subscribe to keep publishing"
    case "subscribed":
      return describeStatus(state.status)
  }
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
