import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { newCreator } from "./support"

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
 * What only a browser can answer is what this covers: a pasted link really
 * does create an import and land on it, the failure a creator actually sees has
 * a way out of it, a second paste of the same page opens the same import, and
 * the screen widens without scrolling sideways at the widths the rest of the
 * suite uses.
 *
 * Below the browser: every refused link shape and its message is
 * tests/unit/import-machine.test.ts; that a signed-out visitor is turned away
 * from both import routes is tests/unit/proxy.test.ts; that no route but the
 * importer asks for the wide canvas is tests/unit/import-screen.test.ts; and
 * that one workspace cannot read, insert or update another's import is
 * tests/db/product-import.test.ts.
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

test("the importer opens from the new-product page and says what it is", async ({ page }) => {
  const { slug } = await newCreator(page, "imp1", "Import Studio")

  await page.goto(routes.newProduct(slug))
  await page.getByRole("link", { name: "Import a product from a link" }).click()

  await expect(page).toHaveURL(new RegExp(`${slug}/new/link$`))
  await expect(
    page.getByRole("heading", { name: "Create a product listing", level: 1 }),
  ).toBeVisible()
  await expect(
    page.getByText(
      "Add anything you already have. Fanwise will organize it into an editable draft.",
    ),
  ).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible()

  // The shared shell is untouched on this route: the workspace header, which is
  // the only way out of the page, is still above it.
  await expect(page.getByRole("link", { name: /Import Studio/ })).toBeVisible()

  // One composer, one action, and what happens next said before anything is added.
  await expect(page.getByRole("button", { name: "Create draft" })).toHaveAttribute(
    "aria-disabled",
    "true",
  )
  await expect(page.getByText("Nothing is published until you review it.")).toBeVisible()

  // A bad shape is refused in the composer, before anything is fetched.
  await page.getByLabel("Product link or description").fill("http://example.com/a")
  await expect(page.getByText(/https links only/).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Create draft" })).toHaveAttribute(
    "aria-disabled",
    "true",
  )
  await expect(page).toHaveURL(new RegExp(`${slug}/new/link$`))

  // One centred column that never scrolls sideways, in either theme.
  for (const theme of ["light", "dark"] as const) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} mode` })
    if (await toggle.isVisible()) await toggle.click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await expect(
        page.getByRole("heading", { name: "Create a product listing", level: 1 }),
      ).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${theme} at ${width}px scrolls sideways`).toBeLessThanOrEqual(0)
    }
  }

  await page.setViewportSize({ width: 1600, height: 900 })
  const composerWidth = await page
    .getByRole("form", { name: "Product sources" })
    .evaluate((form) => form.getBoundingClientRect().width)
  expect(composerWidth).toBeLessThanOrEqual(960)
})

test("a pasted link becomes an import that survives a refresh", async ({ page }) => {
  const { slug } = await newCreator(page, "imp3", "Pipeline Studio")
  await page.goto(routes.importProduct(slug))

  await page.getByLabel("Product link or description").fill(UNREACHABLE)
  await page.getByRole("button", { name: "Create draft" }).click()

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

  // An import id that is not this workspace's is not found rather than
  // forbidden: indistinguishable from an id that was never real, which is what
  // stops a probe confirming one.
  await page.goto(`/${slug}/new/link/11111111-1111-4111-8111-111111111111`)
  await expect(page.getByText(/not found/i).first()).toBeVisible()
})

test("a failed import can be retried, and readiness never claims the source is done", async ({
  page,
}) => {
  const { slug } = await newCreator(page, "imp4", "Retry Studio")
  await page.goto(routes.importProduct(slug))

  await page.getByLabel("Product link or description").fill(UNREACHABLE)
  await page.getByRole("button", { name: "Create draft" }).click()
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
  const { slug } = await newCreator(page, "imp5", "Idempotent Studio")

  await page.goto(routes.importProduct(slug))
  await page.getByLabel("Product link or description").fill(UNREACHABLE)
  await page.getByRole("button", { name: "Create draft" }).click()
  await expect(page).toHaveURL(new RegExp(`${slug}/new/link/[0-9a-f-]{36}$`), { timeout: 20_000 })
  const first = page.url()

  // The same page again, with the tracking parameters and the trailing slash a
  // second paste usually carries. Same page, so the same import.
  await page.goto(routes.importProduct(slug))
  await page.getByLabel("Product link or description").fill(`${UNREACHABLE}/?utm_source=newsletter`)
  await page.getByRole("button", { name: "Create draft" }).click()
  await expect(page).toHaveURL(new RegExp(`${slug}/new/link/[0-9a-f-]{36}$`), { timeout: 20_000 })

  expect(page.url()).toBe(first)

  // And exactly one product came of it.
  await page.goto(routes.workspace(slug))
  await expect(page.getByRole("link", { name: "A Product", exact: true })).toHaveCount(1)
})
