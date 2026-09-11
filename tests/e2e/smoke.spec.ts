import { expect, test } from "@playwright/test"

test("the root serves the marketing site to an anonymous visitor", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("heading", { name: /Create once\./ })).toBeVisible()
})

test("an anonymous visitor is still turned away from the app", async ({ page }) => {
  // The root became public when the landing page moved onto it. Nothing else
  // did, and this is the assertion that says so: `/` is a marketing page, not a
  // hole in the proxy.
  await page.goto("/onboarding")
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
})

test("the health endpoint answers", async ({ request }) => {
  const response = await request.get("/api/health")
  expect(response.ok()).toBeTruthy()
  expect(await response.json()).toMatchObject({ ok: true })
})
