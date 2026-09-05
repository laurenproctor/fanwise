import { readFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
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
 * A DataTransfer carrying one file, built inside the page.
 *
 * Playwright cannot perform an operating-system drag, so a dispatched event
 * with a real DataTransfer is the closest available thing. It exercises the
 * handlers and the whole upload path behind them; it does not prove the
 * browser's own drag machinery hands the panel what it expects. Worth knowing
 * when one of these passes and a person still reports the gesture failing.
 */
async function fileTransfer(page: Page, path: string, type: string) {
  const bytes = readFileSync(path)
  const name = path.split("/").pop()!
  return page.evaluateHandle(
    ([data, filename, mime]) => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File([new Uint8Array(data as number[])], filename as string, {
          type: mime as string,
        }),
      )
      return transfer
    },
    [Array.from(bytes), name, type] as const,
  )
}

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
  const transfer = await fileTransfer(page, "tests/fixtures/small-800x600.png", "image/png")

  // Onto the body of the panel, away from the dashed tile: a file dropped an
  // inch wide of the target is the ordinary case, not the exotic one.
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

/**
 * The same drop, aimed at the dashed tile itself.
 *
 * Added after the fix, because the fix's own test dropped on the body of the
 * panel and this is the square a person actually aims at — it is the one thing
 * on screen that says "put a file here". The tile is a `<label>` wrapping a
 * hidden `<input type="file">`, so the drop lands on markup with its own ideas
 * about files and has to bubble out to the section to be handled at all.
 * Nothing in the panel-body test covers that path.
 */
test("a creator drops an image onto the dashed Add-images tile", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1t", "Tile Studio")

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Tiled Product")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))

  const transfer = await fileTransfer(page, "tests/fixtures/small-800x600.png", "image/png")

  const tile = page.getByText("Drop them here, or click")
  await expect(tile).toBeVisible()
  await tile.dispatchEvent("drop", { dataTransfer: transfer })

  await expect(
    page.getByRole("region", { name: "Images" }).getByText("small-800x600.png"),
  ).toBeVisible()
})

/**
 * The Files section takes a drop too, and files it as the selected type.
 *
 * A drop carries no answer to "what kind of file is this", so it uses whatever
 * File type is selected. That is the only sane mapping — there is nothing else
 * to read it from — but it means the type must be visible before the drop, not
 * discovered in the table afterwards, which is what the hint is for.
 */
test("a creator drops a file into the Files section", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1f", "Files Studio")

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Filed Product")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))

  await expect(page.getByText("They are added as Deliverable")).toBeVisible()

  const transfer = await fileTransfer(page, "tests/fixtures/specimen-3000x2000.jpg", "image/jpeg")
  await page.getByText("No files yet").dispatchEvent("drop", { dataTransfer: transfer })

  const row = page.getByRole("row").filter({ hasText: "specimen-3000x2000.jpg" })
  await expect(row).toBeVisible()
  // Filed as the selected type, not guessed from the file being an image.
  await expect(row).toContainText("Deliverable")
})

/**
 * The hazard this section has and the images panel does not.
 *
 * "Add a file" is a visible native file input sitting inside the drop zone.
 * Dropping straight onto it fills it natively, which fires change, which
 * uploads — so a section handler that also claimed that drop would upload the
 * same file twice. Both this section and the root guard step aside for file
 * inputs, and this is the test that says the exemptions agree.
 */
test("a file dropped on the input itself uploads once, not twice", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "j1u", "Once Studio")

  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill("Once Product")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))

  const input = page.getByLabel("Add a file")
  await input.setInputFiles("tests/fixtures/small-800x600.png")

  await expect(page.getByRole("row").filter({ hasText: "small-800x600.png" })).toHaveCount(1)
})
