import { expect, test, type Page } from "@playwright/test"
import { routes } from "@/lib/routes"
import { productUrl, signOut, signUp, signUpAndCreateWorkspace } from "./support"
import { connect, upload, waitForProductPage, writeListing } from "./publish-support"

/**
 * The populated catalog in the browser.
 *
 * The markup-level checks are tests/unit/catalog-page.test.ts and the ranking
 * is tests/unit/catalog.test.ts. What is left for a browser is everything those
 * cannot decide: that the live count is the count of listings a buyer can
 * actually reach, that the tip opens to a keyboard, that a search narrows the
 * real list, and that four columns fit a phone.
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

test("a signed-out visitor never reaches a catalog", async ({ page }) => {
  const { slug } = await signUp(page, "catout")
  await signOut(page)

  await page.goto(routes.workspace(slug))
  await expect(page).toHaveURL(/\/sign-in/)
})

test("the catalog says what is here, where it is live, and what to do next", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "catlive", "Catalog Studio")
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
})

test("a product with nothing built is offered the thing that builds it", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "catnew", "Fresh Studio")
  await createProduct(page, slug, "Untouched Sans", "font")

  await page.goto(routes.workspace(slug))
  const untouched = row(page, "Untouched Sans")

  await expect(untouched).toContainText("No listings yet")
  await expect(untouched).toContainText("No live channels")
  // No tip at all: there is nothing for one to say.
  await expect(untouched.getByRole("button")).toHaveCount(0)

  await untouched.getByRole("link", { name: /Build listings/ }).click()
  await expect(page).toHaveURL(new RegExp(`/${slug}/[a-z0-9-]+$`))
  await expect(page.getByRole("heading", { name: "Untouched Sans" })).toBeVisible()
})

test("one primary action, and it goes to this workspace's new-product route", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "catcta", "CTA Studio")
  await createProduct(page, slug, "Only Product")

  await page.goto(routes.workspace(slug))
  const main = page.getByRole("main")

  const add = main.getByRole("link", { name: "Add product" })
  await expect(add).toHaveCount(1)
  await expect(add).toHaveAttribute("href", routes.newProduct(slug))
  // The rows offer links, never a second filled button competing with this one.
  await expect(main.getByRole("link", { name: /^New product$/ })).toHaveCount(0)

  await add.click()
  await page.waitForURL(new RegExp(`/${slug}/new$`))
})

test("search narrows the catalog, says so, and clears back to all of it", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "catsearch", "Search Studio")
  await createProduct(page, slug, "Aster Grotesk", "font")
  await createProduct(page, slug, "Harbour Icons", "icon")

  await page.goto(routes.workspace(slug))
  const main = page.getByRole("main")
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
})

test("no search results is not an empty workspace", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "catnores", "No Results Studio")
  await createProduct(page, slug, "Aster Grotesk", "font")

  await page.goto(`${routes.workspace(slug)}?q=nothing-matches-this`)
  const main = page.getByRole("main")

  await expect(main.getByText("No products match those filters.")).toBeVisible()
  await expect(main.getByText("No products match. 1 in the catalog.")).toBeVisible()

  // Emphatically not the first-run screen: this workspace has a product.
  await expect(page.getByRole("heading", { name: "Your first product starts here." })).toHaveCount(
    0,
  )
  await expect(main.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()

  await main.getByRole("link", { name: "Show all products" }).click()
  await expect(main.getByRole("link", { name: "Aster Grotesk", exact: true })).toBeVisible()
})

test("the status filter only ever shows products that are in that state", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "catfilter", "Filter Studio")
  await createProduct(page, slug, "Nothing Built", "font")

  await page.goto(routes.workspace(slug))
  const main = page.getByRole("main")

  await main.getByLabel("Show").selectOption("waiting")
  await expect(page).toHaveURL(/\?status=waiting/)
  await expect(main.getByRole("link", { name: "Nothing Built", exact: true })).toBeVisible()

  await main.getByLabel("Show").selectOption("settled")
  await expect(main.getByText("No products match those filters.")).toBeVisible()

  // A filter the URL invents falls back to the whole catalog rather than an
  // error: `?status=toString` used to resolve through Object.prototype.
  await page.goto(`${routes.workspace(slug)}?status=toString`)
  await expect(main.getByRole("link", { name: "Nothing Built", exact: true })).toBeVisible()
})

test("search never reaches another workspace's catalog", async ({ page }) => {
  const b = await signUpAndCreateWorkspace(page, "cattenb", "Bravo Catalog")
  await createProduct(page, b.slug, "Bravo Secret Font", "font")
  await signOut(page)

  const a = await signUpAndCreateWorkspace(page, "cattena", "Alpha Catalog")
  await createProduct(page, a.slug, "Alpha Public Font", "font")

  await page.goto(`${routes.workspace(a.slug)}?q=Bravo`)
  const main = page.getByRole("main")

  await expect(main.getByText("No products match those filters.")).toBeVisible()
  await expect(page.getByText("Bravo Secret Font")).toHaveCount(0)
  // The count names only this workspace's catalog.
  await expect(main.getByText("No products match. 1 in the catalog.")).toBeVisible()
})

test("a long product name does not push the row sideways, in either theme", async ({ page }) => {
  const long = "A Preposterously Long Product Name That Nobody Would Reasonably Choose To Type"
  const { slug } = await signUpAndCreateWorkspace(page, "catlong", "Long Studio")
  await createProduct(page, slug, long, "font")

  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(routes.workspace(slug))

      // The toggle names the theme it would switch to, so this presses it only
      // when the page is not already in the theme under test.
      const toggle = page.getByRole("button", { name: `Switch to ${theme} mode` })
      if (await toggle.isVisible()) await toggle.click()

      await expect(page.getByRole("link", { name: long, exact: true })).toBeVisible()

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${theme} at ${width}px scrolls sideways`).toBeLessThanOrEqual(0)
    }
  }
})

test("every row's action stays reachable and tappable on a phone", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "catphone", "Phone Studio")
  await createProduct(page, slug, "Pocket Sans", "font")

  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto(routes.workspace(slug))

  const action = page.getByRole("link", { name: /Build listings/ })
  const box = await action.boundingBox()
  expect(box).toBeTruthy()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(360)

  // It goes to the product rather than being swallowed by the row's own link.
  await action.click()
  await expect(page.getByRole("heading", { name: "Pocket Sans" })).toBeVisible()
})

test("the keyboard reaches the controls, then each row, in the order they are read", async ({
  page,
}) => {
  const { slug } = await signUpAndCreateWorkspace(page, "catkeys", "Keyboard Studio")
  await createProduct(page, slug, "First Product", "font")

  await page.goto(routes.workspace(slug))
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()

  const nav = page.getByRole("navigation", { name: "Workspace" })
  const sequence = [
    page.getByRole("link", { name: /Keyboard Studio/ }),
    nav.getByRole("link", { name: "Products", exact: true }),
    nav.getByRole("link", { name: "Channels", exact: true }),
    nav.getByRole("link", { name: "Settings", exact: true }),
    page.getByRole("button", { name: /^Switch to (dark|light) mode$/ }),
    page.getByRole("button", { name: "Sign out" }),
    main.getByRole("link", { name: "Add product" }),
    main.getByLabel("Search"),
    main.getByLabel("Show"),
    main.getByRole("button", { name: "Search" }),
  ]

  for (const target of sequence) {
    await page.keyboard.press("Tab")
    await expect(target).toBeFocused()
  }
})
