import { expect, test } from "@playwright/test"
import { newCreator, productUrl } from "./support"
import { listingCard } from "./publish-support"

/**
 * A3's exit test, driven through the browser.
 *
 * One product yields two independent listings on two channels, the assisted
 * channel offers no publishing at any point, and the two channels reach
 * different verdicts about the same product because they enforce different
 * rules.
 *
 * What each channel says it cannot do, before it is connected, is rendered and
 * checked in tests/unit/capability-list.test.ts against every adapter's real
 * capabilities; that an assisted adapter has no publish method at all is
 * tests/unit/channels.test.ts and tests/unit/channel-boundaries.test.ts.
 *
 * This is not journey 3 from docs/testing.md, which needs a real Shopify
 * connection at A5. It is the mock-channel proof that the contract holds first.
 */

async function createProduct(page: import("@playwright/test").Page, slug: string, name: string) {
  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill(name)
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()
  // `/products/[^/]+$` also matches `/products/new`, so waiting on that pattern
  // resolves instantly against the form just submitted and races the redirect.
  await page.waitForURL(
    (url) => productUrl(slug).test(url.pathname) && !url.pathname.endsWith("/new"),
  )
}

test("one product yields two independent listings, judged by different rules", async ({ page }) => {
  const { slug } = await newCreator(page, "j3two", "Two Channel Studio")

  await page.goto(`/${slug}/channels`)
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

  // And it never offers publishing. Not disabled: absent. A greyed-out button
  // still promises the action will work one day, and on this channel it never
  // will. Anchored to the start of the name so it matches Publish and
  // Republish, the actions, and not the glossary trigger "What not published
  // means", which explains the state without offering to change it.
  await expect(
    listingCard(page, "Mock Marketplace", "Mock Storefront").getByRole("button", {
      name: /^(re)?publish/i,
    }),
  ).toHaveCount(0)
  await expect(page.getByText("Publishing arrives at step A7")).toHaveCount(0)
})

test("disconnecting a channel takes its listings with it", async ({ page }) => {
  const { slug } = await newCreator(page, "j3dis", "Disconnect Studio")

  await page.goto(`/${slug}/channels`)
  await page
    .locator("section")
    .filter({ hasText: "Mock Storefront" })
    .getByRole("button", { name: "Connect", exact: true })
    .click()
  await expect(page.getByText("Connected")).toBeVisible()

  await createProduct(page, slug, "Doomed Listing")
  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("button", { name: "Rebuild" })).toBeVisible()

  await page.goto(`/${slug}/channels`)
  await page.getByRole("button", { name: "Disconnect", exact: true }).click()
  // Destructive and irreversible, so it says what it will do before it does it.
  await expect(page.getByText("removes its listings from Fanwise")).toBeVisible()
  await page.getByRole("button", { name: "Yes, disconnect" }).click()

  // Scoped to the card, not the page. Every unconnected channel offers a
  // Connect button, so an unscoped locator counts the other channels too and
  // starts failing the moment a channel is added, which is what happened when
  // Shopify arrived at A5.
  await expect(
    page
      .locator("section")
      .filter({ hasText: "Mock Storefront" })
      .getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible()

  await page.goto(`/${slug}`)
  // Exact: a catalog row carries two links to the same product, the name and
  // the next action, and the action's accessible name ends with the product's
  // so a screen reader can tell one row's action from another's.
  await page.getByRole("link", { name: "Doomed Listing", exact: true }).click()
  await expect(page.getByText("No channels connected")).toBeVisible()
})
