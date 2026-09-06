import { expect, test } from "@playwright/test"

/**
 * The marketing site, exercised the way a visitor meets it: signed out.
 *
 * Every page here is public and prerendered, so none of these tests creates a
 * user or touches a workspace.
 */
const PAGES = [
  ["/", "Create once."],
  ["/marketplaces", "Six shops. Six rulebooks. One of yours."],
  ["/how-it-works", "One master listing in. Six correct listings out."],
  ["/pricing", "Simple pricing for wherever you sell."],
  ["/about", "The product record belongs to the person who made the product."],
  ["/terms", "Terms of Service"],
  ["/privacy", "Privacy Policy"],
] as const

test("every marketing page is reachable without an account", async ({ page }) => {
  for (const [path, heading] of PAGES) {
    const response = await page.goto(path)
    expect(response?.status(), `${path} status`).toBe(200)
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}$`))
    await expect(page.getByRole("heading", { name: new RegExp(heading) }).first()).toBeVisible()
  }
})

test("the nav reaches every page it links to", async ({ page }) => {
  // Loaded fresh per link rather than walked with goBack(), so a failure names
  // the link that is wrong instead of the one after it.
  for (const [label, path] of [
    ["Marketplaces", "/marketplaces"],
    ["How it works", "/how-it-works"],
    ["Pricing", "/pricing"],
  ] as const) {
    await page.goto("/about")
    await page.locator("nav").first().getByRole("link", { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.locator("h1")).toBeVisible()
  }
})

test("the pricing calculator does the arithmetic the billing model states", async ({ page }) => {
  await page.goto("/pricing")
  const readout = page.locator(".fw-stepper__readout")

  // $9 base plus $6 a marketplace, per docs/billing.md.
  await expect(readout).toContainText("2 marketplaces")
  await expect(readout).toContainText("$21")

  await page.getByLabel("Add a marketplace").click()
  await expect(readout).toContainText("$27")

  // Annual is ten months for twelve: $90 and $60.
  await page.getByRole("button", { name: "Annual" }).click()
  await expect(readout).toContainText("$270")
  await expect(readout).toContainText("per year")
  await expect(page.getByText("Two months free")).toBeVisible()

  // The tiles and the stepper are one number, not two.
  await page.getByRole("button", { name: /Six marketplaces/ }).click()
  await expect(readout).toContainText("6 marketplaces")
  await expect(readout).toContainText("$450")

  // The count is clamped at both ends; zero marketplaces is the included
  // storefront on its own, not a negative bill.
  for (let i = 0; i < 10; i++) await page.getByLabel("Remove a marketplace").click()
  await expect(readout).toContainText("Storefront only")
  await expect(readout).toContainText("$90")
})

test("the landing picker prices the shops a visitor selects", async ({ page }) => {
  await page.goto("/")
  const total = page.locator(".fw-picker__total")
  await expect(total).toContainText("$21 per month")

  await page.getByRole("button", { name: "Envato", exact: true }).click()
  await expect(total).toContainText("$27 per month")
})

test("/start sends a visitor to the real account form", async ({ page }) => {
  // The mockups are published, so a link written against them still points here.
  await page.goto("/start")
  await expect(page).toHaveURL(/\/sign-up$/)
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible()
})

test("every Get started on the site reaches the account form", async ({ page }) => {
  // The one thing the marketing site is for. A CTA that lands on a form which
  // cannot create an account is the failure this replaced.
  for (const [path, label] of [
    ["/about", "Get started"],
    ["/marketplaces", "Get started"],
    ["/how-it-works", "Get started"],
    ["/pricing", "Start free"],
  ] as const) {
    await page.goto(path)
    await page.locator("nav").first().getByRole("link", { name: label, exact: true }).click()
    await expect(page, `${path} nav ${label}`).toHaveURL(/\/sign-up$/)
  }

  // And the landing's closing band, which used to hold the form itself.
  await page.goto("/")
  await page.locator(".fw-signup-card").getByRole("link", { name: "Get started" }).click()
  await expect(page).toHaveURL(/\/sign-up$/)
})

test("the light and dark view survives a navigation", async ({ page }) => {
  // Applied by a blocking inline script, so the page must not arrive in the
  // wrong theme and flip after hydration.
  await page.goto("/about")
  await page.locator(".fw-theme-toggle").click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.filter))
    .toBe("invert(1) hue-rotate(180deg)")

  await page.goto("/terms")
  expect(await page.evaluate(() => document.documentElement.style.filter)).toBe(
    "invert(1) hue-rotate(180deg)",
  )
})
