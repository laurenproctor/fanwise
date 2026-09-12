import { createClient, type SupabaseClient } from "@supabase/supabase-js"
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
 *
 * Used by journey-01-signup.spec.ts only, which is the one test whose subject
 * is signup. Everything else starts from `newCreator`.
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
 * Signs up through the form and names the provisioned workspace through
 * Settings. Returns the slug.
 *
 * Kept for tests/e2e/security-headers.spec.ts alone, which is held byte for byte
 * as it was: its one signed-in check is about the policy a signed-in render
 * carries, and changing how that session came to exist is not a change worth
 * making to a security test to save a second. New tests use `newCreator`.
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

/**
 * The local stack's service-role client, for setup only.
 *
 * Read from the environment the Playwright config prepared rather than asked
 * for: the config already runs `supabase status` once and exports the answer,
 * and a second call from a test file means several at the same instant, which
 * the CLI does not survive.
 *
 * The local-only check is repeated anyway. These writes are real rows, and the
 * cost of being wrong about which project they land in is the accident the
 * config's own comment describes. There is no fallback to any other project.
 */
export function localAdmin(): SupabaseClient {
  cachedAdmin ??= (() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error("e2e setup needs the local Supabase env the Playwright config exports.")
    }
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
      throw new Error(`Refusing to seed against a non-local Supabase: ${url}`)
    }
    return createClient(url, key, { auth: { persistSession: false } })
  })()
  return cachedAdmin
}

let cachedAdmin: SupabaseClient | null = null

/**
 * A new creator, signed in, in their own provisioned workspace. Returns the slug.
 *
 * For every test that is not about signup. Signing up through the form is
 * journey-01-signup.spec.ts's subject, and repeating it as setup in every other
 * file only repeats that one test's risk everywhere. So the account is created
 * through the local auth admin API, and everything after that is real: the
 * creator signs in through the sign-in form, the root sends them to
 * `/onboarding`, and the workspace is provisioned by the production route under
 * their own session and RLS, exactly as it is after a signup.
 *
 * `workspaceName` is written directly rather than through Settings, which is
 * journey-settings.spec.ts's subject. Every provisioned workspace starts as "My
 * studio", and Journey 9 asserts one workspace's name never appears on
 * another's pages; two workspaces with the same name would pass that without it
 * meaning anything.
 *
 * Each call makes a unique account and workspace, so no test shares state with
 * another and none depends on the order they run in.
 */
export async function newCreator(
  page: Page,
  label: string,
  workspaceName?: string,
): Promise<{ email: string; slug: string }> {
  const email = uniqueEmail(label)
  const { error } = await localAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (error) throw new Error(`could not create the e2e account: ${error.message}`)

  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()

  await page.waitForURL(isWorkspaceHome, { timeout: SETUP_TIMEOUT })
  const slug = new URL(page.url()).pathname.split("/")[1] ?? ""

  if (workspaceName) {
    const { error: renameError } = await localAdmin()
      .from("workspaces")
      .update({ name: workspaceName })
      .eq("slug", slug)
    if (renameError) throw new Error(`could not name the e2e workspace: ${renameError.message}`)
    await page.reload()
    await expect(
      page.getByRole("link", { name: new RegExp(escapeRegExp(workspaceName)) }),
    ).toBeVisible({ timeout: SETUP_TIMEOUT })
  } else {
    // A matching URL is not a rendered page.
    await expect(page.getByRole("link", { name: "Products", exact: true })).toBeVisible({
      timeout: SETUP_TIMEOUT,
    })
  }
  return { email, slug }
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
