import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { PASSWORD, renameWorkspace, signOut, signUp } from "./support"

/**
 * Journey 1, the first half: signup and workspace. Signup provisions a personal
 * workspace on arrival; nobody is asked to name one before seeing the product.
 * The database proof that it is exactly one, under replay and under a race, is
 * tests/db/workspace-provisioning.test.ts.
 */
test("a new creator signs up and lands in a provisioned workspace", async ({ page }) => {
  const { slug } = await signUp(page, "j1")

  // Email signup supplies no name, so the workspace is the fallback, suffixed.
  expect(slug).toMatch(/^my-studio-[a-z0-9]{4}$/)
  await expect(page).toHaveURL(new RegExp(`/${slug}$`))
  await expect(page.getByRole("link", { name: /My studio/ })).toBeVisible()

  // An empty catalog is the first-run screen, and Products is the current section.
  await expect(
    page.getByRole("heading", { level: 1, name: "Your first product starts here." }),
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "Products", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  )

  // Membership moved to settings when the catalog took the root.
  await page.goto(routes.settings(slug))
  await expect(page.getByRole("heading", { level: 1, name: "My studio" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "owner" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  )

  // Renamed in Settings. The header follows the name; the address does not.
  await renameWorkspace(page, slug, "Northbound Type")
  await expect(page).toHaveURL(new RegExp(`/${slug}$`))
  await expect(page.getByRole("link", { name: /My studio/ })).toHaveCount(0)
})

test("the root, a replayed onboarding and a new session all resolve to the one workspace", async ({
  page,
}) => {
  const { email, slug } = await signUp(page, "j1b")

  await page.goto("/")
  await expect(page).toHaveURL(new RegExp(`/${slug}$`))

  // Provisioning is a GET, and GETs get replayed. A replay lands on the
  // workspace that exists rather than making another.
  for (let replay = 0; replay < 2; replay += 1) {
    await page.goto("/onboarding")
    await expect(page).toHaveURL(new RegExp(`/${slug}$`))
  }

  await signOut(page)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(new RegExp(`/${slug}$`))
  await expect(
    page.getByRole("heading", { level: 1, name: "Your first product starts here." }),
  ).toBeVisible()
})
