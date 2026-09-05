import { expect, test, type Page } from "@playwright/test"
import { signUpAndCreateWorkspace } from "./support"

/**
 * A4's exit test: a person hand-writes a listing per channel and sees
 * deterministic readiness.
 *
 * No AI is involved anywhere here, which is the point of the step. The creator
 * types, and each channel says exactly what it would reject.
 */

/**
 * Waits for the product page proper.
 *
 * `/products/[^/]+$` also matches `/products/new`, so waiting on that pattern
 * resolves instantly against the form we just submitted and races the redirect.
 * The trailing segment has to be excluded explicitly.
 */
async function waitForProductPage(page: Page, slug: string) {
  await page.waitForURL(
    (url) =>
      new RegExp(`^/w/${slug}/products/[^/]+$`).test(url.pathname) &&
      !url.pathname.endsWith("/new"),
  )
}

async function connect(page: Page, slug: string, channelName: string) {
  await page.goto(`/w/${slug}/channels`)
  await page
    .locator("section")
    .filter({ hasText: channelName })
    .getByRole("button", { name: "Connect", exact: true })
    .click()
  await expect(
    page.locator("section").filter({ hasText: channelName }).getByText("Connected"),
  ).toBeVisible()
}

async function createProductWithListings(page: Page, slug: string, name: string) {
  await page.goto(`/w/${slug}/products/new`)
  await page.getByLabel("Product name").fill(name)
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()
  await waitForProductPage(page, slug)

  // Click one at a time and wait for the re-render between clicks. Collecting
  // every handle up front and clicking them in turn leaves stale handles, since
  // the first save re-renders the panel underneath them.
  let built = 0
  while ((await page.getByRole("button", { name: "Build listing" }).count()) > 0 && built < 6) {
    await page.getByRole("button", { name: "Build listing" }).first().click()
    built += 1
    await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(built)
  }
  expect(built).toBeGreaterThan(0)
}

test("a creator hand-writes a listing and watches readiness resolve", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j4w", "Handwritten Studio")
  await connect(page, slug, "Mock Marketplace")
  await createProductWithListings(page, slug, "Aster Grotesk")

  await page.getByRole("link", { name: "Edit listing" }).first().click()
  await page.waitForURL(new RegExp(`/w/${slug}/products/[^/]+/channels/[^/]+$`))

  // Nothing has been written for this channel yet, so it says what it wants.
  await expect(page.getByText("Add at least 3 tags. There are 0.")).toBeVisible()
  const bar = page.getByRole("progressbar")
  const before = Number(await bar.getAttribute("aria-valuenow"))
  expect(before).toBeLessThan(100)

  // Readiness moves while typing, before anything is saved.
  await page.getByLabel("Title", { exact: true }).fill("Aster Grotesk Display")
  await page.getByLabel("Tags", { exact: true }).fill("grotesque, sans serif, editorial")
  await expect(page.getByText("Add at least 3 tags. There are 0.")).toBeHidden()

  await page.getByLabel("Description", { exact: true }).fill("y".repeat(220))
  await page.getByLabel("Price", { exact: true }).fill("48")

  const after = Number(await bar.getAttribute("aria-valuenow"))
  expect(after).toBeGreaterThan(before)

  await page.getByRole("button", { name: "Save listing" }).click()
  await expect(page.getByRole("status")).toHaveText("Saved")

  // The hand-written copy survives a reload, and so does the verdict.
  await page.reload()
  await expect(page.getByLabel("Tags", { exact: true })).toHaveValue(
    "grotesque, sans serif, editorial",
  )
  expect(Number(await page.getByRole("progressbar").getAttribute("aria-valuenow"))).toBe(after)
})

test("a listing the channel would reject still saves, so the reason stays visible", async ({
  page,
}) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j4r", "Reject Studio")
  await connect(page, slug, "Mock Marketplace")
  await createProductWithListings(page, slug, "Unfinished Font")

  await page.getByRole("link", { name: "Edit listing" }).first().click()
  await page.waitForURL(/\/channels\/[^/]+$/)

  // A description containing a link is exactly what this channel refuses.
  await page
    .getByLabel("Description", { exact: true })
    .fill("Buy at https://example.com " + "y".repeat(200))
  await expect(page.getByText("The description contains a link.")).toBeVisible()

  await page.getByRole("button", { name: "Save listing" }).click()
  await expect(page.getByRole("status")).toHaveText("Saved")

  // Saved, and still refused. Refusing the save would have put the explanation
  // behind the fix.
  await page.reload()
  await expect(page.getByText("The description contains a link.")).toBeVisible()
  await expect(page.getByText("would reject it as it stands")).toBeVisible()
})

test("two channels judge the same hand-written copy differently", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j4t", "Two Verdict Studio")
  await connect(page, slug, "Mock Storefront")
  await connect(page, slug, "Mock Marketplace")
  await createProductWithListings(page, slug, "Two Channel Font")

  const productUrl = page.url()
  const bars = page.getByRole("progressbar")
  await expect(bars).toHaveCount(2)

  const values = await bars.evaluateAll((nodes) =>
    nodes.map((n) => Number(n.getAttribute("aria-valuenow"))),
  )
  // Same product, same moment, different verdicts.
  expect(new Set(values).size).toBe(2)

  // Editing one channel does not touch the other: listings are independent rows.
  await page.getByRole("link", { name: "Edit listing" }).first().click()
  await page.waitForURL(/\/channels\/[^/]+$/)
  await page.getByLabel("Title", { exact: true }).fill("Only this channel")
  await page.getByRole("button", { name: "Save listing" }).click()
  await expect(page.getByRole("status")).toHaveText("Saved")

  await page.goto(productUrl)
  const titles = await page.locator("section p").allTextContents()
  expect(titles.filter((t) => t === "Only this channel")).toHaveLength(1)
})

test("a field can be pulled from the canonical product on purpose", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j4p", "Pull Studio")
  await connect(page, slug, "Mock Storefront")

  await page.goto(`/w/${slug}/products/new`)
  await page.getByLabel("Product name").fill("Canonical Font")
  await page.getByRole("button", { name: "Create product" }).click()
  await waitForProductPage(page, slug)

  await page.getByLabel("Canonical title").fill("The Canonical Title")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByRole("status")).toHaveText("Saved")

  await page.getByRole("button", { name: "Build listing" }).click()
  await page.getByRole("link", { name: "Edit listing" }).click()
  await page.waitForURL(/\/channels\/[^/]+$/)

  await page.getByLabel("Title", { exact: true }).fill("Diverged by hand")
  await page.getByRole("button", { name: "Use canonical title" }).click()
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("The Canonical Title")
})
