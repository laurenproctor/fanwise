import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { PASSWORD, renameWorkspace, signOut, signUp } from "./support"

/**
 * Journey 1, the first half: signup and workspace. Signup provisions a personal
 * workspace on arrival; nobody is asked to name one before seeing the product.
 * The database proof that it is exactly one, under replay and under a race, is
 * tests/db/workspace-provisioning.test.ts.
 *
 * This is the suite's one signup through the form. Every other file starts from
 * `newCreator` in support.ts, which signs a fresh account in rather than
 * repeating this journey as setup.
 */
test("a new creator signs up and lands in a provisioned workspace", async ({ page }) => {
  const { email, slug } = await signUp(page, "j1")

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

  // The root, and a replayed onboarding, resolve to the one workspace.
  // Provisioning is a GET, and GETs get replayed. A replay lands on the
  // workspace that exists rather than making another.
  await page.goto("/")
  await expect(page).toHaveURL(new RegExp(`/${slug}$`))
  for (let replay = 0; replay < 2; replay += 1) {
    await page.goto("/onboarding")
    await expect(page).toHaveURL(new RegExp(`/${slug}$`))
  }

  /**
   * Settings names the page rather than the workspace, so the provisioned name
   * is asserted where it is now editable and where the shell shows it. The
   * members table it used to check is gone: every workspace has exactly one
   * owner and no way to invite anybody, so the section listed one row saying
   * "you". The ownership model is unchanged and tests/db/tenancy.test.ts is
   * where it is proven.
   */
  await page.goto(routes.settings(slug))
  await expect(page.getByRole("heading", { level: 1, name: "Studio settings" })).toBeVisible()
  await expect(page.getByLabel("Workspace name")).toHaveValue("My studio")
  await expect(page.getByRole("banner").getByText("My studio")).toBeVisible()
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  )

  // Renamed in Settings. The header follows the name; the address does not.
  await renameWorkspace(page, slug, "Northbound Type")
  await expect(page).toHaveURL(new RegExp(`/${slug}$`))
  await expect(page.getByRole("link", { name: /My studio/ })).toHaveCount(0)

  // A new session resolves to the same workspace, not a second one.
  await signOut(page)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(new RegExp(`/${slug}$`))
  await expect(page.getByRole("link", { name: /Northbound Type/ })).toBeVisible()
  await expect(
    page.getByRole("heading", { level: 1, name: "Your first product starts here." }),
  ).toBeVisible()
})
