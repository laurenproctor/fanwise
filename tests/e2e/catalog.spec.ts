import { expect, test, type Page } from "@playwright/test"
import { routes } from "@/lib/routes"
import { newCreator, productUrl } from "./support"
import { connect, upload, waitForProductPage, writeListing } from "./publish-support"

/**
 * The populated catalog in the browser.
 *
 * The markup-level checks are tests/unit/catalog-page.test.ts and the ranking,
 * labels and next actions are tests/unit/catalog.test.ts. What is left for a
 * browser is everything those cannot decide: that the live count is the count
 * of listings a buyer can actually reach, that the tip opens to a keyboard, the
 * order Tab reaches things in, that a search narrows the real list, and that a
 * row fits a phone.
 *
 * Search never reaching another workspace is not a browser question: the
 * catalog reads through RLS, and tests/db/product-tenancy.test.ts proves one
 * workspace cannot select another's products. A signed-out visitor is turned
 * away by the proxy, which tests/unit/proxy.test.ts runs over every private
 * route and journey-09-tenancy.spec.ts proves through a browser.
 */

async function createProduct(page: Page, slug: string, name: string, type?: string) {
  await page.goto(routes.newProduct(slug))
  await page.getByLabel("Product name").fill(name)
  if (type) await page.getByLabel("Product type").selectOption(type)
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))
  await expect(page.getByRole("heading", { name })).toBeVisible()
}

function row(page: Page, name: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) })
}

function sidewaysOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

test("the catalog says what is here, where it is live, and what to do next", async ({ page }) => {
  const { slug } = await newCreator(page, "catlive", "Catalog Studio")
  await connect(page, slug, "Mock Storefront")

  await createProduct(page, slug, "Aster Grotesk", "font")
  await upload(page, "cover_image", "tests/fixtures/small-800x600.png", 0)
  await upload(page, "deliverable", "tests/fixtures/specimen-3000x2000.jpg", 1)

  await page.getByRole("button", { name: "Build listing" }).click()
  await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(1)
  await writeListing(page, slug)

  // A listing written and never sent: ready, and nowhere a buyer can reach.
  await page.goto(routes.workspace(slug))
  const aster = row(page, "Aster Grotesk")
  await expect(aster).toContainText("No live channels")
  await expect(aster).toContainText("1 ready to publish")
  await expect(aster.getByRole("link", { name: /Publish/ })).toHaveCount(1)

  // Publish it for real, then come back. Only now is anything live.
  //
  // The action lands on the product page rather than the channel's own, and
  // that is the point of the assertion: the Publish button lives on the card
  // there, so a row offering Publish has to arrive somewhere that has one.
  await aster.getByRole("link", { name: /Publish/ }).click()
  await waitForProductPage(page, slug, "Aster Grotesk")
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 30_000 })

  await page.goto(routes.workspace(slug))
  const live = row(page, "Aster Grotesk")
  await expect(live).toContainText("1 live channel")
  await expect(live).toContainText("Nothing outstanding")
  await expect(live.getByRole("link", { name: /View listings/ })).toHaveCount(1)

  // The count is a sentence on its own, and the names are in the tip beside it.
  const tip = live.getByRole("button", { name: "Which channels Aster Grotesk is live on" })
  await expect(tip).toHaveAccessibleDescription("Live on Mock Storefront.")

  // And the tip opens to a keyboard, not only to a pointer.
  await tip.focus()
  await expect(live.getByText("Live on Mock Storefront.", { exact: true }).last()).toBeVisible()

  // On a phone, the row's action stays wholly on screen, and a tap on it goes to
  // the product rather than being swallowed by the row's own stretched link.
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto(routes.workspace(slug))
  const action = row(page, "Aster Grotesk").getByRole("link", { name: /View listings/ })
  const box = await action.boundingBox()
  expect(box).toBeTruthy()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(360)
  await action.click()
  await waitForProductPage(page, slug, "Aster Grotesk")
})

test("search narrows the catalog, says so, and clears back to all of it", async ({ page }) => {
  const { slug } = await newCreator(page, "catsearch", "Search Studio")
  await createProduct(page, slug, "Aster Grotesk", "font")
  await createProduct(page, slug, "Harbour Icons", "icon")

  await page.goto(routes.workspace(slug))
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()

  // The keyboard reaches the header, the primary action, then the controls, in
  // the order they are read. Real focus from a fresh load, before any click.
  const nav = page.getByRole("navigation", { name: "Workspace" })
  for (const target of [
    page.getByRole("link", { name: /Search Studio/ }),
    nav.getByRole("link", { name: "Products", exact: true }),
    nav.getByRole("link", { name: "Channels", exact: true }),
    nav.getByRole("link", { name: "Settings", exact: true }),
    page.getByRole("button", { name: /^Switch to (dark|light) mode$/ }),
    page.getByRole("button", { name: "Sign out" }),
    main.getByRole("link", { name: "Add product" }),
    main.getByLabel("Search"),
    main.getByLabel("Show"),
    main.getByRole("button", { name: "Search" }),
  ]) {
    await page.keyboard.press("Tab")
    await expect(target).toBeFocused()
  }

  // The populated catalog is the dashboard, not the first run: one list, and
  // one primary action going to this workspace's new-product route.
  await expect(main.getByRole("list", { name: "Products" })).toHaveCount(1)
  await expect(page.getByRole("heading", { name: "Your first product starts here." })).toHaveCount(
    0,
  )
  const add = main.getByRole("link", { name: "Add product" })
  await expect(add).toHaveCount(1)
  await expect(add).toHaveAttribute("href", routes.newProduct(slug))
  await expect(main.getByRole("link", { name: /^New product$/ })).toHaveCount(0)

  await expect(main.getByRole("listitem")).toHaveCount(2)

  await main.getByLabel("Search").fill("harbour")
  await main.getByRole("button", { name: "Search" }).click()

  await expect(page).toHaveURL(/\?q=harbour/)
  await expect(main.getByRole("listitem")).toHaveCount(1)
  await expect(main.getByText("Showing 1 of 2 products.")).toBeVisible()
  await expect(main.getByRole("link", { name: "Aster Grotesk", exact: true })).toHaveCount(0)

  // The type is searchable too, because it is the other thing the row shows.
  await page.goto(`${routes.workspace(slug)}?q=font`)
  await expect(main.getByRole("link", { name: "Aster Grotesk", exact: true })).toBeVisible()

  await page.goto(`${routes.workspace(slug)}?q=harbour`)
  await main.getByRole("link", { name: "Clear" }).click()
  await expect(page).toHaveURL(new RegExp(`/${slug}$`))
  await expect(main.getByRole("listitem")).toHaveCount(2)

  // No search results is not an empty workspace: it says what the catalog
  // holds, is emphatically not the first-run screen, and offers the way back.
  await page.goto(`${routes.workspace(slug)}?q=nothing-matches-this`)
  await expect(main.getByText("No products match those filters.")).toBeVisible()
  await expect(main.getByText("No products match. 2 in the catalog.")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Your first product starts here." })).toHaveCount(
    0,
  )
  await expect(main.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()
  await main.getByRole("link", { name: "Show all products" }).click()
  await expect(main.getByRole("link", { name: "Aster Grotesk", exact: true })).toBeVisible()
})

test("the status filter only ever shows products that are in that state", async ({ page }) => {
  // Long on purpose: the same product proves a long name wraps rather than
  // pushing the row sideways, below.
  const name = "A Preposterously Long Product Name That Nobody Would Reasonably Choose To Type"
  const { slug } = await newCreator(page, "catfilter", "Filter Studio")
  await createProduct(page, slug, name, "font")

  await page.goto(routes.workspace(slug))
  const main = page.getByRole("main")

  // A product with nothing built says so, and is offered the thing that builds it.
  const untouched = row(page, name)
  await expect(untouched).toContainText("No listings yet")
  await expect(untouched).toContainText("No live channels")
  await expect(untouched.getByRole("button")).toHaveCount(0)
  await expect(untouched.getByRole("link", { name: /Build listings/ })).toHaveCount(1)

  await main.getByLabel("Show").selectOption("waiting")
  await expect(page).toHaveURL(/\?status=waiting/)
  await expect(main.getByRole("link", { name, exact: true })).toBeVisible()

  await main.getByLabel("Show").selectOption("settled")
  await expect(main.getByText("No products match those filters.")).toBeVisible()

  // A filter the URL invents falls back to the whole catalog rather than an
  // error: `?status=toString` used to resolve through Object.prototype.
  await page.goto(`${routes.workspace(slug)}?status=toString`)
  await expect(main.getByRole("link", { name, exact: true })).toBeVisible()

  // The long name does not push the row sideways, at any width, in either theme.
  // The toggle names the theme it would switch to, so this presses it only when
  // the page is not already in the theme under test.
  for (const theme of ["light", "dark"] as const) {
    await page.goto(routes.workspace(slug))
    const toggle = page.getByRole("button", { name: `Switch to ${theme} mode` })
    if (await toggle.isVisible()) await toggle.click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)

    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible()
      expect(
        await sidewaysOverflow(page),
        `${theme} at ${width}px scrolls sideways`,
      ).toBeLessThanOrEqual(0)
    }
  }
})
