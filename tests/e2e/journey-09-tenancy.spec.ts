import { expect, test } from "@playwright/test"
import { signUpAndCreateWorkspace, signOut } from "./support"

/**
 * Journey 9. Never skipped, never quarantined, never marked flaky.
 * See docs/testing.md: if this fails the product is broken in the way that
 * matters most.
 *
 * The database-level proof lives in tests/db/tenancy.test.ts. This is the proof
 * through the browser, which is where a real attacker would be standing.
 */
test("workspace A cannot reach workspace B by URL", async ({ page }) => {
  const b = await signUpAndCreateWorkspace(page, "j9b", "Bravo Studio")
  await expect(page.getByRole("heading", { name: "Bravo Studio" })).toBeVisible()
  await signOut(page)

  await signUpAndCreateWorkspace(page, "j9a", "Alpha Studio")

  // Alice, signed in, walks straight up to Bob's address.
  const response = await page.goto(`/w/${b.slug}`)

  expect(response?.status()).toBe(404)
  await expect(page.getByText("This page does not exist")).toBeVisible()

  // Nothing of Bob's leaks: not the workspace name in the header chrome, not
  // his slug, not a member row.
  await expect(page.getByText("Bravo Studio")).toHaveCount(0)
  await expect(page.getByText(b.slug)).toHaveCount(0)
  await expect(page.getByRole("table")).toHaveCount(0)
})

test("a workspace that never existed is indistinguishable from one that is not yours", async ({
  page,
}) => {
  await signUpAndCreateWorkspace(page, "j9probe", "Delta Studio")

  const response = await page.goto("/w/definitely-not-a-real-workspace")

  // Same status and same words as the case above. A different answer here would
  // confirm to a prober which slugs are real.
  expect(response?.status()).toBe(404)
  await expect(page.getByText("This page does not exist")).toBeVisible()
})

test("workspace A cannot reach workspace B's product by URL", async ({ page }) => {
  const b = await signUpAndCreateWorkspace(page, "j9pb", "Bravo Products")
  await page.goto(`/w/${b.slug}/products/new`)
  await page.getByLabel("Product name").fill("Bravo Secret Font")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(new RegExp(`/w/${b.slug}/products/[^/]+$`))
  const productPath = new URL(page.url()).pathname
  await signOut(page)

  await signUpAndCreateWorkspace(page, "j9pa", "Alpha Products")

  const response = await page.goto(productPath)

  expect(response?.status()).toBe(404)
  await expect(page.getByText("Bravo Secret Font")).toHaveCount(0)
})

test("an anonymous visitor cannot reach a workspace by URL", async ({ page }) => {
  const b = await signUpAndCreateWorkspace(page, "j9anon", "Charlie Studio")
  await signOut(page)

  await page.goto(`/w/${b.slug}`)

  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByText("Charlie Studio")).toHaveCount(0)
})
