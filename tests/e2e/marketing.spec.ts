import { expect, test } from "@playwright/test"

/**
 * The marketing site, exercised the way a visitor meets it: signed out.
 *
 * Every page here is public and prerendered, so none of these tests creates a
 * user or touches a workspace.
 */
const PAGES = [
  ["/", "Create once."],
  ["/marketplaces", "Seven shops. Seven rulebooks. One of yours."],
  ["/how-it-works", "One master listing in. Six correct listings out."],
  ["/pricing", "Simple pricing for wherever you sell."],
  ["/about", "The product record belongs to the person who made the product."],
  ["/terms", "Terms of Service"],
  ["/privacy", "Privacy Policy"],
] as const

/** Where each page's own nav sends its call to action. */
const CALLS_TO_ACTION: Record<string, string> = {
  "/about": "Get started",
  "/marketplaces": "Get started",
  "/how-it-works": "Get started",
  "/pricing": "Start free",
}

test("every marketing page is reachable without an account", async ({ page }) => {
  for (const [path, heading] of PAGES) {
    const response = await page.goto(path)
    expect(response?.status(), `${path} status`).toBe(200)
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}$`))
    await expect(page.getByRole("heading", { name: new RegExp(heading) }).first()).toBeVisible()

    // Every Get started on the site reaches the account form: the one thing the
    // marketing site is for. Asserted on the rendered link rather than by a click
    // per page; one real click through follows below.
    const cta = CALLS_TO_ACTION[path]
    if (cta) {
      await expect(
        page.locator("nav").first().getByRole("link", { name: cta, exact: true }),
        `${path} nav ${cta}`,
      ).toHaveAttribute("href", "/sign-up")
    }
  }

  // The nav reaches every page it links to. Clicked, so a failure names the
  // link that is wrong and proves client navigation lands on a rendered page.
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

  /*
    The pricing calculator does the arithmetic the billing model states: $9 base
    plus $6 a marketplace, and annual is ten months for twelve. The calculator
    keeps its own constants, so tests/unit/marketing.test.ts pins them to
    lib/billing/rules.ts; this is what a visitor's clicks do with them.
  */
  const readout = page.locator(".fw-stepper__readout")
  await expect(readout).toContainText("2 marketplaces")
  await expect(readout).toContainText("$21")

  await page.getByLabel("Add a marketplace").click()
  await expect(readout).toContainText("$27")

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

  // The landing picker prices the shops a visitor selects.
  await page.goto("/")
  const total = page.locator(".fw-picker__total")
  await expect(total).toContainText("$21 per month")
  await page.getByRole("button", { name: "Envato", exact: true }).click()
  await expect(total).toContainText("$27 per month")

  // And the landing's closing band, which used to hold the form itself, reaches
  // the real account form. /start's redirect to it is tests/unit/marketing.test.ts.
  await page.locator(".fw-signup-card").getByRole("link", { name: "Get started" }).click()
  await expect(page).toHaveURL(/\/sign-up$/)
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible()
})

test("the light and dark view survives a navigation", async ({ page }) => {
  // Applied by a blocking inline script, so the page must not arrive in the
  // wrong theme and flip after hydration. Real tokens preserve image colours;
  // the old document-level invert filter did not.
  await page.goto("/about")
  await page.evaluate(() => localStorage.setItem("fw-theme", "light"))
  await page.reload()
  await page.getByRole("button", { name: "Switch to dark mode" }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark")

  await page.goto("/terms")
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark")
  expect(await page.evaluate(() => document.documentElement.style.filter)).toBe("")
})

test("on a phone the nav links live in a menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/pricing")

  // The row is gone at this width, so everything it held has to be somewhere
  // else. Before this menu existed it was nowhere.
  const nav = page.locator("nav").first()
  await expect(nav.locator(".fw-nav__links")).toBeHidden()

  const menu = page.getByRole("button", { name: "Open menu" })
  await expect(menu).toBeVisible()
  await menu.click()

  const panel = page.locator(".fw-nav__panel")
  await expect(panel).toBeVisible()
  for (const label of ["Product", "Marketplaces", "How it works", "FAQ", "About", "Sign in"]) {
    await expect(panel.getByRole("link", { name: label, exact: true }), label).toBeVisible()
  }
  await expect(panel.getByRole("link", { name: "Start free", exact: true })).toHaveAttribute(
    "href",
    "/sign-up",
  )

  // Escape closes it and hands the focus back, rather than dropping it on the
  // document where the next Tab starts from the top of the page.
  await page.keyboard.press("Escape")
  await expect(panel).toBeHidden()
  await expect(menu).toBeFocused()

  // A link closes it on the way out: the anchor links change no route, so the
  // panel cannot rely on the navigation alone.
  await menu.click()
  await panel.getByRole("link", { name: "About", exact: true }).click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.locator(".fw-nav__panel")).toBeHidden()

  // Past the breakpoint the row is back and the menu is not offered twice.
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden()
  await expect(nav.locator(".fw-nav__links")).toBeVisible()
})
