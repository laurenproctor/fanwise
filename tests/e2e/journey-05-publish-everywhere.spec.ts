import { expect, test } from "@playwright/test"
import { newCreator } from "./support"
import {
  clearFontBlockers,
  connect,
  listingCard,
  openFontSection,
  uploadFontFile,
  uploadSpecimenImage,
  waitForProductPage,
  writeListing,
} from "./publish-support"

/**
 * A7's exit test, the part a mock channel can prove.
 *
 * The exit itself reads "one action, two live URLs, one failure recovered
 * without duplicates", and two live URLs needs two live channels: a real
 * Shopify store and a real Etsy shop, which is a run a person does by hand.
 * What CI can prove is everything above the provider: one click starts the
 * channels that can take the product, says what it skipped and why, refuses to
 * send the same thing twice, and records what it did.
 *
 * The recovery half is proved where it can be made to happen on demand:
 * tests/unit/publish-retry.test.ts for the schedule and the create that is
 * never repeated, and tests/db/publication-idempotency.test.ts for the guard
 * that makes a second attempt create nothing. Which channels a run attempts or
 * skips, for every combination of capability and state, is
 * tests/unit/publish-run.test.ts.
 */

test("one click publishes what it can and names what it skipped", async ({ page }) => {
  const { slug } = await newCreator(page, "j5e", "Everywhere Studio")

  // Only a channel that structurally cannot publish, to begin with.
  await connect(page, slug, "Mock Marketplace")

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Aster Grotesk")
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()
  await waitForProductPage(page, slug, "Aster Grotesk")
  // A font's channel cards and Publish Everywhere are in its workspace's
  // Marketplace drafts section, addressed by hash so every visit opens it.
  const productPage = `${page.url().split("#")[0]}#drafts`

  await openFontSection(page, "Marketplace drafts")
  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(1)

  // With no connected channel that can publish, there is nothing to press.
  // Absent, not disabled: a greyed-out Publish Everywhere promises an action
  // that will never work on a channel with no publish method. Anchored to the
  // start of the name so it matches Publish and Republish, the actions, and not
  // the glossary trigger explaining what "not published" means.
  await expect(page.getByRole("region", { name: "Publish everywhere" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^(re)?publish/i })).toHaveCount(0)

  // The section appears the moment a channel that can publish is connected.
  await connect(page, slug, "Mock Storefront")
  await page.goto(productPage)
  await expect(page.getByRole("region", { name: "Publish everywhere" })).toBeVisible()

  // Nothing has happened yet, and the log says so rather than sitting empty.
  await expect(page.getByText("Nothing has been published from here yet.")).toBeVisible()

  await uploadSpecimenImage(page, "tests/fixtures/small-800x600.png")
  await uploadFontFile(page, "Aster Grotesk")
  await clearFontBlockers(page)

  // One listing per connected channel, then write the one that can be sent.
  await openFontSection(page, "Marketplace drafts")
  await page.getByRole("button", { name: "Build listing" }).first().click()
  await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(2)

  // The storefront's listing, which is the second card now: cards follow the
  // order channels were connected in.
  await writeListing(page, slug, listingCard(page, "Mock Storefront", "Mock Marketplace"))
  await page.goto(productPage)

  // The assisted card still offers no publish of its own, beside one that does.
  const assistedCard = listingCard(page, "Mock Marketplace", "Mock Storefront")
  await expect(assistedCard.getByText("Status here is self-reported.")).toBeVisible()
  await expect(assistedCard.getByRole("button", { name: /^(re)?publish/i })).toHaveCount(0)

  const run = page.getByRole("region", { name: "Publish everywhere" })

  // What it will do, before it is pressed: one channel ready, and the assisted
  // one named with its reason rather than left out.
  await expect(run.getByText("One channel is ready to receive this product.")).toBeVisible()
  // Scoped to the connected channel's own row: since B9 the catalog holds a
  // second assisted channel, unconnected, and the planner names it with the
  // same reason, because what it cannot do does not depend on a connection.
  await expect(
    run
      .getByRole("listitem")
      .filter({ hasText: "Mock Marketplace" })
      .getByText("Fanwise cannot publish here. You submit this listing yourself."),
  ).toBeVisible()

  await run.getByRole("button", { name: "Publish everywhere" }).click()

  // The headline is a count, never an adjective about the product.
  await expect(run.getByRole("status")).toContainText("Publishing to 1 channel")
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("link", { name: /View on Mock Storefront/ })).toHaveCount(1)

  // Nothing anywhere calls the product published, partially published or any
  // other word that summarises channels. ADR 0005 decision 7.
  await expect(page.getByText(/partially published/i)).toHaveCount(0)

  await page.reload()

  // A second run sends nothing again, and says why: the channel holds the
  // product and there is nothing new to send, so the button does not pretend
  // otherwise.
  await expect(run.getByText("No channel is ready to receive this product yet.")).toBeVisible()
  await expect(run.getByText("Already published. Nothing new to send.")).toBeVisible()
  await expect(run.getByRole("button", { name: "Publish everywhere" })).toBeDisabled()
  await expect(page.getByRole("link", { name: /View on Mock Storefront/ })).toHaveCount(1)

  // The activity log records the run, and the job that settled inside it.
  // Written as they happened, and still here after a reload because the rows
  // cannot be edited or removed.
  await expect(page.getByText("Publishing to 1 channel")).toBeVisible()
  await expect(page.getByText(/A publish finished/)).toBeVisible({ timeout: 30_000 })
})
