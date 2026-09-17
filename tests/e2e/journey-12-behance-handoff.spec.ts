import { expect, test } from "@playwright/test"
import { listingUrl, newCreator } from "./support"
import {
  clearFontBlockers,
  listingCard,
  openFontSection,
  uploadFontFile,
  uploadSpecimenImage,
  waitForProductPage,
} from "./publish-support"

/**
 * Journey 12, docs/testing.md: a Behance project and asset composed around a
 * product, handed off in both modes, and the project URL captured.
 *
 * Run against the channel itself rather than a mock, because the channel
 * needs no credential: Connect names a profile and writes a row. What a
 * browser cannot see is Behance's own editor; the exit run in
 * docs/channels/behance.md §2 is the founder carrying a real product through
 * it. What this proves is Fanwise's side: no Publish is ever offered, the
 * handoff runs in the editor's order and shrinks in existing-project mode,
 * the renditions arrive under names the canvas sorts by, and mark submitted
 * leaves a row that says so, self-reported, with the project's address.
 */

const PROJECT_URL = "https://www.behance.net/gallery/123456789/Aster-Grotesk"

test("a product becomes a Behance project by hand, and Fanwise records the creator's word", async ({
  page,
}) => {
  const { slug } = await newCreator(page, "j12", "Portfolio Studio")

  // Connect by naming the profile. No authorization: there is nothing to
  // authorize against, and the card says what the channel cannot do.
  await page.goto(`/${slug}/channels`)
  const channelCard = page.locator("section").filter({ hasText: "Behance" })
  await expect(channelCard.getByText("Assisted", { exact: true })).toBeVisible()
  await channelCard.getByRole("button", { name: "Connect", exact: true }).click()
  await channelCard.getByLabel("Behance profile").fill("https://www.behance.net/astertype")
  await channelCard.getByRole("button", { name: "Connect Behance" }).click()
  await expect(channelCard.getByText("Connected")).toBeVisible()
  await expect(channelCard.getByText("behance.net/astertype")).toBeVisible()

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Aster Grotesk")
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()
  await waitForProductPage(page, slug, "Aster Grotesk")
  const productPage = `${page.url().split("#")[0]}#drafts`

  await openFontSection(page, "Marketplace drafts")
  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(1)

  const card = () => listingCard(page, "Behance", "Mock Storefront")
  // An assisted channel renders no publish affordance at all, not a disabled one.
  await expect(card().getByRole("button", { name: "Publish", exact: true })).toHaveCount(0)

  await uploadSpecimenImage(page, "tests/fixtures/specimen-3000x2000.jpg")
  await uploadFontFile(page, "Aster Grotesk")
  await clearFontBlockers(page)

  // Rebuild now that there are images to render, then open the listing.
  await openFontSection(page, "Marketplace drafts")
  await page.getByRole("button", { name: "Rebuild" }).click()
  await page.getByRole("link", { name: "Edit listing" }).click()
  await page.waitForURL(listingUrl(slug))

  // The choices the channel's form asks for, suggested from the product.
  await expect(page.getByText("Behance choices")).toBeVisible()
  await expect(page.getByRole("checkbox", { name: "Typography" })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Type Design" })).toBeChecked()
  await expect(page.getByRole("radio", { name: /Standard Commercial/ })).toBeChecked()

  // The handoff, in the editor's order, with the fee beside the price and the
  // package under the name a buyer will see.
  await expect(page.getByText("Behance handoff")).toBeVisible()
  await expect(page.getByText("Project images", { exact: true })).toBeVisible()
  await expect(page.getByText("Attach Assets", { exact: true })).toBeVisible()
  await expect(page.getByText("Project settings", { exact: true })).toBeVisible()
  await expect(page.getByText(/You receive about/)).toBeVisible()
  await expect(page.getByText("aster-grotesk-behance.otf").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy creative Fields" })).toBeVisible()

  // Renditions are built in the background and listed once their rows exist,
  // under the numbered names the canvas sorts by.
  await expect(async () => {
    await page.reload()
    await expect(page.locator('a[href*="/download?name=01-"]').first()).toBeVisible({
      timeout: 5_000,
    })
  }).toPass({ timeout: 60_000 })

  // Existing-project mode: the sections Fanwise did not compose are gone,
  // and the handoff says whose project it is.
  await page.getByRole("radio", { name: /Existing project/ }).click()
  await page.getByLabel("The project's address").fill(PROJECT_URL)
  await page.getByRole("button", { name: "Save choices" }).click()
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible()
  await page.reload()
  await expect(page.getByText("Project settings", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Project images", { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Fanwise did not compose that project/)).toBeVisible()
  await expect(page.getByText("Fanwise sends nothing to Behance.").first()).toBeVisible()

  // Mark submitted, with the address captured.
  await page.getByLabel("Project URL").fill("behance.net/gallery/123456789/Aster-Grotesk")
  await page.getByRole("button", { name: "Mark submitted" }).click()
  await expect(page.getByRole("link", { name: PROJECT_URL })).toBeVisible()

  // The card says what the creator said, and says it is their word.
  await page.goto(productPage)
  await openFontSection(page, "Marketplace drafts")
  await expect(card().getByText("Live", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: /View on Behance/ })).toHaveAttribute(
    "href",
    PROJECT_URL,
  )
  await expect(card().getByText(/Status here is self-reported/)).toBeVisible()
  await expect(card().getByRole("button", { name: "Publish", exact: true })).toHaveCount(0)

  // With no connected channel that can publish, Publish Everywhere is absent
  // rather than disabled, and nothing on the page offers to publish.
  await expect(page.getByRole("region", { name: "Publish everywhere" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^(re)?publish/i })).toHaveCount(0)
})
