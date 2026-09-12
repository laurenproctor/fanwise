import { expect, test, type Page } from "@playwright/test"
import { productUrl, signOut, signUpAndCreateWorkspace } from "./support"
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
  const creator = await signUpAndCreateWorkspace(page, "j14", "Northline Studio")

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

  // --- Nothing private is on the page ------------------------------------
  const body = (await visitor.locator("body").textContent()) ?? ""
  expect(body).not.toContain(creator.email)
  expect(body).not.toContain(creator.slug)
  for (const word of ["Sign out", "Settings", "Billing", "Subscription"]) {
    expect(body, `${word} belongs to the application, not to a public page`).not.toContain(word)
  }

  await stranger.close()
})

test("the public URL keeps its shape, and the internal one is not a second address", async ({
  page,
  browser,
}) => {
  const creator = await signUpAndCreateWorkspace(page, "j14url", "Shape Studio")
  const handle = await createProfile(page, creator.slug)
  await setProfilePublished(page, creator.slug, true)

  const stranger = await browser.newContext()
  const visitor = await stranger.newPage()

  // The address bar keeps the @ form; the rewrite is invisible.
  await visitor.goto(`/@${handle}`)
  expect(new URL(visitor.url()).pathname).toBe(`/@${handle}`)

  // A capitalised handle folds onto the canonical one rather than serving a
  // second copy of the page.
  await visitor.goto(`/@${handle.toUpperCase()}`)
  expect(new URL(visitor.url()).pathname).toBe(`/@${handle}`)

  // A trailing slash, likewise.
  await visitor.goto(`/@${handle}/`)
  expect(new URL(visitor.url()).pathname).toBe(`/@${handle}`)

  // And the internal rewrite target is not an address anybody can stay at.
  await visitor.goto(`/profile/${handle}`)
  expect(new URL(visitor.url()).pathname).toBe(`/@${handle}`)

  // The canonical tag agrees with the address bar, so the two cannot be
  // indexed separately.
  const canonical = await visitor.locator('link[rel="canonical"]').getAttribute("href")
  expect(canonical).toContain(`/@${handle}`)

  await stranger.close()
})

test("renaming a handle leaves the old address working", async ({ page, browser }) => {
  const creator = await signUpAndCreateWorkspace(page, "j14rename", "Moving Studio")
  const before = await createProfile(page, creator.slug)
  await setProfilePublished(page, creator.slug, true)

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

  await stranger.close()
})

test("unpublishing removes the page from the public web", async ({ page, browser }) => {
  const creator = await signUpAndCreateWorkspace(page, "j14unpub", "Vanishing Studio")
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

test("a reserved or malformed handle is refused while the creator types", async ({ page }) => {
  const creator = await signUpAndCreateWorkspace(page, "j14valid", "Careful Studio")
  await createProfile(page, creator.slug)

  await page.goto(routes.publicProfileSettings(creator.slug))
  const handle = page.getByLabel("Handle")
  const save = page.getByRole("button", { name: "Save public profile" })

  // Scoped to the field's own error node, not to the text and not to the
  // alert role. The hint under the field says "lowercase letters, numbers and
  // hyphens" too — that is what the hint is for — so matching on the words
  // finds both and proves neither, and Next's route announcer is a second
  // element with role="alert" on every page.
  const error = page.locator('p[role="alert"]').first()

  await handle.fill("fanwise")
  await expect(error).toHaveText(/reserved/i)
  await expect(save).toBeDisabled()

  await handle.fill("no")
  await expect(error).toHaveText(/at least 3 characters/i)
  await expect(save).toBeDisabled()

  await handle.fill("Not A Handle")
  await expect(error).toHaveText(/lowercase letters, numbers and hyphens/i)
  await expect(save).toBeDisabled()

  await handle.fill("north--line")
  await expect(error).toHaveText(/cannot start or end with a hyphen/i)
  await expect(save).toBeDisabled()

  // And a valid one re-enables it.
  await handle.fill(`careful-${Date.now().toString(36)}`.slice(0, 32))
  await expect(save).toBeEnabled()
})

test("the marketing site and the application still resolve alongside the public web", async ({
  page,
  browser,
}) => {
  const creator = await signUpAndCreateWorkspace(page, "j14routes", "Coexist Studio")
  const handle = await createProfile(page, creator.slug)
  await setProfilePublished(page, creator.slug, true)

  // The application, as the signed-in creator, at its unchanged address.
  expect((await page.goto(routes.workspace(creator.slug)))?.status()).toBe(200)
  await expect(page.getByRole("link", { name: "Products", exact: true })).toBeVisible()

  await signOut(page)

  const stranger = await browser.newContext()
  const visitor = await stranger.newPage()

  for (const path of ["/", "/pricing", "/how-it-works", "/terms", "/privacy", "/sign-in"]) {
    const response = await visitor.goto(path)
    expect(response?.status(), `${path} should still resolve`).toBe(200)
  }

  // The API and the static assets are untouched by the rewrite.
  expect((await visitor.goto("/api/health"))?.status()).toBe(200)
  expect((await visitor.goto("/theme.js"))?.status()).toBe(200)
  expect((await visitor.goto("/robots.txt"))?.status()).toBe(200)

  // The sitemap lists the published profile and excludes the internal path.
  const sitemap = await visitor.goto("/sitemap.xml")
  expect(sitemap?.status()).toBe(200)
  const xml = (await sitemap?.text()) ?? ""
  expect(xml).toContain(`/@${handle}`)
  expect(xml).not.toContain("/profile/")

  // And robots keeps crawlers off the rewrite target.
  const robots = await (await visitor.goto("/robots.txt"))?.text()
  expect(robots).toContain("/profile/")

  // The private application still requires a session.
  await visitor.goto(routes.workspace(creator.slug))
  await expect(visitor).toHaveURL(/\/sign-in$/)

  await stranger.close()
})
