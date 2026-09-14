import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page } from "@playwright/test"
import { buildSfnt } from "../unit/font-fixtures"
import { escapeRegExp, listingUrl, localAdmin, productUrl } from "./support"

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

/**
 * One channel's listing card on the product page, and nothing around it.
 *
 * Filtered on the other channel's name being absent and on the card's own Edit
 * listing link being present, because the Publish Everywhere region is also a
 * section and names skipped channels in its text.
 */
export function listingCard(page: Page, channelName: string, otherChannelName: string) {
  return page
    .locator("section")
    .filter({ hasText: channelName })
    .filter({ hasNotText: otherChannelName })
    .filter({ has: page.getByRole("link", { name: "Edit listing" }) })
}

/**
 * Writes a listing a channel will accept. `card` picks which one; without it,
 * the first card on the page, which is the first channel connected.
 */
export async function writeListing(page: Page, slug: string, card?: Locator) {
  await (card ?? page).getByRole("link", { name: "Edit listing" }).first().click()
  await page.waitForURL(listingUrl(slug))

  // Each field is the product's until customized for this channel.
  await page.getByRole("button", { name: "Customize title for this channel" }).click()
  await page.getByLabel("Title", { exact: true }).fill("Aster Grotesk Display")
  await page.getByRole("button", { name: "Customize description for this channel" }).click()
  await page
    .getByLabel("Description", { exact: true })
    .fill("A grotesque in nine weights, drawn for long text and set tight at display sizes.")
  await page.getByRole("button", { name: "Customize price for this channel" }).click()
  await page.getByLabel("Price", { exact: true }).fill("48")
  await page.getByRole("button", { name: "Save listing" }).click()
  await expect(page.getByRole("status")).toHaveText("Saved")
}

/*
 * The font workspace.
 *
 * A font product does not render the generic page: its channel cards and
 * Publish Everywhere live in the Marketplace drafts section, its buyer files in
 * Font files, its pictures in Specimen images. The helpers below drive those,
 * so a publishing journey about a font goes through the screen a font creator
 * actually uses.
 */

/** Opens one section of the font workspace by its name in the section list. */
export async function openFontSection(page: Page, label: string) {
  await page
    .getByRole("navigation", { name: "Listing sections" })
    .getByRole("button", { name: new RegExp(`^${escapeRegExp(label)} \\(`) })
    .click()
  await expect(page.locator("#font-section-heading")).toHaveText(label)
}

/**
 * A small font file the parser reads, written to disk once per call.
 *
 * Built rather than committed, the same way tests/unit/font-fixtures.ts builds
 * them for the parser's own tests.
 */
function fontFixture(name: string): string {
  const dir = join(process.cwd(), "test-results", "fonts")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}-${randomUUID().slice(0, 8)}.otf`)
  writeFileSync(
    path,
    buildSfnt({
      family: name,
      style: "Regular",
      postscriptName: `${name.replace(/\s+/g, "")}-Regular`,
      version: "Version 1.000",
      weight: 400,
      glyphCount: 240,
      ranges: [[0x20, 0x7e]],
      cff: true,
    }),
  )
  return path
}

/** Uploads one buyer font file and waits until the finalize job has read it. */
export async function uploadFontFile(page: Page, family: string) {
  await openFontSection(page, "Font files")
  await page
    .locator('input[type="file"][accept*=".otf"][multiple]')
    .setInputFiles(fontFixture(family))
  // The section reads complete only once a ready file has been parsed as a font.
  await expect(
    page
      .getByRole("navigation", { name: "Listing sections" })
      .getByRole("button", { name: /^Font files \(complete\)/ }),
  ).toBeVisible({ timeout: 60_000 })
}

/** Uploads a specimen image and waits for its tile. */
export async function uploadSpecimenImage(page: Page, fixture: string) {
  await openFontSection(page, "Specimen images")
  const filename = fixture.split("/").pop()!
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(fixture)
  await expect(page.getByRole("img", { name: filename }).first()).toBeVisible({ timeout: 60_000 })
}

/**
 * Answers the font's own blockers — a price, a licence and its terms — so only
 * the channels' rules stand between the product and a channel.
 */
export async function clearFontBlockers(page: Page) {
  await openFontSection(page, "Licensing & pricing")
  await page.getByLabel("Base price").fill("48")
  await page.getByRole("switch", { name: /Desktop/ }).click()
  await page.getByLabel("License summary").fill("Desktop use for one studio.")

  // Autosave is debounced, and the server decides from what is stored, so wait
  // for the row rather than for a status line that may be left from a save
  // before this one.
  const [, workspaceSlug, productSlug] = new URL(page.url()).pathname.split("/")
  const admin = localAdmin()
  await expect
    .poll(
      async () => {
        const { data: workspace } = await admin
          .from("workspaces")
          .select("id")
          .eq("slug", workspaceSlug!)
          .single()
        const { data: product } = await admin
          .from("products")
          .select("base_price, license_summary, metadata")
          .eq("workspace_id", workspace!.id)
          .eq("slug", productSlug!)
          .single()
        const licenses = (product?.metadata as { licenses?: unknown[] } | null)?.licenses ?? []
        return (
          Number(product?.base_price) === 48 && !!product?.license_summary && licenses.length > 0
        )
      },
      { timeout: 20_000 },
    )
    .toBe(true)
}
