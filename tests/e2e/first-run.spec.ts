import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { productUrl, signUp } from "./support"

/**
 * The first-run catalog, in the browser: what an empty workspace shows, where
 * its one action goes, the order a keyboard reaches things in, and that it fits
 * a phone. The markup-level checks are tests/unit/first-run.test.ts.
 */

const HEADING = "Your first product starts here."

test("an empty workspace offers one primary action, an honest import and the path", async ({
  page,
}) => {
  const { slug } = await signUp(page, "fr")
  const main = page.getByRole("main")

  await expect(main.getByRole("heading", { level: 1, name: HEADING })).toBeVisible()

  // One primary action, pointing at this workspace's new-product route.
  const create = main.getByRole("link", { name: /create/i })
  await expect(create).toHaveCount(1)
  await expect(create).toHaveAccessibleName("Create first product")
  await expect(create).toHaveAttribute("href", routes.newProduct(slug))
  await expect(main.getByRole("link", { name: /new product/i })).toHaveCount(0)
  await expect(main.getByRole("button", { name: /create/i })).toHaveCount(0)
  await expect(main.getByRole("table")).toHaveCount(0)

  // No import flow exists, and the control says so instead of going somewhere.
  const importListing = main.getByRole("button", { name: "Import a live listing" })
  await expect(importListing).toHaveAttribute("aria-disabled", "true")
  await expect(importListing).toHaveAccessibleDescription("Coming soon")
  await expect(main.getByRole("link", { name: "Import a live listing" })).toHaveCount(0)
  await importListing.dispatchEvent("click")
  await expect(page).toHaveURL(new RegExp(`/${slug}$`))

  // The path starts at step one, with nothing claimed.
  await expect(main.getByRole("heading", { level: 2, name: "Your path to publish" })).toBeVisible()
  await expect(main.getByText("0 of 4 complete")).toBeVisible()
  const current = main.locator('li[aria-current="step"]')
  await expect(current).toHaveCount(1)
  await expect(current).toContainText("Create a product")
  await expect(
    main.getByText("You can leave and return anytime. Progress saves automatically."),
  ).toBeVisible()

  // The destinations are text, not pictures.
  const channels = main.getByRole("list", { name: "Channels" })
  for (const name of ["Etsy", "Creative Market", "Gumroad", "Shopify", "Adobe", "And more"]) {
    await expect(channels.getByText(name, { exact: true })).toBeVisible()
  }

  await create.click()
  await page.waitForURL(new RegExp(`/${slug}/new$`))
  await expect(page.getByRole("heading", { name: "New product" })).toBeVisible()
})

test("the keyboard reaches the header, then the primary action, then import", async ({ page }) => {
  const { slug } = await signUp(page, "frkeys")
  await page.goto(routes.workspace(slug))
  await expect(page.getByRole("heading", { level: 1, name: HEADING })).toBeVisible()

  const nav = page.getByRole("navigation", { name: "Workspace" })
  const main = page.getByRole("main")
  const sequence = [
    page.getByRole("link", { name: /My studio/ }),
    nav.getByRole("link", { name: "Products", exact: true }),
    nav.getByRole("link", { name: "Channels", exact: true }),
    nav.getByRole("link", { name: "Settings", exact: true }),
    page.getByRole("button", { name: /^Switch to (dark|light) mode$/ }),
    page.getByRole("button", { name: "Sign out" }),
    main.getByRole("link", { name: "Create first product" }),
    main.getByRole("button", { name: "Import a live listing" }),
  ]

  for (const target of sequence) {
    await page.keyboard.press("Tab")
    await expect(target).toBeFocused()
  }
})

test("once a product exists the catalog is the normal dashboard", async ({ page }) => {
  const { slug } = await signUp(page, "frpop")

  await page.goto(routes.newProduct(slug))
  await page.getByLabel("Product name").fill("Populated Grotesk")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))
  await expect(page.getByRole("heading", { name: "Populated Grotesk" })).toBeVisible()

  await page.goto(routes.workspace(slug))
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()
  await expect(main.getByRole("link", { name: "New product" })).toBeVisible()
  await expect(main.getByRole("table")).toHaveCount(1)
  await expect(main.getByRole("link", { name: "Populated Grotesk" })).toBeVisible()
  await expect(page.getByRole("heading", { name: HEADING })).toHaveCount(0)
  await expect(page.getByText("Your path to publish")).toHaveCount(0)
})

test("fits phone and tablet widths without sideways scrolling", async ({ page }) => {
  const { slug } = await signUp(page, "frnarrow")

  for (const width of [320, 360, 390, 414, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(routes.workspace(slug))
    const main = page.getByRole("main")
    await expect(main.getByRole("heading", { level: 1, name: HEADING })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${width}px scrolls sideways`).toBeLessThanOrEqual(0)

    // The primary action comes before the picture, not after it.
    const cta = await main.getByRole("link", { name: "Create first product" }).boundingBox()
    const channels = await main.getByRole("list", { name: "Channels" }).boundingBox()
    expect(cta && channels, `${width}px`).toBeTruthy()
    expect(cta!.y + cta!.height, `${width}px`).toBeLessThanOrEqual(channels!.y)

    // Every section link sits wholly on screen, at a usable size.
    const nav = page.getByRole("navigation", { name: "Workspace" })
    for (const name of ["Products", "Channels", "Settings"]) {
      const box = await nav.getByRole("link", { name, exact: true }).boundingBox()
      expect(box, `${name} at ${width}px`).toBeTruthy()
      expect(box!.x, `${name} at ${width}px`).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, `${name} at ${width}px`).toBeLessThanOrEqual(width)
      expect(box!.height, `${name} at ${width}px`).toBeGreaterThanOrEqual(44)
    }
  }
})
