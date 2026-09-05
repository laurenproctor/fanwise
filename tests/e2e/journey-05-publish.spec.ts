import { expect, test, type Page } from "@playwright/test"
import { signUpAndCreateWorkspace } from "./support"

/**
 * A5's exit test, the two thirds of it a mock channel can prove:
 * a product publishes, and a second click creates nothing.
 *
 * The third clause — "the file is actually deliverable to a buyer" — needs a
 * real storefront and a real buyer, and the Shopify Partner account was still
 * pending when A5 was written. What stands in for it here is the shape that
 * makes it true: publishing is refused until a deliverable exists, and a
 * channel that cannot upload one leaves a required step outstanding and its
 * product not live. Both are proved at the unit and database layers.
 *
 * Mock Storefront is used deliberately rather than a real channel: it declares
 * digitalFileUpload, so it is the case with nothing left for a human to do, and
 * everything above the adapter is identical.
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

/**
 * Uploads one file and waits for the finalize job to move it to ready.
 *
 * `expected` is the number of ready rows there should be afterwards, so the
 * second upload waits for its own row rather than seeing the first one and
 * returning immediately.
 *
 * The assertion inside the retry has to be an auto-waiting one. A bare `count()`
 * runs the instant the reload resolves, catches the page mid-render — the
 * snapshot from the first version of this test showed nothing but "Loading" —
 * and reports zero rows for a table that was about to appear.
 */
async function upload(page: Page, type: string, fixture: string, expected: number) {
  const filename = fixture.split("/").pop()!

  await page.getByLabel("File type").selectOption(type)
  await page.getByLabel("Add a file").setInputFiles(fixture)

  // Wait for the component's own reload before touching the page.
  //
  // The browser PUTs the bytes straight to storage and then calls finalize, and
  // the component reloads itself when both have returned. Reloading underneath
  // that aborts the in-flight PUT, and the asset then sits pending forever with
  // no error anywhere: the row exists because the intent was created, and the
  // bytes never arrived. That looked exactly like a broken finalize job.
  await expect(page.getByRole("cell", { name: filename, exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // Now poll. The row stays pending until a background job has measured the
  // stored bytes, because nothing the browser claimed about the file is
  // trusted, so the test waits for the same verdict a channel's asset rule
  // waits for.
  await expect(async () => {
    await page.reload()
    await expect(page.getByRole("cell", { name: "Ready", exact: true })).toHaveCount(expected, {
      timeout: 5_000,
    })
  }).toPass({ timeout: 60_000 })
}

async function writeListing(page: Page, slug: string) {
  await page.getByRole("link", { name: "Edit listing" }).first().click()
  await page.waitForURL(new RegExp(`/w/${slug}/products/[^/]+/channels/[^/]+$`))

  await page.getByLabel("Title", { exact: true }).fill("Aster Grotesk Display")
  await page
    .getByLabel("Description", { exact: true })
    .fill("A grotesque in nine weights, drawn for long text and set tight at display sizes.")
  await page.getByLabel("Price", { exact: true }).fill("48")
  await page.getByRole("button", { name: "Save listing" }).click()
  await expect(page.getByRole("status")).toHaveText("Saved")
}

test("a product publishes, and clicking publish again creates nothing", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j5p", "Publishing Studio")
  await connect(page, slug, "Mock Storefront")

  await page.goto(`/w/${slug}/products/new`)
  await page.getByLabel("Product name").fill("Aster Grotesk")
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()
  await waitForProductPage(page, slug)
  const productUrl = page.url()

  await upload(page, "cover_image", "tests/fixtures/small-800x600.png", 1)
  await upload(page, "deliverable", "tests/fixtures/specimen-3000x2000.jpg", 2)

  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(1)

  await writeListing(page, slug)
  await page.goto(productUrl)

  // Nothing has been sent yet, and the card says so rather than staying blank.
  await expect(page.getByText("Not published")).toBeVisible()

  await page.getByRole("button", { name: "Publish", exact: true }).click()

  // Publishing runs in a background job, so the card resolves rather than
  // updating instantly. Live is the state that means a buyer can reach it.
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("link", { name: /View on Mock Storefront/ })).toHaveCount(1)

  // The second click is impossible rather than merely harmless: a published
  // listing offers no Publish button, because the only outcome would be
  // "already published".
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0)

  // And it survives a reload as one listing, one link, one published state.
  await page.reload()
  await expect(page.getByText("Live", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: /View on Mock Storefront/ })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0)
})

test("a listing that is not ready cannot be published", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j5g", "Unready Studio")
  await connect(page, slug, "Mock Storefront")

  await page.goto(`/w/${slug}/products/new`)
  await page.getByLabel("Product name").fill("Unfinished Font")
  await page.getByRole("button", { name: "Create product" }).click()
  await waitForProductPage(page, slug)

  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(1)

  // No deliverable, no cover image, no description. The channel's own rules
  // say so, and the button is offered but refuses rather than being hidden:
  // the creator needs to see that publishing is the next step once they fix it.
  await expect(page.getByText("Resolve what is blocking before publishing.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled()
})

test("an assisted channel never offers to publish", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j5a", "Assisted Studio")
  await connect(page, slug, "Mock Marketplace")

  await page.goto(`/w/${slug}/products/new`)
  await page.getByLabel("Product name").fill("Assisted Font")
  await page.getByRole("button", { name: "Create product" }).click()
  await waitForProductPage(page, slug)

  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(1)

  // Not disabled. Absent. A greyed-out button says "this will work later", and
  // on a channel with no publish method it never will.
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0)
  await expect(page.getByText("Status here is self-reported.")).toBeVisible()
})
