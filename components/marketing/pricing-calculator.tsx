"use client"

import Link from "next/link"
import { useState } from "react"
import { marketingRoutes } from "@/lib/routes"

/**
 * The pricing equation, the plan card and the worked examples.
 *
 * One component because they share one number. The stepper, the tiles and the
 * plan card all read and write the same connected-marketplace count, and the
 * design keeps them synchronized — clicking "Four marketplaces" moves the
 * stepper, and the stepper highlights the matching tile.
 *
 * The arithmetic is $9 + $6 x n, which docs/billing.md holds as the real pricing
 * model, and annual is ten months for twelve: $90 and $60.
 */
const BASE_MONTHLY = 9
const EACH_MONTHLY = 6
const BASE_ANNUAL = 90
const EACH_ANNUAL = 60
const MAX_CHANNELS = 8

const FEATURES = [
  "Unlimited products",
  "One canonical product catalog",
  "Marketplace-ready listing drafts",
  "Publish Everywhere",
  "Product files and previews",
  "Channel-specific merchandising",
  "Marketplace readiness checks",
  "Publication history",
  "Revenue analytics",
  "Listing updates",
  "One user",
]

const EXAMPLES = [
  { n: 1, head: "One marketplace" },
  { n: 2, head: "Two marketplaces" },
  { n: 4, head: "Four marketplaces" },
  { n: 6, head: "Six marketplaces" },
]

function plural(n: number) {
  return n === 1 ? "marketplace" : "marketplaces"
}

export function PricingCalculator() {
  const [count, setCount] = useState(2)
  const [annual, setAnnual] = useState(false)

  const base = annual ? BASE_ANNUAL : BASE_MONTHLY
  const each = annual ? EACH_ANNUAL : EACH_MONTHLY
  const perLabel = annual ? "per year" : "per month"
  const total = base + each * count
  const stepLabel = count === 0 ? "Storefront only" : `${count} ${plural(count)}`

  return (
    <>
      <div id="calculator" className="fw-equation">
        <div className="fw-wrap">
          <div className="fw-equation__row">
            <div className="fw-equation__term">
              <span className="fw-equation__figure">${base}</span>
              <span className="fw-equation__label">base</span>
            </div>
            <div aria-hidden="true" className="fw-equation__op">
              +
            </div>
            <div className="fw-equation__term">
              <span className="fw-equation__figure">${each}</span>
              <span className="fw-equation__label">per marketplace</span>
            </div>
            <div aria-hidden="true" className="fw-equation__op">
              &times;
            </div>
            <div className="fw-equation__term">
              <span className="fw-equation__figure">{count}</span>
              <span className="fw-equation__label">connected</span>
            </div>
            <div aria-hidden="true" className="fw-equation__op">
              =
            </div>
            <div className="fw-equation__term fw-equation__term--total">
              <span className="fw-equation__figure">${total}</span>
              <span className="fw-equation__label">{perLabel}</span>
            </div>
          </div>
          <div className="fw-stepper">
            <button
              type="button"
              aria-label="Remove a marketplace"
              className="fw-stepper__btn"
              onClick={() => setCount((c) => Math.max(0, c - 1))}
            >
              &minus;
            </button>
            <div aria-live="polite" className="fw-stepper__readout">
              {stepLabel} &middot; <b>${total}</b> {perLabel}
            </div>
            <button
              type="button"
              aria-label="Add a marketplace"
              className="fw-stepper__btn"
              onClick={() => setCount((c) => Math.min(MAX_CHANNELS, c + 1))}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="fw-wrap">
        <section id="plan" style={{ padding: "80px 0 92px" }}>
          <div className="fw-plan">
            <div className="fw-plan__main">
              <div className="fw-plan__head">
                <h3>Fanwise</h3>
                <div role="group" aria-label="Billing period" className="fw-toggle">
                  <button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>
                    Monthly
                  </button>
                  <button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>
                    Annual
                  </button>
                </div>
              </div>
              <div>
                <div className="fw-plan__price">
                  <span className="fw-plan__figure">${base}</span>
                  <span className="fw-plan__per">{perLabel}</span>
                </div>
                <p className="fw-plan__each">
                  + <b>${each}</b>{" "}
                  {annual ? "per connected marketplace, per year" : "per connected marketplace"}
                </p>
              </div>
              {annual ? <p className="fw-plan__chip">Two months free</p> : null}
              <div className="fw-plan__cta">
                <Link href={marketingRoutes.signUp} className="fw-btn fw-btn--accent">
                  Start free
                </Link>
                <small>Try Fanwise before connecting paid channels.</small>
              </div>
            </div>
            <div className="fw-plan__aside">
              <h4>Everything included</h4>
              <ul className="fw-plan__features">
                {FEATURES.map((feature) => (
                  <li key={feature}>
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path
                        d="M1 6.2 4.4 9.6 11 2.6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="examples" style={{ padding: "0 0 92px" }}>
          <div className="fw-intro">
            <span className="fw-eyebrow fw-eyebrow--tight">How it adds up</span>
            <h2 className="fw-h2">Pay for the places you sell. Nothing more.</h2>
            <p className="fw-intro__body">
              Start with one marketplace. Add another whenever the work is ready for it.
            </p>
          </div>
          <div className="fw-examples">
            {EXAMPLES.map((example) => (
              <button
                key={example.n}
                type="button"
                className="fw-example"
                aria-pressed={example.n === count}
                onClick={() => setCount(example.n)}
              >
                <div className="fw-example__head">{example.head}</div>
                <div className="fw-example__lines">
                  <div>
                    <span>Fanwise base</span>
                    <span>${base}</span>
                  </div>
                  <div>
                    <span>
                      {example.n} {plural(example.n)}
                    </span>
                    <span>${each * example.n}</span>
                  </div>
                </div>
                <div className="fw-example__total">
                  ${base + each * example.n}
                  <span className="fw-example__per">{annual ? "/yr" : "/mo"}</span>
                </div>
              </button>
            ))}
          </div>
          <p style={{ marginTop: 22, fontSize: "15.5px", color: "var(--fw-ink-2)" }}>
            Your catalog keeps growing without changing your subscription.
          </p>
        </section>
      </div>
    </>
  )
}
