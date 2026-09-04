import type { Page } from "@playwright/test"

let counter = 0

export function uniqueEmail(label: string): string {
  counter += 1
  return `e2e-${label}-${Date.now()}-${counter}@fanwise.test`
}

export const PASSWORD = "correct-horse-battery-staple"

/**
 * Signs up through the real UI and lands on the new workspace. Returns the slug,
 * which is the address every workspace-scoped route hangs off.
 */
export async function signUpAndCreateWorkspace(
  page: Page,
  label: string,
  workspaceName: string,
): Promise<{ email: string; slug: string }> {
  const email = uniqueEmail(label)

  await page.goto("/sign-up")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Create account" }).click()

  await page.waitForURL(/\/onboarding$/)
  await page.getByLabel("Workspace name").fill(workspaceName)
  await page.getByRole("button", { name: "Create workspace" }).click()

  await page.waitForURL(/\/w\/[^/]+$/)
  const slug = new URL(page.url()).pathname.split("/")[2] ?? ""
  return { email, slug }
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.waitForURL(/\/sign-in$/)
}
