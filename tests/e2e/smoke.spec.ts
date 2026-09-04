import { expect, test } from "@playwright/test"

test("the app boots and redirects an anonymous visitor to sign in", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
})

test("the health endpoint answers", async ({ request }) => {
  const response = await request.get("/api/health")
  expect(response.ok()).toBeTruthy()
  expect(await response.json()).toMatchObject({ ok: true })
})
