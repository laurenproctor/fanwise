import { expect, type Page } from "@playwright/test"
import { routes } from "@/lib/routes"
import { RESERVED_PRODUCT_SLUGS, RESERVED_WORKSPACE_SLUGS } from "@/lib/slug"

let counter = 0

export function uniqueEmail(label: string): string {
  counter += 1
  return `e2e-${label}-${Date.now()}-${counter}@fanwise.test`
}

export const PASSWORD = "correct-horse-battery-staple"

/**
 * How long setup waits for a server action to land.
 *
 * The onboarding form this helper used to submit was followed by waitForURL,
 * which is bounded only by the test's own timeout. The rename that replaced it
 * was first followed by a default five-second expect, which is stricter than
 * that, and under a fully parallel run it failed with the save still in flight.
 * Setup is not what these tests assert, so it gets the old tolerance back; the
 * assertions in the tests keep theirs.
 */
const SETUP_TIMEOUT = 20_000

/**
 * A workspace home, and nothing else a signup passes through on the way.
 *
 * Signup redirects through `/` and `/onboarding`, and a workspace is a single
 * path segment, which `/onboarding` also is. A pattern loose enough to match
 * /<slug> matches the redirect in flight and resolves early. So: exactly one
 * segment, and not a reserved one.
 */
function isWorkspaceHome(url: URL): boolean {
  const [, first, ...rest] = url.pathname.split("/")
  return rest.length === 0 && !!first && !RESERVED_WORKSPACE_SLUGS.has(first)
}

/**
 * Signs up through the real UI and lands in the workspace provisioned on
 * arrival, still carrying the name it was given. Returns the slug, which is the
 * address every workspace-scoped route hangs off.
 */
export async function signUp(page: Page, label: string): Promise<{ email: string; slug: string }> {
  const email = uniqueEmail(label)

  await page.goto("/sign-up")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Create account" }).click()

  await page.waitForURL(isWorkspaceHome)
  const slug = new URL(page.url()).pathname.split("/")[1] ?? ""

  // A matching URL is not a rendered page.
  await expect(page.getByRole("link", { name: "Products", exact: true })).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })
  return { email, slug }
}

/**
 * Renames a workspace through Settings and returns to its catalog.
 *
 * The settings h1 is "Studio settings" rather than the workspace name, so the
 * save is confirmed by the section's own status line. That is the assertion the
 * page actually makes about a save having landed.
 */
export async function renameWorkspace(page: Page, slug: string, name: string): Promise<void> {
  await page.goto(routes.settings(slug))
  await page.getByLabel("Workspace name").fill(name)
  await page.getByRole("button", { name: "Save studio details" }).click()
  await expect(page.getByText("Studio details saved.")).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })

  await page.goto(routes.workspace(slug))
  await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(name)) })).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })
}

/**
 * Signs up and names the provisioned workspace. Returns the slug.
 *
 * Every provisioned workspace starts as "My studio", which is why this renames
 * it. Journey 9 asserts that one workspace's name never appears on another's
 * pages, and two workspaces both called "My studio" would pass that assertion
 * without it meaning anything.
 */
export async function signUpAndCreateWorkspace(
  page: Page,
  label: string,
  workspaceName: string,
): Promise<{ email: string; slug: string }> {
  const account = await signUp(page, label)
  await renameWorkspace(page, account.slug, workspaceName)
  return account
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.waitForURL(/\/sign-in$/)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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
