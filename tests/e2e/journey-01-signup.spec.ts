import { expect, test } from "@playwright/test"
import { signUpAndCreateWorkspace } from "./support"

/**
 * Journey 1, the part A1 can prove: signup and workspace. The product half
 * arrives with A2.
 */
test("a new creator signs up and lands in a slug-scoped workspace", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1", "Northbound Type")

  expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`))
  await expect(page.getByRole("heading", { name: "Northbound Type" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "owner" })).toBeVisible()
})

test("returning to the root resolves to the existing workspace", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1b", "Second Look")

  await page.goto("/")
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`))
})
