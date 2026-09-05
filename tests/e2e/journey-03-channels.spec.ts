import { expect, test } from "@playwright/test"
import { signUpAndCreateWorkspace } from "./support"

/**
 * A3's exit test, driven through the browser.
 *
 * One product yields two independent listings on two channels, the assisted
 * channel offers no publishing at any point, and the two channels reach
 * different verdicts about the same product because they enforce different
 * rules.
 *
 * This is not journey 3 from docs/testing.md, which needs a real Shopify
 * connection at A5. It is the mock-channel proof that the contract holds first.
 */

async function createProduct(page: import("@playwright/test").Page, slug: string, name: string) {
  await page.goto(`/w/${slug}/products/new`)
  await page.getByLabel("Product name").fill(name)
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()
  // `/products/[^/]+$` also matches `/products/new`, so waiting on that pattern
  // resolves instantly against the form just submitted and races the redirect.
  await page.waitForURL(
    (url) =>
      new RegExp(`^/w/${slug}/products/[^/]+$`).test(url.pathname) &&
      !url.pathname.endsWith("/new"),
  )
}

test("a channel states what it cannot do before it is connected", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j3cap", "Capability Studio")

  await page.getByRole("link", { name: "Channels" }).click()
  await page.waitForURL(new RegExp(`/w/${slug}/channels$`))

  const assisted = page.locator("section").filter({ hasText: "Mock Marketplace" })

  // The limits are visible before anyone commits to the channel, not after.
  await expect(assisted.getByText("Publish automatically — not supported")).toBeVisible()
  await expect(assisted.getByText("Upload the deliverable — not supported")).toBeVisible()
  await expect(assisted.getByText("Fanwise prepares the listing and you submit it")).toBeVisible()

  const api = page.locator("section").filter({ hasText: "Mock Storefront" })
  await expect(api.getByText("Publish automatically", { exact: false }).first()).toBeVisible()
  await expect(api.getByText("Read sales — not supported")).toBeVisible()
})

test("one product yields two independent listings, judged by different rules", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j3two", "Two Channel Studio")

  await page.goto(`/w/${slug}/channels`)
  const cards = page.locator("section")
  await cards
    .filter({ hasText: "Mock Storefront" })
    .getByRole("button", { name: "Connect", exact: true })
    .click()
  await expect(cards.filter({ hasText: "Mock Storefront" }).getByText("Connected")).toBeVisible()

  await cards
    .filter({ hasText: "Mock Marketplace" })
    .getByRole("button", { name: "Connect", exact: true })
    .click()
  await expect(cards.filter({ hasText: "Mock Marketplace" }).getByText("Connected")).toBeVisible()

  await createProduct(page, slug, "Aster Grotesk")

  // Both connected channels offer to build, before either has a listing.
  const buildButtons = page.getByRole("button", { name: "Build listing" })
  await expect(buildButtons).toHaveCount(2)

  await buildButtons.first().click()
  await expect(page.getByRole("button", { name: "Rebuild" })).toHaveCount(1)

  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("button", { name: "Rebuild" })).toHaveCount(2)

  await page.reload()

  // Two listings from one product, each with its own readiness. They disagree,
  // which is the point: the assisted channel demands tags and previews that the
  // storefront does not.
  const bars = page.getByRole("progressbar")
  await expect(bars).toHaveCount(2)

  const values = await bars.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("aria-valuenow")),
  )
  expect(new Set(values).size).toBe(2)

  // The assisted channel says exactly what it would reject.
  const assistedCard = page.locator("section").filter({ hasText: "Mock Marketplace" })
  await expect(assistedCard.getByText("Add at least 3 tags. There are 0.")).toBeVisible()
  await expect(assistedCard.getByText("Status here is self-reported")).toBeVisible()
})

test("the assisted channel never offers publishing, anywhere", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j3pub", "No Publish Studio")

  await page.goto(`/w/${slug}/channels`)
  await page
    .locator("section")
    .filter({ hasText: "Mock Marketplace" })
    .getByRole("button", { name: "Connect", exact: true })
    .click()
  await expect(page.getByText("Connected")).toBeVisible()

  await createProduct(page, slug, "Assisted Only")
  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("button", { name: "Rebuild" })).toBeVisible()

  // Not disabled. Absent. A greyed-out button still promises that the action
  // will work one day, and on this channel it never will.
  await expect(page.getByRole("button", { name: /publish/i })).toHaveCount(0)
  await expect(page.getByText("Publishing arrives at step A7")).toHaveCount(0)
})

test("disconnecting a channel takes its listings with it", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j3dis", "Disconnect Studio")

  await page.goto(`/w/${slug}/channels`)
  await page
    .locator("section")
    .filter({ hasText: "Mock Storefront" })
    .getByRole("button", { name: "Connect", exact: true })
    .click()
  await expect(page.getByText("Connected")).toBeVisible()

  await createProduct(page, slug, "Doomed Listing")
  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("button", { name: "Rebuild" })).toBeVisible()

  await page.goto(`/w/${slug}/channels`)
  await page.getByRole("button", { name: "Disconnect", exact: true }).click()
  // Destructive and irreversible, so it says what it will do before it does it.
  await expect(page.getByText("removes its listings from Fanwise")).toBeVisible()
  await page.getByRole("button", { name: "Yes, disconnect" }).click()

  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible()

  await page.goto(`/w/${slug}/products`)
  await page.getByRole("link", { name: "Doomed Listing" }).click()
  await expect(page.getByText("No channels connected")).toBeVisible()
})
