import { expect, test, type Page } from "@playwright/test"
import { routes } from "@/lib/routes"
import { newCreator, productUrl } from "./support"

/**
 * The keyboard, in a browser.
 *
 * What Node cannot decide is here: that ⌘K opens a real dialog and Escape
 * hands focus back to what had it, that F draws the guide and a letter
 * navigates, that the guide times out, that a letter typed in a field is a
 * letter, that the product list's J and K move real focus, and that the
 * setting turns single keys off while the palette stays on. The rules
 * themselves are tests/unit/commands-*.test.ts.
 *
 * "ControlOrMeta" presses ⌘ on a Mac and Ctrl elsewhere, which is exactly
 * the platform rule under test.
 */

/**
 * A template, not the default font: a font's page is the font workspace,
 * whose P is its own storefront preview. The list test wants the general
 * editor, where P is the public page.
 */
async function createProduct(page: Page, slug: string, name: string) {
  await page.goto(routes.newProduct(slug))
  await page.getByLabel("Product name").fill(name)
  await page.getByLabel("Product type").selectOption("template")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))
  await expect(page.getByRole("heading", { name })).toBeVisible()
}

function palette(page: Page) {
  return page.getByRole("dialog", { name: "Commands" })
}

/**
 * The chord the page itself prints. Playwright's Desktop Chrome carries a
 * Windows user agent whatever the host, so the app decides Ctrl; reading
 * the header's own keycap keeps the test and the app on one platform rule.
 */
async function paletteChord(page: Page): Promise<string> {
  const label = await page.getByRole("button", { name: /Commands/ }).textContent()
  return label?.includes("⌘") ? "Meta+k" : "Control+k"
}

function guide(page: Page) {
  return page.getByRole("status").filter({ hasText: "Fanwise:" })
}

test("⌘K opens the palette, a command runs, and Escape gives focus back", async ({ page }) => {
  const { slug } = await newCreator(page, "kbd-palette", "Keys Studio")
  await page.goto(routes.workspace(slug))

  // The header control, and the one-time hint beside it.
  const button = page.getByRole("button", { name: /Commands/ })
  await expect(button).toBeVisible()
  await expect(page.getByRole("note")).toContainText("Try")

  await page.keyboard.press(await paletteChord(page))
  await expect(palette(page)).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Search commands" })).toBeFocused()

  // Opening it retires the hint.
  await expect(page.getByRole("note")).toHaveCount(0)

  await page.keyboard.type("settings")
  const option = page.getByRole("option", { name: /Go to Settings/ })
  await expect(option).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Enter")
  await page.waitForURL(routes.settings(slug))
  await expect(palette(page)).toBeHidden()

  // Focus restoration: opened from the button, closed with Escape, back on the button.
  await button.focus()
  await page.keyboard.press("Enter")
  await expect(palette(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(palette(page)).toBeHidden()
  await expect(button).toBeFocused()

  // The empty state.
  await page.keyboard.press(await paletteChord(page))
  await page.keyboard.type("zzzz-nothing")
  await expect(palette(page)).toContainText("Nothing matches")
  await expect(page.getByRole("option")).toHaveCount(0)
  await page.keyboard.press("Escape")
})

test("F draws the guide; a letter navigates; it times out and Escape closes it", async ({
  page,
}) => {
  const { slug } = await newCreator(page, "kbd-guide", "Guide Studio")
  await page.goto(routes.settings(slug))
  await page.locator("body").click({ position: { x: 4, y: 4 } })

  await page.keyboard.press("f")
  await expect(guide(page)).toBeVisible()
  await expect(guide(page)).toContainText("P Products")
  await page.keyboard.press("p")
  await page.waitForURL(routes.workspace(slug))
  await expect(guide(page)).toHaveCount(0)

  // Every destination that navigates.
  for (const [key, path] of [
    ["c", routes.channels(slug)],
    ["r", routes.profile(slug)],
    ["s", routes.settings(slug)],
  ] as const) {
    await page.keyboard.press("f")
    await expect(guide(page)).toBeVisible()
    await page.keyboard.press(key)
    await page.waitForURL(path)
  }

  // Preview, with no profile: refused, with the reason where the guide was.
  await page.keyboard.press("F")
  await page.keyboard.press("v")
  await expect(
    page.getByRole("status").filter({ hasText: "Create a public profile first." }),
  ).toBeVisible()

  // Timeout.
  await page.keyboard.press("f")
  await expect(guide(page)).toBeVisible()
  await expect(guide(page)).toHaveCount(0, { timeout: 3000 })

  // Escape.
  await page.keyboard.press("f")
  await expect(guide(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(guide(page)).toHaveCount(0)

  // A letter typed into a field is a letter.
  const name = page.getByLabel("Workspace name")
  await name.fill("")
  await name.press("f")
  await name.press("c")
  await expect(guide(page)).toHaveCount(0)
  await expect(name).toHaveValue("fc")
  await expect(page).toHaveURL(routes.settings(slug))
})

test("single keys reach the real routes, and ? opens the reference", async ({ page }) => {
  const { slug } = await newCreator(page, "kbd-single", "Single Studio")
  await page.goto(routes.settings(slug))
  await page.locator("body").click({ position: { x: 4, y: 4 } })

  await page.keyboard.press("c")
  await page.waitForURL(routes.newProduct(slug))

  // The new-product form focuses its name field, so click out first.
  await page.locator("body").click({ position: { x: 4, y: 4 } })
  await page.keyboard.press("i")
  await page.waitForURL(routes.importProduct(slug))

  await page.locator("body").click({ position: { x: 4, y: 4 } })
  await page.keyboard.press("?")
  const reference = page.getByRole("dialog", { name: "Keyboard shortcuts" })
  await expect(reference).toBeVisible()
  await expect(reference).toContainText("Fanwise navigation")
  await page.keyboard.press("Escape")
  await expect(reference).toBeHidden()
})

test("the product list's keys move focus between rows and only there", async ({ page }) => {
  const { slug } = await newCreator(page, "kbd-list", "List Studio")
  await createProduct(page, slug, "Aster Grotesk")
  await createProduct(page, slug, "Meridian Serif")
  await page.goto(routes.workspace(slug))

  // Newest first: Meridian, then Aster.
  const meridian = page.getByRole("link", { name: "Meridian Serif", exact: true })
  const aster = page.getByRole("link", { name: "Aster Grotesk", exact: true })

  // Outside the list, J is a letter: nothing moves.
  await page.locator("body").click({ position: { x: 4, y: 4 } })
  await page.keyboard.press("j")
  await expect(meridian).not.toBeFocused()

  await meridian.focus()
  await page.keyboard.press("j")
  await expect(aster).toBeFocused()
  await page.keyboard.press("ArrowUp")
  await expect(meridian).toBeFocused()
  await page.keyboard.press("k")
  await expect(meridian).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(aster).toBeFocused()
  await page.keyboard.press("e")
  await page.waitForURL(productUrl(slug))
  await expect(page.getByRole("heading", { name: "Aster Grotesk" })).toBeVisible()

  // P on the product page, with no public page: refused with the reason.
  await page.locator("body").click({ position: { x: 4, y: 4 } })
  await page.keyboard.press("p")
  await expect(
    page.getByRole("status").filter({ hasText: "Set up a public profile first." }),
  ).toBeVisible()

  // "/" reaches the catalog's search box from another page.
  await page.keyboard.press("/")
  await page.waitForURL(routes.workspace(slug))
  await expect(page.getByRole("searchbox")).toBeFocused()
})

test("the setting turns single keys off and leaves the palette on", async ({ page }) => {
  const { slug } = await newCreator(page, "kbd-pref", "Pref Studio")
  await page.goto(routes.settings(slug))
  await page.getByLabel("Single-key shortcuts").uncheck()

  await page.locator("body").click({ position: { x: 4, y: 4 } })
  await page.keyboard.press("c")
  await page.keyboard.press("f")
  await expect(guide(page)).toHaveCount(0)
  await expect(page).toHaveURL(routes.settings(slug))

  await page.keyboard.press(await paletteChord(page))
  await expect(palette(page)).toBeVisible()
  await page.keyboard.press("Escape")

  // Survives a reload, and switches back on.
  await page.reload()
  await expect(page.getByLabel("Single-key shortcuts")).not.toBeChecked()
  await page.getByLabel("Single-key shortcuts").check()
  await page.locator("body").click({ position: { x: 4, y: 4 } })
  await page.keyboard.press("c")
  await page.waitForURL(routes.newProduct(slug))
})
