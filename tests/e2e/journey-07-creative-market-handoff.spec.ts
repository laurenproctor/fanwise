import { expect, test } from "@playwright/test"
import { listingUrl, localAdmin, newCreator } from "./support"
import {
  clearFontBlockers,
  listingCard,
  openFontSection,
  uploadFontFile,
  uploadSpecimenImage,
  waitForProductPage,
} from "./publish-support"

/**
 * Journey 7, docs/testing.md: a Creative Market submission package generated
 * from a product, handed off in the editor's order, and the listing URL
 * captured.
 *
 * Run against the channel itself rather than a mock, because the channel
 * needs no credential: Connect names a shop and writes a row. What a browser
 * cannot see is Creative Market's own editor; the exit run in
 * docs/channels/creative-market.md is the founder carrying a real product
 * through it. What this proves is Fanwise's side: no Publish is ever offered,
 * the generative AI question blocks until the product answers it, the
 * package and the screenshots are built in the background and arrive under
 * the names the editor expects, the description copies as formatted text,
 * and mark submitted leaves a row that says so, self-reported, with the
 * listing's address.
 */

// One external object is represented once, across every workspace in the
// database, so the product id is fresh per run.
const PRODUCT_ID = String(Date.now())
const LISTING_URL = `https://creativemarket.com/astertype/${PRODUCT_ID}-Aster-Grotesk`

test("a product becomes a Creative Market package and listing by hand, and Fanwise records the creator's word", async ({
  page,
}) => {
  const { slug } = await newCreator(page, "j07", "Aster Type Studio")

  // Connect by naming the shop. No authorization: there is nothing to
  // authorize against, and the card says what the channel cannot do.
  await page.goto(`/${slug}/channels`)
  const channelCard = page.locator("section").filter({ hasText: "Creative Market" })
  await expect(channelCard.getByText("Assisted", { exact: true })).toBeVisible()
  await channelCard.getByRole("button", { name: "Connect", exact: true }).click()
  await channelCard.getByLabel("Creative Market shop").fill("https://creativemarket.com/astertype")
  await channelCard.getByRole("button", { name: "Connect Creative Market" }).click()
  await expect(channelCard.getByText("Connected")).toBeVisible()
  await expect(channelCard.getByText("creativemarket.com/astertype")).toBeVisible()

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Aster Grotesk")
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()
  await waitForProductPage(page, slug, "Aster Grotesk")
  const productPage = `${page.url().split("#")[0]}#drafts`

  await openFontSection(page, "Marketplace drafts")
  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(1)

  const card = () => listingCard(page, "Creative Market", "Mock Storefront")
  // An assisted channel renders no publish affordance at all, not a disabled one.
  await expect(card().getByRole("button", { name: "Publish", exact: true })).toHaveCount(0)

  await uploadSpecimenImage(page, "tests/fixtures/specimen-3000x2000.jpg")
  await uploadFontFile(page, "Aster Grotesk")
  await clearFontBlockers(page)

  // Rebuild now that there is a file to package and an image to render, then
  // open the listing.
  await openFontSection(page, "Marketplace drafts")
  await page.getByRole("button", { name: "Rebuild" }).click()
  await page.getByRole("link", { name: "Edit listing" }).click()
  await page.waitForURL(listingUrl(slug))

  // The generative AI question is the product's to answer, and the channel
  // blocks until it is. The requirement names the product, not the listing.
  await expect(page.getByText(/Answer the generative AI question on the product/)).toBeVisible()

  // The choices the channel's form asks for, suggested from the product.
  await expect(page.getByText("Creative Market choices")).toBeVisible()
  await expect(page.getByRole("radio", { name: /Family/ })).toBeChecked()

  // The handoff, in the editor's order, with the category locked first and
  // the disclosure taken from the product record.
  await expect(page.getByText("Creative Market handoff")).toBeVisible()
  await expect(page.getByText("Category", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Product files", { exact: true })).toBeVisible()
  await expect(page.getByText("Screenshots", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Generative AI disclosure", { exact: true })).toBeVisible()
  await expect(
    page.getByText("Locked first. This sets the license and price structure."),
  ).toBeVisible()

  // A description written with a heading and a numbered list arrives on the
  // handoff in Creative Market's subset, copied as formatted text with the
  // words as the fallback. The handoff reads the saved listing, so save first.
  await page.getByRole("button", { name: "Customize description for this channel" }).click()
  await page
    .getByLabel("Description", { exact: true })
    .fill(
      "## A grotesque for interfaces\n\nDrawn tight for small sizes.\n\n1. Fourteen weights\n2. A license",
    )
  await page.getByRole("button", { name: "Save listing" }).click()
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Saved/ })
      .first(),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole("button", { name: "Copy description" })).toBeVisible()
  await expect(page.getByText(/words\. Copies as formatted text/)).toBeVisible()
  await expect(page.getByText("A grotesque for interfaces", { exact: false }).first()).toBeVisible()

  // The package and the renditions are built in the background and listed
  // once their rows exist: the zip under its buyer-facing name, the
  // screenshots numbered so the editor sorts them as intended.
  await expect(async () => {
    await page.reload()
    await expect(
      page.locator('a[href*="/download?name=aster-grotesk-creative-market.zip"]').first(),
    ).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('a[href*="/download?name=01-"]').first()).toBeVisible({
      timeout: 5_000,
    })
  }).toPass({ timeout: 90_000 })
  await expect(page.getByText(/Contains \d+ files?: .*README\.txt/)).toBeVisible()

  // Answer the disclosure on the product, and the block lifts.
  await page.goto(productPage)
  await openFontSection(page, "Licensing & pricing")
  await page.getByLabel("Generative AI").selectOption("no")
  // A choice saves at once; wait for the row rather than for a status line.
  const admin = localAdmin()
  const [, , productSlug] = new URL(productPage).pathname.split("/")
  await expect
    .poll(
      async () => {
        const { data: workspace } = await admin
          .from("workspaces")
          .select("id")
          .eq("slug", slug)
          .single()
        const { data: product } = await admin
          .from("products")
          .select("made_with_generative_ai")
          .eq("workspace_id", workspace!.id)
          .eq("slug", productSlug!)
          .single()
        return product?.made_with_generative_ai
      },
      { timeout: 15_000 },
    )
    .toBe(false)
  await openFontSection(page, "Marketplace drafts")
  await page.getByRole("link", { name: "Edit listing" }).click()
  await page.waitForURL(listingUrl(slug))
  await expect(page.getByText(/Answer the generative AI question on the product/)).toHaveCount(0)
  await expect(page.getByText("Answer: No", { exact: true })).toBeVisible()
  await expect(page.getByText("Fanwise sends nothing to Creative Market.")).toBeVisible()

  // Mark submitted, with the address captured.
  await page
    .getByLabel("Listing URL")
    .fill(`creativemarket.com/astertype/${PRODUCT_ID}-Aster-Grotesk`)
  await page.getByRole("button", { name: "Mark submitted" }).click()
  await expect(page.getByRole("link", { name: LISTING_URL })).toBeVisible()

  // The card says what the creator said, and says it is their word.
  await page.goto(productPage)
  await openFontSection(page, "Marketplace drafts")
  await expect(card().getByText("Live", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: /View on Creative Market/ })).toHaveAttribute(
    "href",
    LISTING_URL,
  )
  await expect(card().getByText(/Status here is self-reported/)).toBeVisible()
  await expect(card().getByRole("button", { name: "Publish", exact: true })).toHaveCount(0)

  // With no connected channel that can publish, Publish Everywhere is absent
  // rather than disabled, and nothing on the page offers to publish.
  await expect(page.getByRole("region", { name: "Publish everywhere" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^(re)?publish/i })).toHaveCount(0)
})
