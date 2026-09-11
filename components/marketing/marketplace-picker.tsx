"use client"

import { useState } from "react"

/**
 * The landing page's price picker: toggle the marketplaces you would connect,
 * and the total under it follows.
 *
 * Two of six start on, so the figure below is a real sum on first paint rather
 * than the bare $9 base — which would read as the whole price.
 */
const NAMES = ["Etsy", "Creative Market", "Envato", "Gumroad", "Adobe Stock", "MyFonts"]
const INITIAL = new Set(["Etsy", "Creative Market"])

const BASE = 9
const EACH = 6

export function MarketplacePicker() {
  const [picked, setPicked] = useState<ReadonlySet<string>>(INITIAL)

  function toggle(name: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const count = picked.size

  return (
    <>
      <div role="group" aria-label="Choose marketplaces" className="fw-picker">
        {NAMES.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={picked.has(name)}
            onClick={() => toggle(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <p aria-live="polite" className="fw-picker__total">
        ${BASE} base + ${EACH} &times; <b>{count}</b> {count === 1 ? "marketplace" : "marketplaces"}
        <em>= ${BASE + EACH * count} per month</em>
      </p>
    </>
  )
}
