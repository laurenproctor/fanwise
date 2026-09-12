import { expect, type Page } from "@playwright/test"
import { listingUrl, productUrl } from "./support"

/**
 * The setup every publishing journey needs: a connected channel, a product with
 * the files a channel demands, and a listing somebody has written.
 *
 * Shared rather than copied because the hard-won parts are the waits, and a
 * second copy of a wait is a second thing to get wrong. Each one below records
 * the failure it exists to prevent.
 */

/**
 * Waits for the product page, URL and content both.
 *
 * `productUrl` already excludes `/new` and the other reserved segments, so the
 * URL cannot match the form just submitted. The second wait is the one that
 * matters after that: an App Router transition changes the URL before the page
 * renders, so without it the next locator counts elements on a loading
 * boundary and finds none.
 */
export async function waitForProductPage(page: Page, slug: string, name: string) {
  await page.waitForURL((url) => productUrl(slug).test(url.pathname))
  await expect(page.getByRole("heading", { name })).toBeVisible()
}

export async function connect(page: Page, slug: string, channelName: string) {
  await page.goto(`/${slug}/channels`)
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
export async function upload(page: Page, type: string, fixture: string, expectedFileRows: number) {
  const filename = fixture.split("/").pop()!

  /*
   * Gallery images are uploaded here and land in the Images section, not in
   * the Files table: they are shop-window pictures rather than part of the
   * download. So the assertion follows the file to wherever it went. The tile
   * renders its <img> only once the asset is ready, which makes one locator
   * stand for both "it arrived" and "it finished".
   */
  const gallery = type === "cover_image" || type === "preview_image"
  const landed = gallery
    ? page.getByRole("img", { name: filename })
    : page.getByRole("cell", { name: filename, exact: true })

  await page.getByLabel("File type").selectOption(type)
  await page.getByLabel("Add a file").setInputFiles(fixture)

  // Wait for the component's own reload before touching the page.
  //
  // The browser PUTs the bytes straight to storage and then calls finalize, and
  // the component reloads itself when both have returned. Reloading underneath
  // that aborts the in-flight PUT, and the asset then sits pending forever with
  // no error anywhere: the row exists because the intent was created, and the
  // bytes never arrived. That looked exactly like a broken finalize job.
  await expect(landed).toBeVisible({ timeout: 60_000 })

  // Now poll. The row stays pending until a background job has measured the
  // stored bytes, because nothing the browser claimed about the file is
  // trusted, so the test waits for the same verdict a channel's asset rule
  // waits for.
  await expect(async () => {
    await page.reload()
    if (gallery) {
      await expect(landed).toBeVisible({ timeout: 5_000 })
    } else {
      await expect(page.getByRole("cell", { name: "Ready", exact: true })).toHaveCount(
        expectedFileRows,
        { timeout: 5_000 },
      )
    }
  }).toPass({ timeout: 60_000 })
}

export async function writeListing(page: Page, slug: string) {
  await page.getByRole("link", { name: "Edit listing" }).first().click()
  await page.waitForURL(listingUrl(slug))

  await page.getByLabel("Title", { exact: true }).fill("Aster Grotesk Display")
  await page
    .getByLabel("Description", { exact: true })
    .fill("A grotesque in nine weights, drawn for long text and set tight at display sizes.")
  await page.getByLabel("Price", { exact: true }).fill("48")
  await page.getByRole("button", { name: "Save listing" }).click()
  await expect(page.getByRole("status")).toHaveText("Saved")
}
