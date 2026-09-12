import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { signUpAndCreateWorkspace } from "./support"

/**
 * Importing a product from a link, in a browser.
 *
 * The markup half is tests/unit/import-screen.test.ts and is where the state
 * machine and the readiness rules are pinned. This half is for the three things
 * that only a real browser can answer: the route is reachable while signed in
 * and not otherwise, the screen actually widens without scrolling sideways at
 * the widths the rest of the suite uses, and the marketplace action stays inert
 * under a real click until every step is done.
 *
 * The link is never fetched. The screen is driven by the fixture service in
 * `lib/imports/service.ts`, and a `fanwise-demo-` marker in the URL chooses
 * which outcome it answers with, so nothing here touches the network.
 */

const ARTIFACT = "https://claude.ai/code/artifact/3f2e8c4e-7d4b-4e9b-b9a1-2c9f4e6a7d1c"

/** The widths tests/e2e/catalog.spec.ts already uses, plus a wide desktop. */
const WIDTHS = [320, 390, 768, 1280, 1600]

async function analyze(page: import("@playwright/test").Page, url: string) {
  await page.getByLabel("Product link").fill(url)
  await page.getByRole("button", { name: "Analyze product" }).click()
  await expect(page.getByText("Replace link")).toBeVisible({ timeout: 15_000 })
}

test("a signed-out visitor cannot reach the importer", async ({ page }) => {
  await page.goto(routes.importProduct("someone-elses-studio"))
  await expect(page).toHaveURL(/\/sign-in/)
})

test("the importer opens from the new-product page and says what it is", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp1", "Import Studio")

  await page.goto(routes.newProduct(slug))
  await page.getByRole("link", { name: "Import a product from a link" }).click()

  await expect(page).toHaveURL(new RegExp(`${slug}/new/link$`))
  await expect(page.getByRole("heading", { name: "Import a product", level: 1 })).toBeVisible()
  await expect(
    page.getByText("Turn any creator product link into an editable Fanwise listing."),
  ).toBeVisible()

  // The breadcrumb goes back to the catalog.
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible()

  // The shared shell is untouched on this route: the workspace header, which
  // is the only way out of the page, is still above it.
  await expect(page.getByRole("link", { name: /Import Studio/ })).toBeVisible()
})

test("readiness climbs one step at a time and opens the gate at five of five", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp2", "Ladder Studio")
  await page.goto(routes.importProduct(slug))

  const progress = page.getByRole("progressbar")
  await expect(progress).toHaveAttribute("aria-valuenow", "0")
  await expect(page.getByText("Complete 5 required items to continue.")).toBeVisible()

  await analyze(page, ARTIFACT)
  await expect(progress).toHaveAttribute("aria-valuenow", "1")

  // The suggested fields are not the creator's words until they say so.
  await page.getByRole("button", { name: /I have checked/ }).click()
  await expect(progress).toHaveAttribute("aria-valuenow", "2")
  await expect(page.getByText("2 of 5 steps complete")).toBeVisible()

  await page
    .getByLabel("Upload files")
    .setInputFiles({
      name: "buyer-files.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("x"),
    })
  await expect(progress).toHaveAttribute("aria-valuenow", "3")

  await page.getByRole("radio", { name: /Commercial use/ }).check()
  await expect(progress).toHaveAttribute("aria-valuenow", "4")

  await page.getByRole("button", { name: "I have the right to sell this" }).click()
  await expect(progress).toHaveAttribute("aria-valuenow", "5")
  await expect(page.getByText("Nothing left. Every required item is done.")).toBeVisible()
})

test("marketplace review cannot be reached below five of five, even by clicking it", async ({
  page,
}) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp3", "Gate Studio")
  await page.goto(routes.importProduct(slug))

  const review = page.getByRole("button", { name: "Review marketplace drafts" })
  await expect(review).toHaveAttribute("aria-disabled", "true")
  await expect(page.getByText("Complete 5 required items to continue.")).toBeVisible()

  // A real click, at 0%. Nothing may move: not the URL, not the save status.
  await review.click({ force: true })
  await expect(page).toHaveURL(new RegExp(`${slug}/new/link$`))
  await expect(page.getByText("Saved just now")).toBeHidden()

  await analyze(page, ARTIFACT)
  await page.getByRole("button", { name: /I have checked/ }).click()

  // Still inert at four of five, which is 80% and looks nearly done.
  await page
    .getByLabel("Upload files")
    .setInputFiles({
      name: "buyer-files.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("x"),
    })
  await page.getByRole("radio", { name: /Commercial use/ }).check()
  await expect(page.getByText("80%")).toBeVisible()
  await expect(review).toHaveAttribute("aria-disabled", "true")
  await review.click({ force: true })
  await expect(page.getByText("Saved just now")).toBeHidden()

  // The last step opens it.
  await page.getByRole("button", { name: "I have the right to sell this" }).click()
  await expect(review).not.toHaveAttribute("aria-disabled", "true")
  await expect(page.getByText("Complete 1 required item to continue.")).toBeHidden()
  await review.click()
  await expect(page.getByText("Saved just now")).toBeVisible()
})

test("a link that will not open offers a way out rather than a dead end", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp4", "Locked Studio")
  await page.goto(routes.importProduct(slug))

  await analyze(page, "https://claude.ai/code/artifact/fanwise-demo-login")

  await expect(page.getByRole("heading", { name: "That link needs permission" })).toBeVisible()
  await expect(page.getByText("Publish a public link")).toBeVisible()
  await expect(page.getByRole("link", { name: "Continue manually" })).toHaveAttribute(
    "href",
    routes.newProduct(slug),
  )

  // Replacing the link puts the field back with what was typed still in it.
  await page.getByRole("button", { name: "Replace link" }).click()
  await expect(page.getByLabel("Product link")).toHaveValue(
    "https://claude.ai/code/artifact/fanwise-demo-login",
  )
})

test("a recoverable failure can be retried in place", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp5", "Retry Studio")
  await page.goto(routes.importProduct(slug))

  await analyze(page, "https://example.com/fanwise-demo-failed")
  await expect(page.getByRole("heading", { name: "That did not finish" })).toBeVisible()

  await page.getByRole("button", { name: "Try again" }).click()
  // It goes back through the analyzer rather than doing nothing. The exact
  // match picks the visible stage label over the live region's sentence, which
  // begins with the same words on purpose.
  await expect(page.getByText("Opening the link", { exact: true })).toBeVisible()
})

test("a link Fanwise cannot read says so without blaming the creator", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp6", "Unsupported Studio")
  await page.goto(routes.importProduct(slug))

  await analyze(page, "https://example.com/fanwise-demo-unsupported")
  await expect(
    page.getByRole("heading", { name: "Fanwise cannot read that link yet" }),
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "Continue manually" })).toBeVisible()
})

test("the bad shapes are refused before anything is fetched", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp7", "Validation Studio")
  await page.goto(routes.importProduct(slug))

  const field = page.getByLabel("Product link")
  for (const [input, fragment] of [
    ["http://example.com/a", "https links only"],
    ["https://localhost/a", "cannot reach from the internet"],
    ["https://example.com:8443/a", "standard https port"],
  ] as const) {
    await field.fill(input)
    await page.getByRole("button", { name: "Analyze product" }).click()
    // Next's own route announcer is a role="alert" on every page, so the
    // complaint is located by what it says rather than by its role alone.
    await expect(page.getByRole("alert").filter({ hasText: fragment })).toBeVisible()
    // Nothing was analyzed, so the field is still a field.
    await expect(page.getByRole("button", { name: "Analyze product" })).toBeVisible()
  }
})

test("the screen widens without ever scrolling sideways", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp8", "Width Studio")
  await page.goto(routes.importProduct(slug))
  await analyze(page, ARTIFACT)

  for (const theme of ["light", "dark"] as const) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(routes.importProduct(slug))

      const toggle = page.getByRole("button", { name: `Switch to ${theme} mode` })
      if (await toggle.isVisible()) await toggle.click()

      await expect(page.getByRole("heading", { name: "Import a product", level: 1 })).toBeVisible()

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${theme} at ${width}px scrolls sideways`).toBeLessThanOrEqual(0)
    }
  }
})

test("the working area is two columns where there is room and one where there is not", async ({
  page,
}) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp9", "Columns Studio")
  await page.goto(routes.importProduct(slug))
  await analyze(page, ARTIFACT)

  const source = page.getByRole("heading", { name: "What Fanwise found" })
  const draft = page.getByRole("heading", { name: "Listing draft" })

  await page.setViewportSize({ width: 1600, height: 1000 })
  const wideSource = (await source.boundingBox())!
  const wideDraft = (await draft.boundingBox())!
  // Side by side: the draft starts to the right of where the source starts.
  expect(wideDraft.x).toBeGreaterThan(wideSource.x)

  await page.setViewportSize({ width: 768, height: 1000 })
  const narrowSource = (await source.boundingBox())!
  const narrowDraft = (await draft.boundingBox())!
  // Stacked: one sequence, source first.
  expect(narrowDraft.x).toBeCloseTo(narrowSource.x, 0)
  expect(narrowDraft.y).toBeGreaterThan(narrowSource.y)
})

test("the gutters are the wide ones on a desktop and the narrow ones on a phone", async ({
  page,
}) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp10", "Gutter Studio")
  await page.goto(routes.importProduct(slug))

  async function gutter(): Promise<number> {
    return page.evaluate(() => {
      const main = document.querySelector("main")
      if (!main) throw new Error("no main")
      return Number.parseFloat(getComputedStyle(main).paddingLeft)
    })
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  expect(await gutter()).toBeGreaterThanOrEqual(48)

  await page.setViewportSize({ width: 1600, height: 900 })
  expect(await gutter()).toBe(64)

  await page.setViewportSize({ width: 390, height: 900 })
  expect(await gutter()).toBe(24)
})

test("no other route was widened", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp11", "Untouched Studio")
  await page.setViewportSize({ width: 1600, height: 900 })

  for (const route of [routes.workspace(slug), routes.newProduct(slug), routes.channels(slug)]) {
    await page.goto(route)
    const width = await page.evaluate(() => {
      const main = document.querySelector("main")
      if (!main) throw new Error("no main")
      return main.getBoundingClientRect().width
    })
    // The reading column, unchanged: 1160 plus its own 24px gutters.
    expect(width, `${route} was widened`).toBeLessThanOrEqual(1160)
  }
})
