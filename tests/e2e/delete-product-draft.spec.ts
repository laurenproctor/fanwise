import { expect, test } from "@playwright/test"
import { localAdmin, newCreator, productUrl } from "./support"

/**
 * Delete draft: a creator permanently deletes a draft with an uploaded file and
 * lands back on a catalog that still has their other product in it.
 *
 * What only a browser can answer lives here: the dialog's focus returning to
 * the button that opened it after Escape and after Cancel, typing the word
 * enabling the final button, and the redirect. Which products may be deleted
 * is tests/db/product-draft-deletion.test.ts; what the action does with each
 * answer is tests/unit/delete-product-draft.test.ts; the markup is
 * tests/unit/delete-product-draft-ui.test.ts.
 */
test("a creator deletes a draft with an uploaded file and returns to the catalog", async ({
  page,
}) => {
  const { slug } = await newCreator(page, "deldraft", "Deletion Studio")

  // The product that stays, so the catalog the creator returns to is populated.
  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Kept Grotesk")
  // Templates: this is the generic page's Files section and Danger zone.
  await page.getByLabel("Product type").selectOption("template")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Doomed Grotesk")
  await page.getByLabel("Product type").selectOption("template")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))
  await expect(page.getByRole("heading", { level: 1, name: "Doomed Grotesk" })).toBeVisible()
  const productSlug = new URL(page.url()).pathname.split("/")[2]!

  // A real upload, through the Files section. Reloading before the browser's
  // PUT lands would abort it and leave the row pending forever (docs/testing.md),
  // so the upload is allowed to finish before anything reloads.
  await page.getByLabel("Add a file").setInputFiles("tests/fixtures/small-800x600.png")
  await expect(page.getByText("small-800x600.png").first()).toBeVisible()
  await expect(page.getByText("Uploading…")).toHaveCount(0)

  const admin = localAdmin()
  const { data: product } = await admin
    .from("products")
    .select("id, workspace_id")
    .eq("slug", productSlug)
    .single()
  expect(product).not.toBeNull()
  const { data: assets } = await admin
    .from("product_assets")
    .select("storage_path")
    .eq("product_id", product!.id)
  expect(assets?.length ?? 0).toBeGreaterThan(0)

  /*
    While the upload is still pending the database refuses deletion and the
    page offers no button, only the reason. The in-process queue finalizes the
    file within moments; reload until the page is rendered from a state where
    the product may go.
  */
  const trigger = page.getByRole("button", { name: "Delete draft", exact: true })
  await expect(async () => {
    await page.reload()
    await expect(trigger).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 30_000 })

  const dialog = page.getByRole("dialog", { name: "Delete “Doomed Grotesk”?" })
  const confirm = dialog.getByRole("button", { name: "Delete draft" })
  const field = dialog.getByLabel("Type DELETE to confirm")

  // Escape closes it, and focus goes back to the button that opened it.
  await trigger.click()
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleDescription(/Nothing has been published/)
  await expect(confirm).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  // So does Cancel.
  await trigger.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  // Only the exact word enables the final button.
  await trigger.click()
  await field.fill("delete")
  await expect(confirm).toBeDisabled()
  await field.fill("DELETE")
  await expect(confirm).toBeEnabled()
  await confirm.click()

  // Back on the catalog, which still has the other product and not this one.
  await page.waitForURL(new RegExp(`/${slug}$`))
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Kept Grotesk", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Doomed Grotesk", exact: true })).toHaveCount(0)

  // The row, its asset rows, and the stored bytes are gone.
  const { count: products } = await admin
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("id", product!.id)
  expect(products).toBe(0)
  const { count: remainingAssets } = await admin
    .from("product_assets")
    .select("*", { count: "exact", head: true })
    .eq("product_id", product!.id)
  expect(remainingAssets).toBe(0)

  await expect
    .poll(async () => {
      const { data: objects } = await admin.storage
        .from("product-assets")
        .list(`${product!.workspace_id}/${product!.id}`)
      return objects?.length ?? 0
    })
    .toBe(0)
})
