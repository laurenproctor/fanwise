import { createClient } from "@supabase/supabase-js"
import { expect, test, type Browser, type Page } from "@playwright/test"
import { signOut, signUp, signUpAndCreateWorkspace } from "./support"
import { routes } from "@/lib/routes"

/**
 * Journey 14. A creator builds a public profile, publishes it, and a stranger
 * with no account reads it.
 *
 * The first test is the whole journey through the three-step builder: details
 * with a live preview, products chosen and reordered, a draft recovered after
 * a refresh, publish, the public page matching the final preview, an edit that
 * stays a draft until "Publish updates", and a second account refused the
 * first account's draft. It is deliberately the only builder journey; the
 * rules it passes through are unit- and database-tested on their own
 * (tests/unit/profile-builder-*.test.ts, tests/unit/profile-publish.test.ts,
 * tests/db/profile-drafts-tenancy.test.ts, tests/db/profile-publication.test.ts).
 *
 * The rest hold the public web's routing contract — the address shape, renames,
 * unpublishing, reserved handles, and coexistence with the app — using the
 * builder only as setup.
 *
 * Every anonymous assertion runs in its own browser context:
 * `page.context().clearCookies()` is not enough, because a Server Component
 * reads cookies at render.
 */

const SETUP_TIMEOUT = 20_000

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * The local stack's service role, from the environment the Playwright config
 * exports. Used only to put products live on a channel, which in the product
 * is an adapter round trip this journey is not about.
 */
function localAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Journey 14 needs the local Supabase env the config exports.")
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(`Refusing to seed against a non-local Supabase: ${url}`)
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

/** Creates products with a verified, live listing each, so they are eligible for a profile. */
async function seedLiveProducts(slug: string, names: string[]): Promise<void> {
  const db = localAdmin()
  const { data: workspace } = await db.from("workspaces").select("id").eq("slug", slug).single()
  const { data: channels } = await db.from("channels").select("id, key")
  const channelId = channels!.find((c) => c.key === "mock_api")!.id
  const { data: connection, error: connectionError } = await db
    .from("channel_connections")
    .insert({
      workspace_id: workspace!.id,
      channel_id: channelId,
      external_account_id: `j14-${slug}`,
      status: "active",
    })
    .select("id")
    .single()
  if (connectionError) throw connectionError

  for (const [index, name] of names.entries()) {
    const productSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    const { data: product, error } = await db
      .from("products")
      .insert({
        workspace_id: workspace!.id,
        name,
        slug: productSlug,
        product_type: "template",
      })
      .select("id")
      .single()
    if (error) throw error
    const { error: listingError } = await db.from("channel_listings").insert({
      workspace_id: workspace!.id,
      product_id: product.id,
      channel_id: channelId,
      channel_connection_id: connection.id,
      title: name,
      status: "published",
      status_source: "verified",
      // Unique per channel across every workspace, so it carries the slug.
      external_listing_id: `j14-${slug}-${index}`,
      external_url: `https://example.com/${productSlug}`,
    })
    if (listingError) throw listingError
  }
}

/** Opens step 1 from Settings, creating the profile if there is none. */
async function openBuilder(page: Page, slug: string): Promise<void> {
  await page.goto(routes.publicProfileSettings(slug))
  const create = page.getByRole("button", { name: "Create a public profile" })
  const edit = page.getByRole("link", { name: /Build your profile|Edit public profile/ })
  // Wait for the page to decide which one it is showing before choosing.
  await expect(create.or(edit)).toBeVisible({ timeout: SETUP_TIMEOUT })
  if (await create.isVisible()) {
    await create.click()
  } else {
    await edit.click()
  }
  await page.waitForURL(/\/settings\/public-profile\/builder$/)
  await expect(page.getByRole("heading", { name: "Build your profile" })).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })
}

/** From step 1, saves and walks through to step 3, then publishes. Returns the handle. */
async function publishFromDetails(page: Page): Promise<string> {
  const handle = await page.getByLabel("Studio address").inputValue()
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: SETUP_TIMEOUT })
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL(/\/builder\/products$/)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL(/\/builder\/publish$/)
  await page.getByRole("button", { name: /^Publish (profile|updates)$/ }).click()
  await expect(page.getByText(/Published\. Your profile is live\./)).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })
  return handle
}

/** A fresh profile, published with the suggested address. Returns the handle. */
async function publishProfile(page: Page, slug: string): Promise<string> {
  await openBuilder(page, slug)
  // The suggestion is valid as it stands; typing a character and removing it
  // makes the first autosave store the draft.
  const address = page.getByLabel("Studio address")
  const suggested = await address.inputValue()
  await address.fill(`${suggested}x`)
  await address.fill(suggested)
  return publishFromDetails(page)
}

async function stranger(browser: Browser) {
  const context = await browser.newContext()
  return { context, visitor: await context.newPage() }
}

const rowTitles = (page: Page) =>
  page
    .locator("[data-row-id]")
    .evaluateAll((rows) =>
      rows.map((row) => row.querySelector("span.text-\\[16px\\]")?.textContent?.trim() ?? ""),
    )

/** Product titles as the shared renderer draws them, in order. */
const renderedTitles = (scope: Page, within = "article") =>
  scope.locator(`${within} #profile-products li span.text-\\[15px\\]`).allTextContents()

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

test("a creator builds, publishes and updates a profile, and a stranger reads it", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1100 })

  const creator = await signUpAndCreateWorkspace(page, "j14", "Northline Studio")
  await seedLiveProducts(creator.slug, ["Aster Grotesk", "Campaign Kit", "Brand Workbook"])
  const handle = `northline-${Date.now().toString(36)}`.slice(0, 32)
  const preview = page.locator("article").first()

  // 1. Settings → Public profile ------------------------------------------
  await page.goto(routes.settings(creator.slug))
  await page.getByRole("link", { name: "Set up a public profile" }).click()
  await page.waitForURL(new RegExp(`${routes.publicProfileSettings(creator.slug)}$`))
  await page.getByRole("button", { name: "Create a public profile" }).click()
  await page.waitForURL(/\/builder$/)

  // 2–3. Profile details, with the preview following the typing -----------
  await page.getByLabel("Studio address").fill(handle)
  await page.getByLabel("Studio name").fill("Northline Studio")
  await page.getByLabel("Short introduction").fill("Independent type for expressive brands.")
  await page.getByLabel("Website").fill("northline.example")

  await expect(preview.getByRole("heading", { name: "Northline Studio" })).toBeVisible()
  await expect(preview).toContainText("Independent type for expressive brands.")
  await expect(page.getByText(`/@${handle}`).first()).toBeVisible()
  await expect(page.getByText("Available", { exact: true })).toBeVisible({ timeout: SETUP_TIMEOUT })
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: SETUP_TIMEOUT })

  // 4–5. Manage products: hide one, move one --------------------------------
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL(/\/builder\/products$/)
  await expect(page.getByText("3 of 3 selected")).toBeVisible()

  await page.getByRole("switch", { name: "Show Brand Workbook on your profile" }).click()
  await expect(page.getByText("2 of 3 selected")).toBeVisible()

  const before = await rowTitles(page)
  const last = before.filter((t) => t !== "Brand Workbook").at(-1)!
  await page.getByRole("button", { name: new RegExp(`^Reorder ${last}`) }).focus()
  await page.keyboard.press("Home")
  const arranged = await rowTitles(page)
  expect(arranged[0]).toBe(last)
  const expectedOrder = arranged.filter((t) => t !== "Brand Workbook")
  await expect.poll(() => renderedTitles(page)).toEqual(expectedOrder)
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: SETUP_TIMEOUT })

  // 6. Refresh recovers the draft -------------------------------------------
  await page.reload()
  await expect(page.getByText("2 of 3 selected")).toBeVisible()
  expect(await rowTitles(page)).toEqual(arranged)

  // 7. Preview and publish --------------------------------------------------
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL(/\/builder\/publish$/)
  await expect(page.getByRole("heading", { name: "Your profile is ready" })).toBeVisible()
  const finalPreview = await renderedTitles(page)
  expect(finalPreview).toEqual(expectedOrder)

  const { context, visitor } = await stranger(browser)
  expect((await visitor.goto(`/@${handle}`))?.status(), "nothing is public before Publish").toBe(
    404,
  )

  // 8. Publish ----------------------------------------------------------------
  await page.getByRole("button", { name: "Publish profile" }).click()
  await expect(page.getByText("Published. Your profile is live.")).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })
  await expect(page.getByRole("link", { name: /View public profile/ })).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible()

  // 9–10. The public page matches the final preview ---------------------------
  const live = await visitor.goto(`/@${handle}`)
  expect(live?.status()).toBe(200)
  await expect(visitor.getByRole("heading", { name: "Northline Studio", level: 1 })).toBeVisible()
  await expect(visitor.locator("article")).toContainText("Independent type for expressive brands.")
  expect(await renderedTitles(visitor)).toEqual(finalPreview)
  expect(await visitor.locator("article").textContent()).not.toContain("Brand Workbook")
  const body = (await visitor.locator("body").textContent()) ?? ""
  expect(body).not.toContain(creator.email)
  expect(body).not.toContain(creator.slug)
  for (const word of ["Sign out", "Billing", "Subscription"]) expect(body).not.toContain(word)

  // 11–13. An edit stays a draft ----------------------------------------------
  await page.getByRole("link", { name: "Edit profile" }).click()
  await page.waitForURL(/\/builder$/)
  await page.getByLabel("Short introduction").fill("Type, updated.")
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: SETUP_TIMEOUT })

  await visitor.reload()
  await expect(visitor.locator("article")).toContainText("Independent type for expressive brands.")
  await expect(visitor.locator("article")).not.toContainText("Type, updated.")

  // 14–15. Publish updates changes the live page --------------------------------
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL(/\/builder\/products$/)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL(/\/builder\/publish$/)
  await page.getByRole("button", { name: "Publish updates" }).click()
  await expect(page.getByText("Published. Your profile is live.")).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })

  await visitor.reload()
  await expect(visitor.locator("article")).toContainText("Type, updated.")
  await context.close()

  // 16. Another account cannot reach this draft ---------------------------------
  const other = await browser.newContext()
  const intruder = await other.newPage()
  await signUp(intruder, "j14-intruder")
  for (const path of [
    routes.publicProfileBuilder(creator.slug),
    routes.publicProfileBuilderPublish(creator.slug),
  ]) {
    const response = await intruder.goto(path)
    expect(response?.status(), `${path} is not another account's to open`).toBe(404)
    await expect(intruder.locator("body")).not.toContainText("Type, updated.")
  }
  const probe = await intruder.request.get(
    routes.publicProfileHandleAvailability(creator.slug, "x-y-z"),
  )
  expect(probe.status()).toBe(404)
  await other.close()

  // And signed out, the builder is behind sign-in.
  const { context: anonContext, visitor: anon } = await stranger(browser)
  await anon.goto(routes.publicProfileBuilder(creator.slug))
  await expect(anon).toHaveURL(/\/sign-in$/)
  await anonContext.close()
})

// ---------------------------------------------------------------------------
// The public web's routing contract
// ---------------------------------------------------------------------------

test("the public URL keeps its shape, and the internal one is not a second address", async ({
  page,
  browser,
}) => {
  const creator = await signUpAndCreateWorkspace(page, "j14url", "Shape Studio")
  const handle = await publishProfile(page, creator.slug)

  const { context, visitor } = await stranger(browser)

  await visitor.goto(`/@${handle}`)
  expect(new URL(visitor.url()).pathname).toBe(`/@${handle}`)

  await visitor.goto(`/@${handle.toUpperCase()}`)
  expect(new URL(visitor.url()).pathname).toBe(`/@${handle}`)

  await visitor.goto(`/@${handle}/`)
  expect(new URL(visitor.url()).pathname).toBe(`/@${handle}`)

  await visitor.goto(`/profile/${handle}`)
  expect(new URL(visitor.url()).pathname).toBe(`/@${handle}`)

  const canonical = await visitor.locator('link[rel="canonical"]').getAttribute("href")
  expect(canonical).toContain(`/@${handle}`)

  await context.close()
})

test("renaming a published handle leaves the old address working", async ({ page, browser }) => {
  const creator = await signUpAndCreateWorkspace(page, "j14rename", "Moving Studio")
  const before = await publishProfile(page, creator.slug)

  const after = `moved-${Date.now().toString(36)}`.slice(0, 32)
  await openBuilder(page, creator.slug)
  await page.getByLabel("Studio address").fill(after)
  await publishFromDetails(page)

  const { context, visitor } = await stranger(browser)
  expect((await visitor.goto(`/@${after}`))?.status()).toBe(200)
  await expect(visitor.getByRole("heading", { name: "Moving Studio", level: 1 })).toBeVisible()

  await visitor.goto(`/@${before}`)
  expect(new URL(visitor.url()).pathname).toBe(`/@${after}`)
  await context.close()
})

test("unpublishing removes the profile and its product pages from the public web", async ({
  page,
  browser,
}) => {
  const creator = await signUpAndCreateWorkspace(page, "j14unpub", "Vanishing Studio")
  await seedLiveProducts(creator.slug, ["Ephemeral Sans"])
  const handle = await publishProfile(page, creator.slug)

  const { context, visitor } = await stranger(browser)
  expect((await visitor.goto(`/@${handle}`))?.status()).toBe(200)
  expect((await visitor.goto(`/@${handle}/ephemeral-sans`))?.status()).toBe(200)

  await page.goto(routes.publicProfileSettings(creator.slug))
  await page.getByRole("button", { name: "Unpublish" }).click()
  await expect(page.getByText("Only you can see this profile")).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })

  expect((await visitor.goto(`/@${handle}`))?.status(), "the profile is gone").toBe(404)
  expect(
    (await visitor.goto(`/@${handle}/ephemeral-sans`))?.status(),
    "the product goes with it",
  ).toBe(404)
  await context.close()
})

test("a reserved or malformed address is refused while the creator types", async ({ page }) => {
  const creator = await signUpAndCreateWorkspace(page, "j14valid", "Careful Studio")
  await openBuilder(page, creator.slug)

  const address = page.getByLabel("Studio address")

  await address.fill("fanwise")
  await expect(page.getByText(/reserved by Fanwise/i)).toBeVisible()

  await address.fill("north.line")
  await expect(page.getByText(/lowercase letters, numbers and hyphens only/i)).toBeVisible()

  await address.fill("north--line")
  await expect(page.getByText(/cannot start or end with a hyphen/i)).toBeVisible()

  await address.fill(`careful-${Date.now().toString(36)}`.slice(0, 32))
  await expect(page.getByText("Available", { exact: true })).toBeVisible({ timeout: SETUP_TIMEOUT })
})

test("the marketing site and the application still resolve alongside the public web", async ({
  page,
  browser,
}) => {
  const creator = await signUpAndCreateWorkspace(page, "j14routes", "Coexist Studio")
  const handle = await publishProfile(page, creator.slug)

  expect((await page.goto(routes.workspace(creator.slug)))?.status()).toBe(200)
  await expect(page.getByRole("link", { name: "Products", exact: true })).toBeVisible()

  await signOut(page)

  const { context, visitor } = await stranger(browser)

  for (const path of ["/", "/pricing", "/how-it-works", "/terms", "/privacy", "/sign-in"]) {
    const response = await visitor.goto(path)
    expect(response?.status(), `${path} should still resolve`).toBe(200)
  }

  expect((await visitor.goto("/api/health"))?.status()).toBe(200)
  expect((await visitor.goto("/theme.js"))?.status()).toBe(200)
  expect((await visitor.goto("/robots.txt"))?.status()).toBe(200)

  const sitemap = await visitor.goto("/sitemap.xml")
  expect(sitemap?.status()).toBe(200)
  const xml = (await sitemap?.text()) ?? ""
  expect(xml).toContain(`/@${handle}`)
  expect(xml).not.toContain("/profile/")

  const robots = await (await visitor.goto("/robots.txt"))?.text()
  expect(robots).toContain("/profile/")

  await visitor.goto(routes.workspace(creator.slug))
  await expect(visitor).toHaveURL(/\/sign-in$/)

  await context.close()
})
