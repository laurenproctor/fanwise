import type { Page } from "@playwright/test"
import { RESERVED_PRODUCT_SLUGS, RESERVED_WORKSPACE_SLUGS } from "@/lib/slug"

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

  // A workspace is now a single path segment, which /onboarding also is. A
  // pattern loose enough to match /<slug> matches the page this test is already
  // standing on, resolves instantly, and reads the slug out of the form it just
  // submitted. So: exactly one segment, and not a reserved one.
  await page.waitForURL((url) => {
    const [, first, ...rest] = url.pathname.split("/")
    return rest.length === 0 && !!first && !RESERVED_WORKSPACE_SLUGS.has(first)
  })
  const slug = new URL(page.url()).pathname.split("/")[1] ?? ""
  return { email, slug }
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.waitForURL(/\/sign-in$/)
}

/**
 * A product URL, and nothing else sitting at the same depth.
 *
 * With `products` gone from the path, `/<workspace>/<anything>` is a product
 * *and* is `/new`, `/channels` and `/settings`. Waiting on a naive pattern after
 * submitting the new-product form resolves instantly against `/new`, the page
 * the test is already on, and the assertions that follow run against the form.
 * It passes most of the time, which is worse than failing.
 *
 * The exclusions are read from the reserved list rather than typed out here, so
 * a new workspace-level route cannot leave this pattern quietly wrong.
 */
export function productUrl(workspaceSlug: string): RegExp {
  const reserved = [...RESERVED_PRODUCT_SLUGS].join("$|")
  return new RegExp(`/${workspaceSlug}/(?!${reserved}$)[a-z0-9-]+$`)
}

/** A listing URL: one product, one connection. */
export function listingUrl(workspaceSlug: string): RegExp {
  return new RegExp(`/${workspaceSlug}/[a-z0-9-]+/channels/[^/]+$`)
}
