import { readFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { newCreator, productUrl } from "./support"

/**
 * Journey 1, the product half: a workspace, then a product in it. Signup itself
 * is journey-01-signup.spec.ts.
 *
 * Presentation that a rendered string can decide lives below the browser:
 * required-field marks are tests/unit/required-marks.test.ts, the duplicate
 * rule is tests/unit/duplicate-images.test.ts and what a drop accepts is
 * tests/unit/image-drop.test.ts. What stays here is what only a browser can
 * answer — whether a dispatched drop reaches a handler, whether the page-wide
 * guard cancels it, and whether the upload behind it lands.
 */
test("a creator gets a workspace and creates a product", async ({ page }) => {
  const { slug } = await newCreator(page, "j1p", "Northbound Type")

  // Signing in lands on the catalog directly: a workspace's root is what it sells.
  await expect(page).toHaveURL(new RegExp(`/${slug}$`))

  // An empty catalog is the first-run screen rather than a bare table.
  await expect(
    page.getByRole("heading", { level: 1, name: "Your first product starts here." }),
  ).toBeVisible()

  // Every workspace route inherits the same remembered theme from its shared
  // shell. Exercise it before moving from the catalog into the product flow.
  const beforeTheme = await page.evaluate(() => document.documentElement.dataset.theme)
  const afterTheme = beforeTheme === "dark" ? "light" : "dark"
  await page.getByRole("button", { name: `Switch to ${afterTheme} mode` }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe(afterTheme)

  await page.getByRole("link", { name: "Create first product" }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe(afterTheme)
  await page.getByLabel("Product name").fill("Aster Grotesk")
  await page.getByLabel("Product type").selectOption("font")
  await page.getByRole("button", { name: "Create product" }).click()

  await page.waitForURL(productUrl(slug))
  await expect(page.getByRole("heading", { name: "Aster Grotesk" })).toBeVisible()

  // The product is addressable under its own slug, inside the workspace slug.
  const path = new URL(page.url()).pathname
  expect(path).toMatch(productUrl(slug))

  // And it appears in the catalog, which is the dashboard now rather than the
  // first-run screen.
  await page.goto(`/${slug}`)
  // Exact: a catalog row carries two links to the same product, the name and
  // the next action, and the action's accessible name ends with the product's
  // so a screen reader can tell one row's action from another's.
  await expect(page.getByRole("link", { name: "Aster Grotesk", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Your first product starts here." })).toHaveCount(
    0,
  )
})

test("the canonical record saves and survives a reload", async ({ page }) => {
  const { slug } = await newCreator(page, "j1e", "Edit Studio")

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
async function fileTransfer(page: Page, path: string, type: string, name?: string) {
  const bytes = readFileSync(path)
  const filename = name ?? path.split("/").pop()!
  return page.evaluateHandle(
    ([data, file, mime]) => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File([new Uint8Array(data as number[])], file as string, {
          type: mime as string,
        }),
      )
      return transfer
    },
    [Array.from(bytes), filename, type] as const,
  )
}

/** Creates a product and waits for its page. */
async function createProduct(page: Page, slug: string, name: string) {
  await page.goto(`/${slug}/new`)
  await page.getByLabel("Product name").fill(name)
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))
  await expect(page.getByRole("heading", { name })).toBeVisible()
}

/**
 * Dropping images onto the product's images panel, and the guard around it.
 *
 * This is here because it broke, and it broke in the way drag-and-drop always
 * breaks: nothing at all happened, with no error anywhere. The panel had drag
 * handlers for reordering, so the gesture looked supported, and a file dropped
 * on a tile hit a handler that had no index to move and returned silently.
 *
 * The drops are dispatched with a real DataTransfer built in the page rather
 * than through `setInputFiles`, because the file input is exactly the path that
 * was already working. A test that goes through the input would have passed
 * throughout the bug.
 */
test("a creator drops an image onto the product's images panel", async ({ page }) => {
  const { slug } = await newCreator(page, "j1d", "Drop Studio")
  await createProduct(page, slug, "Dropped Product")

  /*
    The guard that stops a missed drop from replacing the page. A browser handed
    a file it was not offered opens it, discarding whatever was on screen and any
    unsaved edit with it. Playwright cannot assert on "the document was not
    replaced" — if it happens the test has already lost the page — so this
    asserts the thing that prevents it: whether the drop came back cancelled.
    `dispatchEvent` returns false when preventDefault was called.
  */
  const strayCancelled = await page.evaluate(() => {
    const data = new DataTransfer()
    data.items.add(new File(["not really a png"], "stray.png", { type: "image/png" }))
    const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data })
    return !document.body.dispatchEvent(event)
  })
  expect(strayCancelled, "a file dropped off-target is refused rather than opened").toBe(true)
  await expect(page.getByRole("heading", { name: "Dropped Product" })).toBeVisible()

  /*
    The exemption that keeps the Files section working. Dropping onto
    `<input type="file">` fills it natively, as the default action — exactly
    what the guard cancels everywhere else — so the guard steps aside there.
    Through the label rather than a raw selector, so this waits for the Files
    section to render instead of racing it.
  */
  const input = page.getByLabel("Add a file")
  await expect(input).toBeVisible()
  const inputCancelled = await input.evaluate((element) => {
    const data = new DataTransfer()
    data.items.add(new File(["not really a png"], "chosen.png", { type: "image/png" }))
    const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data })
    return !element.dispatchEvent(event)
  })
  expect(inputCancelled, "the guard leaves a native file input alone").toBe(false)

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

  /*
    The same picture again, aimed at the dashed Add-images tile — the square a
    person actually aims at. The tile is a `<label>` wrapping a hidden file
    input, so the drop lands on markup with its own ideas about files and has to
    bubble out to the section to be handled at all; the drop above never takes
    that path.

    And it is the same bytes under a name nothing would match on, which reaches
    a storefront as two identical tiles. Detected by checksum, so the copy is
    named, and it points at the cover rather than at itself.
  */
  const again = await fileTransfer(
    page,
    "tests/fixtures/small-800x600.png",
    "image/png",
    "a-completely-different-name.png",
  )
  const tile = page.getByText("Drop them here, or click")
  await expect(tile).toBeVisible()
  await tile.dispatchEvent("drop", { dataTransfer: again })

  await expect(panel.getByText("a-completely-different-name.png")).toBeVisible()
  await expect(panel.getByText("Same image as the cover")).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByText("Same image as the cover")).toHaveCount(1)
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
  const { slug } = await newCreator(page, "j1f", "Files Studio")
  await createProduct(page, slug, "Filed Product")

  await expect(page.getByText("They are added as Deliverable")).toBeVisible()

  // One outline, not two: the empty state and the file input live inside the
  // same bordered box, so the drop target is not ambiguous between them.
  const box = page.locator("div.rounded-\\[14px\\].border", { hasText: "No files yet" }).last()
  await expect(box.getByLabel("Add a file")).toBeVisible()
  await expect(box.getByText("No files yet")).toBeVisible()

  const transfer = await fileTransfer(page, "tests/fixtures/specimen-3000x2000.jpg", "image/jpeg")
  await page.getByText("No files yet").dispatchEvent("drop", { dataTransfer: transfer })

  const specimen = page.getByRole("row").filter({ hasText: "specimen-3000x2000.jpg" })
  await expect(specimen).toBeVisible()
  // Filed as the selected type, not guessed from the file being an image.
  await expect(specimen).toContainText("Deliverable")

  /*
    The hazard this section has and the images panel does not. "Add a file" is
    a visible native file input inside the drop zone; filling it fires change,
    which uploads, so a section handler that also claimed the same file would
    upload it twice. One file in, one row out.
  */
  await page.getByLabel("Add a file").setInputFiles("tests/fixtures/small-800x600.png")
  await expect(page.getByRole("row").filter({ hasText: "small-800x600.png" })).toHaveCount(1)
  await expect(specimen).toHaveCount(1)
})
