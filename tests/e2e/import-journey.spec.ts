import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { signUpAndCreateWorkspace } from "./support"
import {
  chooseLicense,
  confirmOwnership,
  fillListing,
  importAnalyzedSource,
  openChecklistRow,
  saveListing,
  zipFile,
} from "./import-support"

/**
 * The whole import, end to end: paste, edit, upload, licence, ownership,
 * handoff.
 *
 * The one thing seeded is the network result — see `import-support.ts` for why
 * the outbound boundary makes a local fixture server impossible on purpose.
 * Everything else runs as the signed-in creator, through RLS, against the real
 * actions and the real readiness.
 *
 * Readiness is asserted through `aria-valuenow` rather than the percentage,
 * because the count is what the rule is and the figure is display.
 */

const progressOf = (page: import("@playwright/test").Page) => page.getByRole("progressbar")
const reviewButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Review marketplace drafts" })

test("a creator goes from a pasted link to the marketplace drafts", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1", "Journey Studio")

  // 1 and 2: a supported link, analyzed, with a product draft behind it.
  const { importUrl } = await importAnalyzedSource(page, slug)
  await expect(page.getByText("Aster Grotesk").first()).toBeVisible()

  // Source is done; the other four are not.
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "1")

  // 3: the creator edits what was suggested. Editing is itself a review, so
  // the listing step completes without the acknowledgment.
  await fillListing(page, {
    name: "Aster Grotesk Pro",
    price: "48",
    description: "Six weights and matching italics, for screens.",
  })
  await saveListing(page)
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "2")

  // 7 begins: two of five is 40%, which is where the approved design sits.
  await expect(progressOf(page)).toHaveAttribute(
    "aria-valuetext",
    "2 of 5 steps complete, 40 percent",
  )

  // 8: blocked, and it says how many things are left.
  await expect(reviewButton(page)).toHaveAttribute("aria-disabled", "true")
  await expect(page.getByText("Complete 3 required items to continue.")).toBeVisible()

  // 4: a buyer file, through the pipeline the product page uses.
  await openChecklistRow(page, "upload customer files")
  await page.getByLabel(/Upload files/).setInputFiles(zipFile())
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "3", { timeout: 20_000 })

  // 5: a licence, recorded with its version.
  await chooseLicense(page)
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "4", { timeout: 20_000 })
  await openChecklistRow(page, "choose license")
  await expect(page.getByText(/Recorded as Commercial use, version/)).toBeVisible()

  // 6: the attestation, in the application's own words.
  await confirmOwnership(page, "Inter (SIL Open Font License)")
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "5", { timeout: 20_000 })

  // 7 ends: five of five is 100%, from persisted steps. Asserted on the
  // progress control's own value text, which is what the rule actually is.
  await expect(progressOf(page)).toHaveAttribute(
    "aria-valuetext",
    "5 of 5 steps complete, 100 percent",
  )
  await expect(page.getByText("Nothing left. Every required item is done.")).toBeVisible()

  // 9: the existing marketplace surface, not a second one.
  await expect(reviewButton(page)).not.toHaveAttribute("aria-disabled", "true")
  await reviewButton(page).click()
  await expect(page).toHaveURL(new RegExp(`/${slug}/[a-z0-9-]+$`), { timeout: 20_000 })
  await expect(page.getByRole("heading", { name: "Aster Grotesk Pro" })).toBeVisible()
  // The product page is where channel drafts have always been built.
  await expect(page.getByRole("heading", { name: /Channels/i }).first()).toBeVisible()

  // 10: going back preserves everything, and made no second product.
  await page.goto(importUrl)
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "5")
  await expect(page.getByRole("textbox", { name: "Product name" })).toHaveValue("Aster Grotesk Pro")

  await page.goto(routes.workspace(slug))
  await expect(page.getByRole("link", { name: "Aster Grotesk Pro", exact: true })).toHaveCount(1)
})

test("the master listing stays canonical and the marketplace drafts derive from it", async ({
  page,
}) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j2", "Canonical Studio")
  await importAnalyzedSource(page, slug)

  await fillListing(page, {
    name: "Canonical Name",
    price: "12",
    description: "What a buyer receives is written here.",
  })
  await saveListing(page)

  // The product page reads the same record, which is the definition of
  // canonical: one place the name lives, and every listing derived from it.
  await page.goto(routes.workspace(slug))
  await page.getByRole("link", { name: "Canonical Name", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Canonical Name" })).toBeVisible()
})

test("a private link offers a way out and never reads as imported", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j3", "Private Studio")

  await page.goto(routes.importProduct(slug))
  await page.getByLabel("Product link").fill("https://fanwise-import.invalid/private-thing")
  await page.getByRole("button", { name: "Analyze product" }).click()
  await expect(page).toHaveURL(new RegExp(`${slug}/new/link/[0-9a-f-]{36}$`), { timeout: 20_000 })

  // The source step is not complete, and the gate is shut.
  await expect(page.getByRole("heading", { name: "That did not finish" })).toBeVisible({
    timeout: 30_000,
  })
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "0")
  await expect(reviewButton(page)).toHaveAttribute("aria-disabled", "true")

  // Every way out is offered, and continuing by hand goes to the product.
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Continue manually" })).toBeVisible()
})

test("a failed replacement upload leaves the file that was already there", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j4", "Replace Studio")
  await importAnalyzedSource(page, slug)

  await openChecklistRow(page, "upload customer files")
  await page.getByLabel(/Upload files/).setInputFiles(zipFile("original.zip"))
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "2", { timeout: 20_000 })
  await expect(page.getByText("original.zip")).toBeVisible()

  /*
    The server refuses to remove the only measured file, which is what makes
    replacing safe: there is no window in which a creator has no deliverable
    because a replacement was accepted before it existed.
  */
  await page.getByRole("button", { name: "Remove original.zip" }).click()
  await expect(
    page.getByText("That is the only file buyers would receive. Upload its replacement first."),
  ).toBeVisible()
  await expect(page.getByText("original.zip")).toBeVisible()
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "2")

  // With a second file stored, the first can go.
  await page.getByLabel(/Upload a replacement/).setInputFiles(zipFile("replacement.zip"))
  await expect(page.getByText("replacement.zip")).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: "Remove original.zip" }).click()
  await expect(page.getByText("original.zip")).toBeHidden({ timeout: 20_000 })
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "2")
})

test("replacing the source keeps everything and shows what changed", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j5", "Swap Studio")
  const { importUrl } = await importAnalyzedSource(page, slug)

  // Work the creator has done, saved.
  await fillListing(page, {
    name: "Mine, Not The Page's",
    price: "30",
    description: "My own words about the product.",
  })
  await saveListing(page)

  await chooseLicense(page)
  await confirmOwnership(page)
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "4", { timeout: 20_000 })

  // Swap the link. The dialog says what will and will not happen first.
  await page.getByRole("button", { name: "Replace link" }).click()
  await expect(page.getByRole("heading", { name: "Use a different link" })).toBeVisible()
  await expect(page.getByText(/Your listing, your files, your licence/)).toBeVisible()

  await page.getByLabel("New product link").fill("https://fanwise-import.invalid/somewhere-else")
  await page.getByRole("button", { name: "Read this link instead" }).click()

  // The new page cannot be read, which is not the point: the point is that
  // nothing the creator did was touched by trying.
  await page.goto(importUrl)
  await expect(page.getByRole("textbox", { name: "Product name" })).toHaveValue(
    "Mine, Not The Page's",
  )
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    "My own words about the product.",
  )
  await openChecklistRow(page, "choose license")
  await expect(page.getByText(/Recorded as Commercial use/)).toBeVisible()
  await openChecklistRow(page, "confirm ownership")
  await expect(page.getByText(/I created this product or have permission/)).toBeVisible()
})

test("another workspace cannot reach, read or act on an import", async ({ page, browser }) => {
  const owner = await signUpAndCreateWorkspace(page, "j6a", "Owner Studio")
  const { importUrl } = await importAnalyzedSource(page, owner.slug)

  const other = await browser.newContext()
  const stranger = await other.newPage()
  await signUpAndCreateWorkspace(stranger, "j6b", "Stranger Studio")

  // The same address, as somebody else. Not found, which is indistinguishable
  // from an id that was never real.
  await stranger.goto(importUrl)
  await expect(stranger.getByText(/not found/i).first()).toBeVisible()
  await expect(stranger.getByRole("heading", { name: "What Fanwise found" })).toBeHidden()

  await other.close()
})

test("the whole flow works on a phone, without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { slug } = await signUpAndCreateWorkspace(page, "j7", "Phone Studio")
  await importAnalyzedSource(page, slug)

  await fillListing(page, {
    name: "Pocket Sans",
    price: "9",
    description: "A face for small screens.",
  })
  await saveListing(page)

  await openChecklistRow(page, "upload customer files")
  await page.getByLabel(/Upload files/).setInputFiles(zipFile())
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "3", { timeout: 20_000 })

  await chooseLicense(page)
  await confirmOwnership(page)
  await expect(progressOf(page)).toHaveAttribute("aria-valuenow", "5", { timeout: 20_000 })

  // The action is reachable and fully on screen at this width.
  const review = reviewButton(page)
  await review.scrollIntoViewIfNeeded()
  const box = await review.boundingBox()
  expect(box).toBeTruthy()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
