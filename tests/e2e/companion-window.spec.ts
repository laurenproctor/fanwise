import { expect, test, type Page } from "@playwright/test"
import { listingUrl, newCreator, productUrl } from "./support"

/**
 * B11: the assisted handoff, and the companion window that shows it beside a
 * marketplace's editor. docs/companion-window.md.
 *
 * Not a new journey. It is the handoff an assisted listing ends in, read from
 * the page and then from the companion window, which is the same component
 * portalled into a second document. The companion is a Document
 * Picture-in-Picture window, so the spec reaches it through the page that owns
 * it (`documentPictureInPicture.window`) rather than as a Playwright page.
 *
 * What no browser test can see is the part that matters to a creator: the
 * window staying on top of a real marketplace tab, a copy landing in that
 * marketplace's editor, a file dragged out. Those are the manual run in
 * docs/companion-window.md §7.
 */

type CompanionHost = { documentPictureInPicture?: { window: Window | null } }

async function assistedListing(page: Page) {
  const { slug } = await newCreator(page, "b11", "Companion Studio")

  await page.goto(`/${slug}/channels`)
  const card = page.locator("section").filter({ hasText: "Mock Marketplace" })
  await card.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(card.getByText("Connected")).toBeVisible()

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Aster Grotesk")
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL((url) => productUrl(slug).test(url.pathname))
  await expect(page.getByRole("heading", { name: "Aster Grotesk" })).toBeVisible()

  await page.getByRole("button", { name: "Build listing" }).click()
  await page.getByRole("link", { name: "Edit listing" }).click()
  await page.waitForURL(listingUrl(slug))

  await page.getByLabel("Title", { exact: true }).fill("Aster Grotesk Display")
  await page.getByLabel("Tags", { exact: true }).fill("grotesque, sans serif, editorial")
  await page
    .getByLabel("Description", { exact: true })
    .fill("A grotesque for editorial work. ".repeat(6))
  await page.getByLabel("Price", { exact: true }).fill("15")
  await page.getByRole("button", { name: "Save listing" }).click()
  await expect(page.getByRole("status")).toHaveText("Saved")

  // The handoff reads the saved listing, so it is read after a reload.
  await page.reload()
  await expect(page.getByText("Mock Marketplace handoff")).toBeVisible()
}

test("an assisted listing ends in a handoff the creator can copy from, beside the marketplace", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await assistedListing(page)

  await expect(page.getByText("Submit the listing on Mock Marketplace yourself.")).toBeVisible()
  await expect(page.getByText("15.00", { exact: true })).toBeVisible()

  // Copy holds its state until the next copy, so the creator can see their place.
  await page.getByRole("button", { name: "Copy title" }).click()
  await expect(page.getByRole("button", { name: "Copied title" })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Aster Grotesk Display")
  await page.getByRole("button", { name: "Copy tags" }).click()
  await expect(page.getByRole("button", { name: "Copy title" })).toBeVisible()

  // The suite runs Chromium, which has the API, headless included. Asserted
  // rather than branched on, so a browser without it fails loudly instead of
  // skipping the half of this test that matters. Where the API is missing the
  // button is not rendered, which tests/unit/handoff.test.ts holds.
  expect(await page.evaluate(() => "documentPictureInPicture" in window)).toBe(true)

  await page.getByRole("button", { name: "Pop out ↗" }).click()
  await expect(page.getByText("Open in the companion window.")).toBeVisible()
  // One handoff, now in the other document: gone from the page.
  await expect(page.getByText("Mock Marketplace handoff")).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as CompanionHost).documentPictureInPicture?.window?.document.body
            .textContent ?? "",
      ),
    )
    .toContain("Mock Marketplace handoff")

  // Styled, not bare: the page's sheets were carried across.
  expect(
    await page.evaluate(
      () =>
        (window as unknown as CompanionHost).documentPictureInPicture?.window?.document.styleSheets
          .length ?? 0,
    ),
  ).toBeGreaterThan(0)

  // A click inside the companion reaches the handoff's own handler: React
  // listens on the portal's container, in the other document.
  const copyState = () =>
    page.evaluate(() => {
      const companion = (window as unknown as CompanionHost).documentPictureInPicture?.window
      const button = companion?.document.querySelector<HTMLButtonElement>(
        'button[aria-label="Copy title"], button[aria-label="Copied title"]',
      )
      return button?.getAttribute("aria-label") ?? null
    })
  expect(await copyState()).toBe("Copy title")
  await page.evaluate(() => {
    const companion = (window as unknown as CompanionHost).documentPictureInPicture?.window
    companion?.document.querySelector<HTMLButtonElement>('button[aria-label="Copy title"]')?.click()
  })
  await expect.poll(copyState).toBe("Copied title")

  await page.getByRole("button", { name: "Bring it back" }).click()
  await expect(page.getByText("Mock Marketplace handoff")).toBeVisible()
  await expect(page.getByText("Open in the companion window.")).toHaveCount(0)
})
