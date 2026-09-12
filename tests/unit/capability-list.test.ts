import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CapabilityList } from "@/components/channels/capability-list"
import { mockApiAdapter } from "@/lib/channels/adapters/mock-api"
import { mockAssistedAdapter } from "@/lib/channels/adapters/mock-assisted"
import { CAPABILITY_ABSENCES, CAPABILITY_KEYS, CAPABILITY_LABELS } from "@/lib/channels/types"

/**
 * A channel states what it cannot do before it is connected.
 *
 * This was a browser test that connected nothing and read two cards on the
 * channels page. What it proved is what the list renders from an adapter's
 * declared capabilities, which a rendered string decides exactly, for every
 * capability rather than the three the browser happened to read.
 */

function textOf(markup: string): string {
  return markup
    .split(/<[^>]*>/)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
}

function lines(markup: string): string[] {
  return [...markup.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1] ?? ""))
}

describe("the capability list", () => {
  it("states every capability an assisted channel lacks, with what the creator does instead", () => {
    const rendered = lines(
      renderToStaticMarkup(
        createElement(CapabilityList, { capabilities: mockAssistedAdapter.capabilities }),
      ),
    )

    expect(rendered).toHaveLength(CAPABILITY_KEYS.length)
    for (const [index, key] of CAPABILITY_KEYS.entries()) {
      const line = rendered[index] ?? ""
      if (mockAssistedAdapter.capabilities[key]) {
        expect(line, key).toBe(CAPABILITY_LABELS[key])
      } else {
        expect(line, key).toBe(
          `${CAPABILITY_LABELS[key]} — not supported. ${CAPABILITY_ABSENCES[key]}`,
        )
      }
    }

    // The two the browser test read, in the words a creator sees.
    expect(rendered).toContain(
      `Publish automatically — not supported. ${CAPABILITY_ABSENCES.automaticPublish}`,
    )
    expect(rendered).toContain(
      `Upload the deliverable — not supported. ${CAPABILITY_ABSENCES.digitalFileUpload}`,
    )
  })

  it("states an API channel's publishing as supported and its gaps as gaps", () => {
    const rendered = lines(
      renderToStaticMarkup(
        createElement(CapabilityList, { capabilities: mockApiAdapter.capabilities }),
      ),
    )

    expect(mockApiAdapter.capabilities.automaticPublish).toBe(true)
    expect(rendered).toContain("Publish automatically")
    expect(mockApiAdapter.capabilities.transactions).toBe(false)
    expect(rendered).toContain(`Read sales — not supported. ${CAPABILITY_ABSENCES.transactions}`)
  })

  it("never lets colour alone carry a missing capability", () => {
    const markup = renderToStaticMarkup(
      createElement(CapabilityList, { capabilities: mockAssistedAdapter.capabilities }),
    )
    const missing = CAPABILITY_KEYS.filter((key) => !mockAssistedAdapter.capabilities[key])

    expect(missing.length).toBeGreaterThan(0)
    expect(markup.split("not supported").length - 1).toBe(missing.length)
  })

  it("is what the channels page shows on every card, beside the assisted channel's sentence", () => {
    // The page is an async server component that reads the database, so the
    // wiring is pinned at the source: every card renders this list from its
    // own adapter, and an assisted card says it is not automatic.
    const source = readFileSync(
      join(__dirname, "..", "..", "app", "[slug]", "channels", "page.tsx"),
      "utf8",
    )

    expect(source).toContain("<CapabilityList capabilities={adapter.capabilities} />")
    expect(source).toContain(
      "Fanwise prepares the listing and you submit it. There is no API to publish through, so nothing here is automatic.",
    )
    expect(mockAssistedAdapter.integrationType).toBe("assisted")
  })
})
