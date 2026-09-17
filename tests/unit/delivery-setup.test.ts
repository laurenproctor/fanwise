import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}))
vi.mock("@/lib/channels/actions", () => ({ setDeliverySetupAction: async () => ({ error: null }) }))

import { DeliverySetup } from "@/components/channels/delivery-setup"
import {
  DELIVERY_SETUP_CONFIRMED_KEY,
  carryDurableMetadata,
  isDeliverySetupConfirmed,
} from "@/lib/delivery/setup"
import { listAdapters } from "@/lib/channels/registry"

/**
 * A channel's one-time delivery setup (ADR 0013): the confirmation that gates
 * readiness, and the one thing a reconnect must not wipe.
 */

describe("the confirmation", () => {
  it("is a timestamp on the connection's metadata, and nothing else counts", () => {
    expect(
      isDeliverySetupConfirmed({ [DELIVERY_SETUP_CONFIRMED_KEY]: "2026-09-15T10:00:00Z" }),
    ).toBe(true)
    expect(isDeliverySetupConfirmed({ [DELIVERY_SETUP_CONFIRMED_KEY]: "" })).toBe(false)
    expect(isDeliverySetupConfirmed({ [DELIVERY_SETUP_CONFIRMED_KEY]: true })).toBe(false)
    expect(isDeliverySetupConfirmed(undefined)).toBe(false)
  })

  it("survives a reconnect of the same account, while the account's own facts are refreshed", () => {
    const existing = { currencyCode: "EUR", [DELIVERY_SETUP_CONFIRMED_KEY]: "2026-09-15T10:00:00Z" }
    const fresh = { currencyCode: "USD", plan: "basic" }
    expect(carryDurableMetadata(existing, fresh)).toEqual({
      currencyCode: "USD",
      plan: "basic",
      [DELIVERY_SETUP_CONFIRMED_KEY]: "2026-09-15T10:00:00Z",
    })
    expect(carryDurableMetadata(null, fresh)).toEqual(fresh)
  })

  it("is declared only by channels that also deliver by link", () => {
    for (const adapter of listAdapters()) {
      if (adapter.deliverySetup) expect(adapter.deliversByLink, adapter.key).toBe(true)
    }
  })
})

describe("the setup card", () => {
  const setup = {
    title: "Add download links to order emails",
    description: "Why it is needed.",
    steps: ["Open the template.", "Paste the snippet."],
    snippet: "{% for line in line_items %}{% endfor %}",
  }

  function render(confirmed: boolean) {
    return renderToStaticMarkup(
      createElement(DeliverySetup, {
        workspaceSlug: "northbound-type",
        connectionId: "c1",
        setup,
        confirmed,
        automation: { state: "unknown" as const },
      }),
    )
  }

  it("shows the steps, the exact snippet and the confirmation until it is done", () => {
    const markup = render(false)
    expect(markup).toContain("Paste the snippet.")
    expect(markup).toContain("{% for line in line_items %}{% endfor %}")
    expect(markup).toContain("Copy snippet")
    expect(markup).toContain("I&#x27;ve added it")
  })

  it("collapses to a single line once confirmed", () => {
    const markup = render(true)
    expect(markup).toContain("Set up")
    expect(markup).not.toContain("Paste the snippet.")
  })
})
