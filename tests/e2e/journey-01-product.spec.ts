import { expect, test } from "@playwright/test"
import { signUpAndCreateWorkspace } from "./support"

/**
 * Journey 1, now complete: signup, workspace, product. The A1 half proved the
 * first two; A2 adds the third.
 */
test("a creator signs up, gets a workspace, and creates a product", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1p", "Northbound Type")

  await page.getByRole("link", { name: "Products" }).click()
  await page.waitForURL(new RegExp(`/w/${slug}/products$`))

  // The empty state says something useful rather than showing a bare table.
  await expect(page.getByText("Nothing here yet")).toBeVisible()

  await page.getByRole("link", { name: "Create your first product" }).click()
  await page.getByLabel("Product name").fill("Aster Grotesk")
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()

  await page.waitForURL(new RegExp(`/w/${slug}/products/[^/]+$`))
  await expect(page.getByRole("heading", { name: "Aster Grotesk" })).toBeVisible()

  // The product is addressable under its own slug, inside the workspace slug.
  const path = new URL(page.url()).pathname
  expect(path).toMatch(new RegExp(`^/w/${slug}/products/[a-z0-9-]+$`))

  // And it appears in the catalog.
  await page.goto(`/w/${slug}/products`)
  await expect(page.getByRole("link", { name: "Aster Grotesk" })).toBeVisible()
})

test("the canonical record saves and survives a reload", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1e", "Edit Studio")

  await page.goto(`/w/${slug}/products/new`)
  await page.getByLabel("Product name").fill("Editable Product")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(new RegExp(`/w/${slug}/products/[^/]+$`))

  await page.getByLabel("Canonical title").fill("Editable Product Family")
  await page.getByLabel("Brand name").fill("Northbound")
  await page.getByRole("button", { name: "Save changes" }).click()

  // Wait for the save to be confirmed. Reloading straight after the click races
  // the server action and tells you nothing about whether it persisted.
  await expect(page.getByRole("status")).toHaveText("Saved")

  await page.reload()
  await expect(page.getByLabel("Canonical title")).toHaveValue("Editable Product Family")
  await expect(page.getByLabel("Brand name")).toHaveValue("Northbound")
})
