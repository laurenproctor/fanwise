import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { productUrl, signUpAndCreateWorkspace } from "./support"

/**
 * Journey 1, now complete: signup, workspace, product. The A1 half proved the
 * first two; A2 adds the third.
 */
test("a creator signs up, gets a workspace, and creates a product", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1p", "Northbound Type")

  // Signup lands on the catalog directly: a workspace's root is what it sells.
  await expect(page).toHaveURL(new RegExp(`/${slug}$`))

  // The empty state says something useful rather than showing a bare table.
  await expect(page.getByText("Nothing here yet")).toBeVisible()

  await page.getByRole("link", { name: "Create your first product" }).click()
  await page.getByLabel("Product name").fill("Aster Grotesk")
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()

  await page.waitForURL(productUrl(slug))
  await expect(page.getByRole("heading", { name: "Aster Grotesk" })).toBeVisible()

  // The product is addressable under its own slug, inside the workspace slug.
  const path = new URL(page.url()).pathname
  expect(path).toMatch(productUrl(slug))

  // And it appears in the catalog.
  await page.goto(`/${slug}`)
  await expect(page.getByRole("link", { name: "Aster Grotesk" })).toBeVisible()
})

test("the canonical record saves and survives a reload", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1e", "Edit Studio")

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Editable Product")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))

  await page.getByLabel("Canonical title").fill("Editable Product Family")
  await page.getByLabel("Brand name").fill("Northbound")
  await page.getByRole("button", { name: "Save changes" }).click()

  // Wait for the save to be confirmed. Reloading straight after the click races
  // the server action and tells you nothing about whether it persisted.
  await expect(page.getByRole("status")).toHaveText(/^Saved/)

  await page.reload()
  await expect(page.getByLabel("Canonical title")).toHaveValue("Editable Product Family")
  await expect(page.getByLabel("Brand name")).toHaveValue("Northbound")
})

/**
 * Dropping a file onto the images panel.
 *
 * This is here because it broke, and it broke in the way drag-and-drop always
 * breaks: nothing at all happened, with no error anywhere. The panel had drag
 * handlers for reordering, so the gesture looked supported, and a file dropped
 * on a tile hit a handler that had no index to move and returned silently.
 *
 * The drop is dispatched with a real DataTransfer built in the page rather than
 * through `setInputFiles`, because the file input is exactly the path that was
 * already working. A test that goes through the input would have passed
 * throughout the bug.
 */
test("a creator drops an image onto the product's images panel", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1d", "Drop Studio")

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Dropped Product")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))

  // A repo-relative path, as journey 5 uses. This file is compiled to CJS by
  // the Playwright runner, where import.meta does not exist.
  const png = readFileSync("tests/fixtures/small-800x600.png")
  const transfer = await page.evaluateHandle(
    ([bytes, name]) => {
      const data = new DataTransfer()
      data.items.add(new File([new Uint8Array(bytes as number[])], name as string, {
        type: "image/png",
      }))
      return data
    },
    [Array.from(png), "small-800x600.png"] as const,
  )

  // Onto an existing area of the panel, not the dashed tile: aiming a file
  // precisely at one small square is the gesture nobody actually performs.
  const panel = page.getByRole("region", { name: "Images" })
  await panel.dispatchEvent("drop", { dataTransfer: transfer })

  // The tile exists whatever state the asset is in; the finalize job decides
  // ready versus pending on its own schedule and that is not what this asserts.
  await expect(panel.getByText("small-800x600.png")).toBeVisible()

  // And the first image of an empty product is its cover, without anyone
  // having been asked. Position is the model.
  await expect(panel.getByText("Cover", { exact: true })).toBeVisible()
})

/**
 * The guard that stops a missed drop from replacing the page.
 *
 * A browser handed a file it was not offered opens it, discarding whatever was
 * on screen and any unsaved edit with it. Playwright cannot assert on "the
 * document was not replaced" — the navigation is the browser's default action,
 * and if it happens the test has already lost the page it wanted to check. So
 * this asserts the thing that prevents it: whether the drop event came back
 * cancelled. `dispatchEvent` returns false when preventDefault was called.
 */
test("a file dropped off-target is refused rather than opened", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1g", "Guard Studio")

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Guarded Product")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))

  const cancelled = await page.evaluate(() => {
    const data = new DataTransfer()
    data.items.add(new File(["not really a png"], "stray.png", { type: "image/png" }))
    const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data })
    return !document.body.dispatchEvent(event)
  })

  expect(cancelled).toBe(true)

  // And the page is still the page, rather than a rendering of the file.
  await expect(page.getByRole("heading", { name: "Guarded Product" })).toBeVisible()
})

/**
 * The exemption that keeps the Files section working.
 *
 * Dropping onto `<input type="file">` fills it natively, with no JavaScript
 * anywhere, and that happens as the default action — exactly what the guard
 * cancels everywhere else. Fixing one silent failure by causing another is not
 * a trade worth making, so the guard steps aside here, and this is the test
 * that says so before someone simplifies the exemption away.
 */
test("the guard leaves a native file input alone", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1i", "Input Studio")

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Input Product")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))

  // Through the label rather than a raw selector, so this waits for the Files
  // section to render instead of racing it.
  const input = page.getByLabel("Add a file")
  await expect(input).toBeVisible()

  const cancelled = await input.evaluate((element) => {
    const data = new DataTransfer()
    data.items.add(new File(["not really a png"], "chosen.png", { type: "image/png" }))
    const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data })
    return !element.dispatchEvent(event)
  })

  expect(cancelled).toBe(false)
})
