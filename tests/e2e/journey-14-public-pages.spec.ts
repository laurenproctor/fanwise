import { expect, test, type Page } from "@playwright/test"
import { newCreator, productUrl } from "./support"
import { routes } from "@/lib/routes"

/**
 * Journey 14. A creator claims a public address, publishes a product to it, and
 * a stranger with no account reads the page.
 *
 * The whole point of this journey is the second half. Everything before it is
 * setup done as a signed-in creator; the assertions that matter are made in a
 * browser context with no session at all, because a public page that only
 * works for the person who made it is the failure this feature is most likely
 * to have and the least likely to notice. `page.context().clearCookies()` is
 * not enough for that — a Server Component reads cookies at render — so the
 * anonymous half runs in its own context.
 *
 * It also holds the two rules that make publishing safe:
 *
 *   - Nothing is public until somebody published it. A draft profile and a
 *     draft product both answer 404, with the same words a URL that never
 *     existed gets.
 *   - A published product under a draft profile is not public. This is the one
 *     a creator gets wrong, and the one enforced in the database rather than
 *     in a component.
 *
 * Below the browser: every path the handle routing must leave alone, and every
 * canonicalisation it performs, is tests/unit/public-routing.test.ts; that the
 * proxy answers them with a 308 and turns a stranger away from the application
 * is tests/unit/proxy.test.ts; every handle rule and its message is
 * tests/unit/public-handles.test.ts; robots is tests/unit/robots.test.ts. What
 * stays here is the rewrite, the redirects and the sitemap as a stranger meets
 * them from a running server.
 */

const SETUP_TIMEOUT = 20_000

/** Claims a handle and returns it. The profile is left a draft. */
async function createProfile(page: Page, slug: string): Promise<string> {
  await page.goto(routes.publicProfileSettings(slug))
  await page.getByRole("button", { name: "Create a public profile" }).click()

  await expect(page.getByRole("heading", { name: "Public profile", level: 1 })).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })

  const handle = await page.getByLabel("Handle").inputValue()
  expect(handle.length).toBeGreaterThan(2)
  return handle
}

async function setHandle(page: Page, slug: string, handle: string): Promise<void> {
  await page.goto(routes.publicProfileSettings(slug))
  await page.getByLabel("Handle").fill(handle)
  await page.getByRole("button", { name: "Save public profile" }).click()
  await expect(page.getByText("Public profile saved.")).toBeVisible({ timeout: SETUP_TIMEOUT })
}

async function setProfilePublished(page: Page, slug: string, published: boolean): Promise<void> {
  await page.goto(routes.publicProfileSettings(slug))
  await page
    .getByRole("button", { name: published ? "Publish profile" : "Unpublish", exact: true })
    .click()
  await expect(
    page.getByText(published ? "Anyone with the link can see" : "Only you can see this profile"),
  ).toBeVisible({ timeout: SETUP_TIMEOUT })
}

/** Creates a product and returns its path in the application. */
async function createProduct(page: Page, slug: string, name: string): Promise<string> {
  await page.goto(routes.newProduct(slug))
  await page.getByLabel("Product name").fill(name)
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(productUrl(slug))
  return new URL(page.url()).pathname
}

async function createPublicPage(page: Page, productPath: string): Promise<void> {
  await page.goto(productPath)
  await page.getByRole("button", { name: "Create a public page" }).click()
  await expect(page.getByRole("button", { name: "Publish page" })).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })
}

async function setPagePublished(
  page: Page,
  productPath: string,
  published: boolean,
): Promise<void> {
  await page.goto(productPath)
  await page
    .getByRole("button", { name: published ? "Publish page" : "Unpublish", exact: true })
    .click()
  await expect(
    page.getByText(
      published ? /This page is live|Published, but not visible/ : /Only you can see this page/,
    ),
  ).toBeVisible({ timeout: SETUP_TIMEOUT })
}

test("a creator publishes a profile and a stranger reads it", async ({ page, browser }) => {
  const creator = await newCreator(page, "j14", "Northline Studio")

  const handle = await createProfile(page, creator.slug)
  const productPath = await createProduct(page, creator.slug, "Aster Grotesk")
  await createPublicPage(page, productPath)

  // --- Nothing is public yet -------------------------------------------
  const stranger = await browser.newContext()
  const visitor = await stranger.newPage()

  const draftProfile = await visitor.goto(`/@${handle}`)
  expect(draftProfile?.status(), "a draft profile is not public").toBe(404)
  await expect(visitor.getByText("This page does not exist")).toBeVisible()
  // Nothing of the studio leaks through the 404.
  await expect(visitor.getByText("Northline Studio")).toHaveCount(0)

  // --- A published product under a draft profile is still not public ----
  await setPagePublished(page, productPath, true)

  const orphan = await visitor.goto(`/@${handle}/aster-grotesk`)
  expect(orphan?.status(), "a published page under a draft profile is not public").toBe(404)
  await expect(visitor.getByText("Aster Grotesk")).toHaveCount(0)

  // The editor says so rather than letting the creator believe otherwise.
  await page.goto(productPath)
  await expect(page.getByText("Published, but not visible")).toBeVisible()

  // --- Publishing the profile opens both, with no second write ----------
  await setProfilePublished(page, creator.slug, true)

  const live = await visitor.goto(`/@${handle}`)
  expect(live?.status()).toBe(200)
  await expect(visitor.getByRole("heading", { name: "Northline Studio", level: 1 })).toBeVisible()
  await expect(visitor.getByRole("link", { name: /Aster Grotesk/ })).toBeVisible()

  // The product page too, reached the way a visitor reaches it.
  await visitor
    .getByRole("link", { name: /Aster Grotesk/ })
    .first()
    .click()
  await expect(visitor).toHaveURL(new RegExp(`/@${handle}/aster-grotesk$`))
  await expect(visitor.getByRole("heading", { name: "Aster Grotesk", level: 1 })).toBeVisible()

  // Back to the creator, through the breadcrumb.
  await visitor.getByRole("link", { name: "Northline Studio" }).first().click()
  await expect(visitor).toHaveURL(new RegExp(`/@${handle}$`))

  // --- A crawler finds the address and not the rewrite target --------------
  // Both files are fetched as a stranger: they were once behind the session
  // check, which a crawler reads as "this site has no sitemap".
  const sitemap = await visitor.goto("/sitemap.xml")
  expect(sitemap?.status()).toBe(200)
  const xml = (await sitemap?.text()) ?? ""
  expect(xml).toContain(`/@${handle}`)
  expect(xml).not.toContain("/profile/")
  const robots = await visitor.goto("/robots.txt")
  expect(robots?.status()).toBe(200)
  expect(await robots?.text()).toContain("/profile/")

  await visitor.goto(`/@${handle}`)

  // --- Nothing private is on the page ------------------------------------
  const body = (await visitor.locator("body").textContent()) ?? ""
  expect(body).not.toContain(creator.email)
  expect(body).not.toContain(creator.slug)
  for (const word of ["Sign out", "Settings", "Billing", "Subscription"]) {
    expect(body, `${word} belongs to the application, not to a public page`).not.toContain(word)
  }

  await stranger.close()
})

test("renaming a handle leaves the old address working", async ({ page, browser }) => {
  const creator = await newCreator(page, "j14rename", "Moving Studio")
  const before = await createProfile(page, creator.slug)
  await setProfilePublished(page, creator.slug, true)

  // A reserved handle is refused while the creator types, and Save stays shut.
  // Scoped to the field's own error node rather than to the words: the hint
  // under the field uses them too, and Next's route announcer is a second
  // role="alert" on every page. The other rules and their messages are
  // tests/unit/public-handles.test.ts.
  await page.goto(routes.publicProfileSettings(creator.slug))
  await page.getByLabel("Handle").fill("fanwise")
  await expect(page.locator('p[role="alert"]').first()).toHaveText(/reserved/i)
  await expect(page.getByRole("button", { name: "Save public profile" })).toBeDisabled()

  const after = `moved-${Date.now().toString(36)}`.slice(0, 32)
  await setHandle(page, creator.slug, after)

  const stranger = await browser.newContext()
  const visitor = await stranger.newPage()

  // The new address serves the page.
  const fresh = await visitor.goto(`/@${after}`)
  expect(fresh?.status()).toBe(200)
  await expect(visitor.getByRole("heading", { name: "Moving Studio", level: 1 })).toBeVisible()

  // The old one still resolves, to the new address rather than to a 404.
  await visitor.goto(`/@${before}`)
  expect(new URL(visitor.url()).pathname).toBe(`/@${after}`)
  await expect(visitor.getByRole("heading", { name: "Moving Studio", level: 1 })).toBeVisible()

  // The public URL keeps its shape. A capitalised handle and a trailing slash
  // fold onto the canonical address rather than serving a second copy, and the
  // internal rewrite target is not an address anybody can stay at.
  for (const variant of [`/@${after.toUpperCase()}`, `/@${after}/`, `/profile/${after}`]) {
    await visitor.goto(variant)
    expect(new URL(visitor.url()).pathname, variant).toBe(`/@${after}`)
  }

  // The canonical tag agrees with the address bar, so the two cannot be
  // indexed separately.
  const canonical = await visitor.locator('link[rel="canonical"]').getAttribute("href")
  expect(canonical).toContain(`/@${after}`)

  await stranger.close()
})

test("unpublishing removes the page from the public web", async ({ page, browser }) => {
  const creator = await newCreator(page, "j14unpub", "Vanishing Studio")
  const handle = await createProfile(page, creator.slug)
  const productPath = await createProduct(page, creator.slug, "Ephemeral Sans")
  await createPublicPage(page, productPath)
  await setPagePublished(page, productPath, true)
  await setProfilePublished(page, creator.slug, true)

  const stranger = await browser.newContext()
  const visitor = await stranger.newPage()

  expect((await visitor.goto(`/@${handle}`))?.status()).toBe(200)
  expect((await visitor.goto(`/@${handle}/ephemeral-sans`))?.status()).toBe(200)

  await setProfilePublished(page, creator.slug, false)

  // Both, from one write. The product page was never unpublished itself.
  expect((await visitor.goto(`/@${handle}`))?.status(), "the profile is gone").toBe(404)
  expect(
    (await visitor.goto(`/@${handle}/ephemeral-sans`))?.status(),
    "the product goes with it",
  ).toBe(404)

  await stranger.close()
})
