import { expect, type Page } from "@playwright/test"
import { routes } from "@/lib/routes"
import { localAdmin } from "./support"

/**
 * Getting an import to the state a successful read would have left it in.
 *
 * **Why this seeds rather than driving the UI.** Past account setup (see
 * `newCreator` in support.ts), every other e2e file goes through the browser
 * for everything, and that is right. It cannot work here: `lib/net/outbound.ts` refuses loopback and private addresses by
 * design, so a fixture server on this machine is exactly what the reader is
 * built never to fetch, and the alternative — an environment flag that lets one
 * host through — would be a hole in the boundary that exists only because a
 * test wanted one.
 *
 * So the network result is the one thing faked, and nothing else is. The
 * product and the import row are created by the real action through the real
 * UI; this only writes the evidence a successful read would have written, the
 * way the job would have written it. Everything the tests then exercise — the
 * draft form, the uploads, the licence, the attestation, readiness, the gate,
 * the handoff — runs as the signed-in creator through RLS.
 *
 * What the reader itself does is covered in tests/unit/import-retrieval.test.ts,
 * against the production boundary with a scripted socket.
 */

/** The local stack's service-role client; see `localAdmin` in support.ts. */
const admin = localAdmin

/** A reading of a page, in the shape `product_imports.evidence` holds. */
export function evidenceFor(url: string) {
  return {
    provider: "webpage" as const,
    originalUrl: url,
    resolvedUrl: url,
    retrievedAt: "2026-09-12T09:20:00.000Z",
    title: { value: "Aster Grotesk", provenance: "observed" as const, origin: "og" as const },
    summary: {
      value: "A six-weight grotesque for screens, with matching italics.",
      provenance: "observed" as const,
      origin: "meta" as const,
    },
    visibleFeatures: {
      value: ["Variable weight axis from Thin to Black", "Extended Latin language coverage"],
      provenance: "observed" as const,
      origin: "dom" as const,
    },
    previewAssets: [],
    publicDemoAvailable: true,
    contentHash: "a".repeat(64),
  }
}

/** A draft, in the shape the runner writes after the claims check. */
function suggestionsFor() {
  const suggestion = <T>(value: T) => ({ value, confidence: 0.8, evidence: [] })
  return {
    draft: {
      title: suggestion("Aster Grotesk"),
      shortDescription: suggestion("A six-weight grotesque."),
      longDescription: suggestion("A grotesque for screens, with matching italics."),
      productType: suggestion("font"),
      features: suggestion(["Variable weight axis"]),
      useCases: suggestion(["Editorial layouts"]),
      audience: suggestion("Designers"),
      tags: suggestion(["font", "grotesque"]),
      technicalRequirements: suggestion([]),
      priceGuidance: suggestion({
        amount: null,
        currency: "USD",
        rationale: "No price on the page.",
      }),
      missingInformation: ["What file formats a buyer receives"],
    },
    withheld: [],
    violations: [],
    provider: "seed",
    model: "seed-1",
    inputHash: "b".repeat(64),
  }
}

/**
 * Pastes a link, then writes the reading a successful fetch would have left.
 *
 * Returns the import's URL, so a test can come back to it after navigating
 * away — which is the point of the id being in the address in the first place.
 */
export async function importAnalyzedSource(
  page: Page,
  slug: string,
  sourceUrl = "https://fanwise-import.invalid/aster-grotesk",
): Promise<{ importUrl: string; importId: string }> {
  await page.goto(routes.importProduct(slug))
  await page.getByLabel("Product link or description").fill(sourceUrl)
  await page.getByRole("button", { name: "Create draft" }).click()

  await expect(page).toHaveURL(new RegExp(`${slug}/new/link/[0-9a-f-]{36}$`), { timeout: 20_000 })
  const importUrl = page.url()
  const importId = importUrl.split("/").pop()!

  // The job will have settled this on a host that cannot resolve. Overwrite
  // that one outcome with the one a reachable page would have produced.
  const { error } = await admin()
    .from("product_imports")
    .update({
      status: "ready",
      error_code: null,
      error_message: null,
      resolved_url: sourceUrl,
      content_hash: "a".repeat(64),
      evidence: evidenceFor(sourceUrl),
      suggestions: suggestionsFor(),
      prompt_version: "seed",
      schema_version: "seed",
      retrieved_at: new Date().toISOString(),
      analyzed_at: new Date().toISOString(),
    })
    .eq("id", importId)

  if (error) throw new Error(`could not seed the import: ${error.message}`)

  await page.goto(importUrl)
  await expect(page.getByRole("heading", { name: "What Fanwise found" })).toBeVisible({
    timeout: 20_000,
  })

  return { importUrl, importId }
}

/** A small, real file for the buyer-files step. */
export function zipFile(name = "aster-grotesk.zip") {
  return {
    name,
    mimeType: "application/zip",
    // A real zip signature, so the finalize job sniffs it as one.
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00]),
  }
}

/** Completes the licence step through the UI. */
export async function chooseLicense(page: Page, name = "Commercial use") {
  await openChecklistRow(page, "choose license")
  await page.getByRole("radio", { name: new RegExp(name) }).click()
}

/** Completes the ownership step through the UI. */
export async function confirmOwnership(page: Page, thirdParty?: string) {
  await openChecklistRow(page, "confirm ownership")
  await page.getByRole("checkbox", { name: /I created this product or have permission/ }).check()
  if (thirdParty) {
    await page.getByLabel(/Does this product include fonts/).fill(thirdParty)
  }
  await page.getByRole("button", { name: "Confirm and continue" }).click()
}

/** Opens a checklist row whose panel is closed, and leaves an open one alone. */
export async function openChecklistRow(page: Page, action: string) {
  const toggle = page.getByRole("button", { name: `Show ${action}` })
  if (await toggle.isVisible().catch(() => false)) await toggle.click()
}

/**
 * Filling in the master listing.
 *
 * Located by role rather than by label: every field carries a provenance tip
 * whose accessible name contains the field's own name, so `getByLabel` finds
 * two things. The role is what tells the input from the button explaining it.
 */
export async function fillListing(
  page: Page,
  values: { name: string; price: string; description: string; type?: string },
) {
  await page.getByRole("textbox", { name: "Product name" }).fill(values.name)
  await page.getByRole("textbox", { name: /^Price/ }).fill(values.price)
  await page.getByRole("textbox", { name: "Description" }).fill(values.description)
  await page.getByRole("combobox", { name: "Product type" }).selectOption(values.type ?? "font")
}

/** Saves the listing and waits for the server to have taken it. */
export async function saveListing(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click()
  await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 20_000 })
}
