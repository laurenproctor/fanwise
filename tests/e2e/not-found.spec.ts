import { expect, test } from "@playwright/test"
import { newCreator } from "./support"

/**
 * The root not-found page, reached the way a stranger reaches it.
 *
 * Not every unknown address gets here when signed out, and that is on purpose.
 * One or two segments match `app/[slug]` or `app/[slug]/[productSlug]`, which
 * could be a workspace, so a stranger is sent to sign in instead: answering 404
 * there would tell a prober which slugs are real. Three segments under a
 * marketing page match no route at all, which is a genuinely unknown URL with
 * no session involved. The signed-in case, an unknown workspace, is journey 9.
 */

const UNKNOWN = "/about/this-page/was-never-here"

const HEADLINE = "This listing didn’t make it to the marketplace."

test("an unknown URL answers 404 with the not-found page", async ({ page }) => {
  const response = await page.goto(UNKNOWN)

  expect(response?.status()).toBe(404)
  await expect(page).toHaveTitle("Page not found · Fanwise")
  await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible()
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)

  const main = page.getByRole("main")
  await expect(main.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute(
    "href",
    "/sign-in",
  )
  await expect(main.getByRole("link", { name: "Browse products" })).toHaveAttribute("href", "/")
  await expect(main.getByRole("link", { name: "Return to Fanwise" })).toHaveAttribute("href", "/")

  // The shared nav and footer, and no workspace controls.
  await expect(page.locator("nav.fw-nav")).toBeVisible()
  await expect(page.locator("footer.fw-footer")).toBeVisible()
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0)

  // No console assertion here. A path that matches no route is served the
  // build-time HTML under the nonce policy, so its hydration scripts are refused
  // and the page stays static text with working links. That is a recorded
  // consequence of ADR 0007, and the signed-in test below is where the page
  // hydrates and the console is checked.
})

test("a signed-in creator on an unknown workspace gets the same page, hydrated and clean", async ({
  page,
}) => {
  // What would mean this page is broken: an exception, a refused script, a
  // hydration mismatch. Not every console error, because the analytics beacon
  // in the root layout logs one on any local build and is not this page's.
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    const text = message.text()
    if (message.type() === "error" && /Content Security Policy|hydrat|React error/i.test(text)) {
      errors.push(text)
    }
  })

  await newCreator(page, "nf", "Not Found Studio")
  errors.length = 0

  const response = await page.goto("/no-such-workspace-here")
  expect(response?.status()).toBe(404)
  await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible()
  await expect(page.getByText("Not Found Studio")).toHaveCount(0)

  // The theme toggle only answers once the page has hydrated.
  const toggle = page.getByRole("button", { name: /Switch to (dark|light) mode/ })
  const before = await page.evaluate(() => document.documentElement.dataset.theme)
  await toggle.click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .not.toBe(before)

  expect(errors).toEqual([])

  // Go to dashboard lands a signed-in creator in their workspace.
  await page.getByRole("main").getByRole("link", { name: "Go to dashboard" }).click()
  await expect(page).not.toHaveURL(/\/sign-in$/)
  await expect(page.getByRole("link", { name: /Not Found Studio/ })).toBeVisible()
})

test("go to dashboard asks a signed-out visitor to sign in", async ({ page }) => {
  await page.goto(UNKNOWN)
  await page.getByRole("main").getByRole("link", { name: "Go to dashboard" }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
})

for (const width of [320, 390, 768, 1280]) {
  test(`does not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(UNKNOWN)
    await expect(page.getByTestId("broken-route")).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
}
