import { expect, test } from "@playwright/test"
import { signOut, signUpAndCreateWorkspace, uniqueEmail } from "./support"

/**
 * The browser half of recovery. The token round trip is proven against the auth
 * server in `tests/db/password-recovery.test.ts`; what matters here is what a
 * person sees, and in particular that the page says the same thing whether or
 * not the address has an account.
 *
 * Locators are `p[role=...]` rather than `getByRole`. Next renders its own
 * route announcer as an empty `<div role="alert">` on every page, so a bare
 * role lookup is ambiguous and resolves to the announcer's empty string.
 */

const CONFIRMATION = /a reset link is on its way/i
const ERROR = 'p[role="alert"]'
const NOTICE = 'p[role="status"]'

test("a signed-out creator can reach the reset form from sign in", async ({ page }) => {
  await page.goto("/sign-in")
  await page.getByRole("link", { name: "Forgot your password?" }).click()

  await page.waitForURL(/\/forgot-password$/)
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible()
})

test("the answer is identical for a registered and an unregistered address", async ({ page }) => {
  const { email } = await signUpAndCreateWorkspace(page, "recovery", "Recovery Studio")
  await signOut(page)

  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Send reset link" }).click()
  const registered = await page.locator(NOTICE).textContent()
  expect(registered).toMatch(CONFIRMATION)

  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill(uniqueEmail("nobody"))
  await page.getByRole("button", { name: "Send reset link" }).click()
  const unregistered = await page.locator(NOTICE).textContent()

  // Any difference here — wording, timing, an error the registered address does
  // not produce — is an oracle for whether an address has an account.
  expect(unregistered).toBe(registered)
})

test("a malformed address is rejected without claiming anything was sent", async ({ page }) => {
  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill("not-an-address")

  // `type="email"` would have the browser refuse the submit before the action
  // ever runs, and the server is what is under test here: a client-side guard is
  // not validation, it is a convenience. Constraint checking is turned off on
  // the form rather than by editing the input, because React restores an
  // attribute it owns on the next render and the submit then silently does
  // nothing.
  await page.locator("form").evaluate((form) => {
    ;(form as HTMLFormElement).noValidate = true
  })
  await page.getByRole("button", { name: "Send reset link" }).click()

  await expect(page.locator(ERROR)).toHaveText(/valid email address/i)
  await expect(page.locator(NOTICE)).toHaveCount(0)
})

test("a spent or forged link explains itself instead of failing silently", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=not-a-real-token&type=recovery")

  await page.waitForURL(/\/forgot-password/)
  await expect(page.locator(ERROR)).toHaveText(/expired or was already used/i)
})

test("the reset page states the link is gone rather than bouncing to sign in", async ({ page }) => {
  // Without /reset-password in the proxy's public paths this lands on /sign-in,
  // which tells a person whose link expired nothing about why.
  await page.goto("/reset-password")

  await expect(page).toHaveURL(/\/reset-password$/)
  await expect(page.getByRole("heading", { name: "That link is no longer valid" })).toBeVisible()
})
