import { expect, test } from "@playwright/test"
import { newCreator, productUrl, signOut } from "./support"

/** The root not-found page's headline. Every denial below must show exactly this. */
const NOT_FOUND_HEADLINE = "This listing didn’t make it to the marketplace."

/**
 * Journey 9. Never skipped, never quarantined, never marked flaky.
 * See docs/testing.md: if this fails the product is broken in the way that
 * matters most.
 *
 * The database-level proof lives in tests/db/tenancy.test.ts and the other
 * tests/db/*-tenancy.test.ts files. This is the proof through the browser,
 * which is where a real attacker would be standing.
 */
test("workspace A cannot reach workspace B by URL", async ({ page, browser }) => {
  const b = await newCreator(page, "j9b", "Bravo Studio")
  await expect(page.getByRole("link", { name: /Bravo Studio/ })).toBeVisible()
  await signOut(page)

  // A stranger with no session at all is sent to sign in, and sees nothing of
  // Bob's on the way. Its own context, because a Server Component reads cookies
  // at render and clearing them in this one is not the same as never having had
  // any.
  const anonymous = await browser.newContext()
  const stranger = await anonymous.newPage()
  await stranger.goto(`/${b.slug}`)
  await expect(stranger).toHaveURL(/\/sign-in$/)
  await expect(stranger.getByText("Bravo Studio")).toHaveCount(0)
  await anonymous.close()

  await newCreator(page, "j9a", "Alpha Studio")

  // Alice, signed in, walks straight up to Bob's address.
  const response = await page.goto(`/${b.slug}`)

  expect(response?.status()).toBe(404)
  await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND_HEADLINE })).toBeVisible()

  // Nothing of Bob's leaks: not the workspace name in the header chrome, not
  // his slug, not a member row.
  await expect(page.getByText("Bravo Studio")).toHaveCount(0)
  await expect(page.getByText(b.slug)).toHaveCount(0)
  await expect(page.getByRole("table")).toHaveCount(0)

  // A workspace that never existed answers with the same status and the same
  // words. A different answer would confirm to a prober which slugs are real.
  const never = await page.goto(`/definitely-not-a-real-workspace-${Date.now().toString(36)}`)
  expect(never?.status()).toBe(404)
  await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND_HEADLINE })).toBeVisible()
})

test("workspace A cannot reach workspace B's product by URL", async ({ page }) => {
  const b = await newCreator(page, "j9pb", "Bravo Products")
  await page.goto(`/${b.slug}/new`)
  await page.getByLabel("Product name").fill("Bravo Secret Font")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(b.slug))
  const productPath = new URL(page.url()).pathname
  await signOut(page)

  await newCreator(page, "j9pa", "Alpha Products")

  const response = await page.goto(productPath)

  expect(response?.status()).toBe(404)
  await expect(page.getByText("Bravo Secret Font")).toHaveCount(0)
})
