import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { newCreator } from "./support"

/**
 * The universal composer, in a browser.
 *
 * Nothing is seeded and nothing reaches the internet. A paste and an HTML file
 * go through the real actions, the local storage bucket, the in-process queue
 * and the real readers; the one link is under `.invalid`, which no resolver
 * will ever answer, so it fails the way an unreachable link does. No model is
 * configured for the suite, so every import settles with its evidence and no
 * draft, which the screen says plainly.
 *
 * What the rules decide — what counts as a link, pill states, conflicts, the
 * claims check — is in tests/unit/import-composer.test.ts and
 * tests/unit/import-sessions.test.ts. These are the journeys only a browser
 * can prove.
 */

const IMPORT_URL = (slug: string) => new RegExp(`${slug}/new/link/[0-9a-f-]{36}$`)
const UNREACHABLE = "https://fanwise-import.invalid/canvas-tote"

test("pasted text becomes a durable draft that survives a refresh", async ({ page }) => {
  const { slug } = await newCreator(page, "cmp1", "Paste Studio")
  await page.goto(routes.importProduct(slug))

  await page
    .getByLabel("Product link or description")
    .fill(
      "Canvas Tote\n\nA hand-printed tote in natural cotton. See https://example.com for more.\n\n- Holds a laptop and a notebook",
    )
  // A paragraph with a URL in it stays text: no link pill appears.
  await expect(page.getByRole("list", { name: "Added sources" })).toHaveCount(0)
  await page.getByRole("button", { name: "Create draft" }).click()

  await expect(page).toHaveURL(IMPORT_URL(slug), { timeout: 20_000 })
  const url = page.url()

  // Coming back mid-read, or after, lands on the same import from the database.
  await page.reload()
  await expect(page).toHaveURL(url)
  await expect(page.getByRole("heading", { name: "What Fanwise found" })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText("Canvas Tote").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Replace link" })).toHaveCount(0)
})

test("a link and an HTML file make one draft, and the failed link says so", async ({ page }) => {
  const { slug } = await newCreator(page, "cmp2", "Combined Studio")
  await page.goto(routes.importProduct(slug))

  await page.getByLabel("Product link or description").fill(UNREACHABLE)
  await page.getByLabel("Product link or description").press("Enter")
  const pills = page.getByRole("list", { name: "Added sources" })
  await expect(pills.getByText("fanwise-import.invalid/canvas-tote")).toBeVisible()

  await page.locator('input[type="file"]').setInputFiles({
    name: "canvas-tote.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      "<!doctype html><html><head><title>Canvas Tote</title></head><body><h1>Canvas Tote</h1><p>Printed by hand in small batches.</p><ul><li>Natural cotton canvas</li></ul></body></html>",
    ),
  })
  await expect(pills.getByText("canvas-tote.html")).toBeVisible()
  await expect(pills.getByText("Ready")).toHaveCount(2, { timeout: 20_000 })

  await page.getByRole("button", { name: "Create draft" }).click()
  await expect(page).toHaveURL(IMPORT_URL(slug), { timeout: 20_000 })

  const sources = page.getByRole("region", { name: /Your sources/ })
  await expect(sources.getByText("canvas-tote.html")).toBeVisible({ timeout: 30_000 })
  await expect(sources.getByText("Read")).toBeVisible({ timeout: 30_000 })
  await expect(sources.getByText("Needs attention")).toBeVisible({ timeout: 30_000 })
  // The draft was still built from the source that read.
  await expect(page.getByRole("heading", { name: "What Fanwise found" })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText("Canvas Tote").first()).toBeVisible()
})

test("a refused microphone is said plainly, and the composer still works", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
      },
    })
  })
  const { slug } = await newCreator(page, "cmp3", "Quiet Studio")
  await page.goto(routes.importProduct(slug))

  await page.getByRole("button", { name: "Record" }).click()
  await expect(page.getByText(/Microphone access was denied/)).toBeVisible()
  await expect(page.getByText("Recording", { exact: true })).toHaveCount(0)

  await page.getByLabel("Product link or description").fill("A canvas tote.")
  await expect(page.getByRole("button", { name: "Create draft" })).toHaveAttribute(
    "aria-disabled",
    "false",
  )
})

test("the composer can be used with the keyboard alone", async ({ page }) => {
  const { slug } = await newCreator(page, "cmp4", "Keyboard Studio")
  await page.goto(routes.importProduct(slug))

  // The text box has focus on arrival.
  await expect(page.getByLabel("Product link or description")).toBeFocused()
  await page.keyboard.type(UNREACHABLE)
  await page.keyboard.press("Enter")
  const remove = page.getByRole("button", { name: "Remove fanwise-import.invalid/canvas-tote" })
  await expect(remove).toBeVisible()

  // Removing a pill keeps focus in the composer rather than dropping it.
  await remove.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByLabel("Product link or description")).toBeFocused()

  await page.keyboard.type("A canvas tote, printed by hand.")
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Add PDF or HTML" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Record" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Create draft" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(IMPORT_URL(slug), { timeout: 20_000 })
})
