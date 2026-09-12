import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { signUpAndCreateWorkspace } from "./support"

/**
 * Importing a product from a public link, in a browser.
 *
 * **Nothing here reaches a real website, and that is deliberate rather than a
 * limitation.** The pipeline's behaviour — what each status means, what a
 * sign-in wall looks like, what a redirect into a private network does, what
 * the body cap refuses — is proven in `tests/unit/import-retrieval.test.ts`,
 * which drives the production outbound boundary with a scripted socket. That is
 * a stronger test than a browser hitting a live site, and it does not go quiet
 * when somebody else's server has an outage.
 *
 * What only a browser can answer is what this covers: the route is reachable
 * while signed in and not otherwise, a pasted link really does create an import
 * and land on it, the failure a creator actually sees has a way out of it, and
 * the screen widens without scrolling sideways at the widths the rest of the
 * suite uses.
 *
 * The one link it pastes is under `.invalid`, which RFC 2606 reserves and no
 * resolver will ever answer. So the job runs the whole way through — action,
 * queue, runner, outbound boundary, error mapping, screen — and the host it
 * cannot reach is one that cannot exist.
 */

/** Reserved by RFC 2606. Guaranteed never to resolve, from any network. */
const UNREACHABLE = "https://fanwise-import.invalid/a-product"

/** The widths tests/e2e/catalog.spec.ts already uses, plus a wide desktop. */
const WIDTHS = [320, 390, 768, 1280, 1600]

test("a signed-out visitor cannot reach the importer", async ({ page }) => {
  await page.goto(routes.importProduct("someone-elses-studio"))
  await expect(page).toHaveURL(/\/sign-in/)
})

test("a signed-out visitor cannot reach somebody's import", async ({ page }) => {
  await page.goto("/someone-elses-studio/new/link/11111111-1111-4111-8111-111111111111")
  await expect(page).toHaveURL(/\/sign-in/)
})

test("an import id from another workspace is not found rather than forbidden", async ({ page }) => {
  // Indistinguishable from an id that was never real, which is what stops a
  // probe confirming one.
  const { slug } = await signUpAndCreateWorkspace(page, "impt", "Tenancy Studio")
  await page.goto(`/${slug}/new/link/11111111-1111-4111-8111-111111111111`)
  await expect(page.getByText(/not found/i).first()).toBeVisible()
})

test("the importer opens from the new-product page and says what it is", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp1", "Import Studio")

  await page.goto(routes.newProduct(slug))
  await page.getByRole("link", { name: "Import a product from a link" }).click()

  await expect(page).toHaveURL(new RegExp(`${slug}/new/link$`))
  await expect(page.getByRole("heading", { name: "Import a product", level: 1 })).toBeVisible()
  await expect(
    page.getByText(
      "Turn a product page, a document, or text you already have into an editable Fanwise listing.",
    ),
  ).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible()

  // The shared shell is untouched on this route: the workspace header, which is
  // the only way out of the page, is still above it.
  await expect(page.getByRole("link", { name: /Import Studio/ })).toBeVisible()

  // What Fanwise will and will not do, said before anything is pasted.
  await expect(page.getByText("Run, unpack or preview code it downloads.")).toBeVisible()
})

test("the bad shapes are refused before anything is fetched", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp2", "Validation Studio")
  await page.goto(routes.importProduct(slug))

  const field = page.getByLabel("Product link")
  for (const [input, fragment] of [
    ["http://example.com/a", "https links only"],
    ["https://localhost/a", "cannot reach from the internet"],
    ["https://example.com:8443/a", "standard https port"],
  ] as const) {
    await field.fill(input)
    await page.getByRole("button", { name: "Analyze product" }).click()
    // Next's own route announcer is a role="alert" on every page, so the
    // complaint is located by what it says rather than by its role alone.
    await expect(page.getByRole("alert").filter({ hasText: fragment })).toBeVisible()
    // Nothing was imported, so the field is still a field.
    await expect(page).toHaveURL(new RegExp(`${slug}/new/link$`))
  }
})

test("a pasted link becomes an import that survives a refresh", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp3", "Pipeline Studio")
  await page.goto(routes.importProduct(slug))

  await page.getByLabel("Product link").fill(UNREACHABLE)
  await page.getByRole("button", { name: "Analyze product" }).click()

  // The id is in the URL, which is what makes the next part possible.
  await expect(page).toHaveURL(new RegExp(`${slug}/new/link/[0-9a-f-]{36}$`), { timeout: 20_000 })
  const url = page.url()

  // The whole pipeline ran: the job read nothing, mapped the failure, and the
  // screen is showing a recovery rather than a spinner that never ends.
  await expect(page.getByRole("heading", { name: "That did not finish" })).toBeVisible({
    timeout: 30_000,
  })

  // Closing the tab and coming back lands on the same import, from the
  // database rather than from anything the page was holding.
  await page.goto(url)
  await expect(page.getByRole("heading", { name: "That did not finish" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Continue manually" })).toBeVisible()
})

test("a failed import can be retried, and readiness never claims the source is done", async ({
  page,
}) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp4", "Retry Studio")
  await page.goto(routes.importProduct(slug))

  await page.getByLabel("Product link").fill(UNREACHABLE)
  await page.getByRole("button", { name: "Analyze product" }).click()
  await expect(page.getByRole("heading", { name: "That did not finish" })).toBeVisible({
    timeout: 30_000,
  })

  // The source step is not complete, so the gate is shut and says why.
  const progress = page.getByRole("progressbar")
  await expect(progress).toHaveAttribute("aria-valuenow", "0")
  await expect(page.getByRole("button", { name: "Review marketplace drafts" })).toHaveAttribute(
    "aria-disabled",
    "true",
  )
  await expect(page.getByText(/Complete \d+ required items? to continue\./)).toBeVisible()

  await page.getByRole("button", { name: "Try again" }).click()
  // It goes back through the reader rather than doing nothing, and settles
  // again on a host that still does not exist.
  await expect(page.getByRole("heading", { name: "That did not finish" })).toBeVisible({
    timeout: 30_000,
  })
})

test("importing the same link twice opens the import that exists", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp5", "Idempotent Studio")

  await page.goto(routes.importProduct(slug))
  await page.getByLabel("Product link").fill(UNREACHABLE)
  await page.getByRole("button", { name: "Analyze product" }).click()
  await expect(page).toHaveURL(new RegExp(`${slug}/new/link/[0-9a-f-]{36}$`), { timeout: 20_000 })
  const first = page.url()

  // The same page again, with the tracking parameters and the trailing slash a
  // second paste usually carries. Same page, so the same import.
  await page.goto(routes.importProduct(slug))
  await page.getByLabel("Product link").fill(`${UNREACHABLE}/?utm_source=newsletter`)
  await page.getByRole("button", { name: "Analyze product" }).click()
  await expect(page).toHaveURL(new RegExp(`${slug}/new/link/[0-9a-f-]{36}$`), { timeout: 20_000 })

  expect(page.url()).toBe(first)

  // And exactly one product came of it.
  await page.goto(routes.workspace(slug))
  await expect(page.getByRole("link", { name: "A Product", exact: true })).toHaveCount(1)
})

test("the screen widens without ever scrolling sideways", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp6", "Width Studio")

  for (const theme of ["light", "dark"] as const) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(routes.importProduct(slug))

      const toggle = page.getByRole("button", { name: `Switch to ${theme} mode` })
      if (await toggle.isVisible()) await toggle.click()

      await expect(page.getByRole("heading", { name: "Import a product", level: 1 })).toBeVisible()

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${theme} at ${width}px scrolls sideways`).toBeLessThanOrEqual(0)
    }
  }
})

test("the gutters are the wide ones on a desktop and the narrow ones on a phone", async ({
  page,
}) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp7", "Gutter Studio")
  await page.goto(routes.importProduct(slug))

  async function gutter(): Promise<number> {
    return page.evaluate(() => {
      const main = document.querySelector("main")
      if (!main) throw new Error("no main")
      return Number.parseFloat(getComputedStyle(main).paddingLeft)
    })
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  expect(await gutter()).toBeGreaterThanOrEqual(48)

  await page.setViewportSize({ width: 1600, height: 900 })
  expect(await gutter()).toBe(64)

  await page.setViewportSize({ width: 390, height: 900 })
  expect(await gutter()).toBe(24)
})

test("no other route was widened", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "imp8", "Untouched Studio")
  await page.setViewportSize({ width: 1600, height: 900 })

  for (const route of [routes.workspace(slug), routes.newProduct(slug), routes.channels(slug)]) {
    await page.goto(route)
    const width = await page.evaluate(() => {
      const main = document.querySelector("main")
      if (!main) throw new Error("no main")
      return main.getBoundingClientRect().width
    })
    // The reading column, unchanged: 1160 plus its own 24px gutters.
    expect(width, `${route} was widened`).toBeLessThanOrEqual(1160)
  }
})
