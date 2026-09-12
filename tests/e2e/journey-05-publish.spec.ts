import { expect, test } from "@playwright/test"
import { newCreator } from "./support"
import { connect, upload, waitForProductPage, writeListing } from "./publish-support"

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
 *
 * That an assisted channel never offers Publish is asserted in
 * journey-03-channels.spec.ts and journey-05-publish-everywhere.spec.ts, which
 * both connect one, and in tests/unit/listing-panel.test.ts over every state.
 */

test("a product publishes, and clicking publish again creates nothing", async ({ page }) => {
  const { slug } = await newCreator(page, "j5p", "Publishing Studio")
  await connect(page, slug, "Mock Storefront")

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Aster Grotesk")
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()
  await waitForProductPage(page, slug, "Aster Grotesk")
  const productPage = page.url()

  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(1)

  // A listing that is not ready cannot be published. No deliverable, no cover
  // image, no description: the channel's own rules say so, and the button is
  // offered but refuses rather than being hidden, because the creator needs to
  // see that publishing is the next step once they fix it.
  await expect(page.getByText("Resolve what is blocking before publishing.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled()

  await upload(page, "cover_image", "tests/fixtures/small-800x600.png", 0)
  await upload(page, "deliverable", "tests/fixtures/specimen-3000x2000.jpg", 1)

  await writeListing(page, slug)
  await page.goto(productPage)

  // Nothing has been sent yet, and the card says so rather than staying blank.
  await expect(page.getByText("Not published")).toBeVisible()
  await expect(page.getByText("Resolve what is blocking before publishing.")).toHaveCount(0)

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
