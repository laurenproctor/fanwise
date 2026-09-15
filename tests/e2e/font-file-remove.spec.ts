import { expect, test } from "@playwright/test"
import { PASSWORD, newCreator } from "./support"
import { openFontSection, uploadFontFile, waitForProductPage } from "./publish-support"

/**
 * Removing a duplicate font file, including when the removal cannot reach the
 * action at all.
 *
 * A session that expired while the workspace sat open answers the action with
 * a redirect to sign in. The client cannot read that, the action rejects, and
 * the dialog used to stay on a disabled "Removing…" with nothing to say why.
 */
test("a duplicate font file is removed, and a removal that fails says so", async ({ page }) => {
  const { email, slug } = await newCreator(page, "rmf")
  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Blimp Grotesk")
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()
  await waitForProductPage(page, slug, "Blimp Grotesk")
  const productPage = `${page.url().split("#")[0]}#files`

  await uploadFontFile(page, "Blimp Grotesk")
  const fileList = page.locator("#font-file-list")
  const filename = (await fileList.locator("li p").first().textContent())!

  // The same file again, on purpose past the duplicate check.
  await page
    .locator('input[type="file"][accept*=".otf"][multiple]')
    .setInputFiles(`test-results/fonts/${filename}`)
  await page.getByRole("button", { name: "Upload anyway" }).click()
  await expect(fileList.getByText(`Duplicate of ${filename}`)).toBeVisible({ timeout: 60_000 })

  const removeDuplicate = async () => {
    await page
      .getByRole("button", { name: `Remove ${filename}` })
      .last()
      .click()
    await page.getByRole("dialog").getByRole("button", { name: "Remove file" }).click()
  }

  await page.context().clearCookies()
  await removeDuplicate()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("alert")).toHaveText(/could not be removed/)
  await expect(dialog.getByRole("button", { name: "Remove file" })).toBeEnabled()

  // Signed in again, the same removal goes through.
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL((url) => url.pathname !== "/sign-in")
  await page.goto(productPage)
  await openFontSection(page, "Font files")

  await removeDuplicate()
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(fileList.getByRole("button", { name: `Remove ${filename}` })).toHaveCount(1)
  await expect(fileList.getByText(/Duplicate of/)).toHaveCount(0)
})
