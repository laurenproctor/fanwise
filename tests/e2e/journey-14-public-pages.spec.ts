import { expect, test, type Browser, type Page } from "@playwright/test"
import { localAdmin, newCreator } from "./support"
import { routes } from "@/lib/routes"

/**
 * Journey 14. A creator builds a public profile, publishes it, and a stranger
 * with no account reads it.
 *
 * The first test is the whole journey through the three-step builder: details
 * with a live preview, products chosen and reordered, a draft recovered after
 * a refresh, publish, the public page matching the final preview, an edit that
 * stays a draft until "Publish updates", and another account refused the
 * first account's draft. It is deliberately the only builder journey.
 *
 * Every anonymous assertion runs in its own browser context:
 * `page.context().clearCookies()` is not enough, because a Server Component
 * reads cookies at render.
 *
 * Below the browser: the builder's rules are tests/unit/profile-builder-*.test.ts
 * and tests/unit/profile-publish.test.ts; publishing's atomicity, idempotency and
 * authorization are tests/db/profile-publication.test.ts, and draft isolation
 * tests/db/profile-drafts-tenancy.test.ts. Every path the handle routing must
 * leave alone, and every canonicalisation it performs, is
 * tests/unit/public-routing.test.ts; that the proxy answers them with a 308 and
 * turns a stranger away from the application is tests/unit/proxy.test.ts; every
 * handle rule and its message is tests/unit/public-handles.test.ts; robots is
 * tests/unit/robots.test.ts. What stays here is the path as a creator and a
 * stranger meet it from a running server.
 */

const SETUP_TIMEOUT = 20_000

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Products with a verified, live listing each, so they are eligible for a
 * profile. In the product that is an adapter round trip this journey is not
 * about, so it is written with the local service role.
 */
async function seedLiveProducts(slug: string, names: string[]): Promise<void> {
  const db = localAdmin()
  const { data: workspace } = await db.from("workspaces").select("id").eq("slug", slug).single()
  const { data: channels } = await db.from("channels").select("id, key")
  const channelId = (channels as Array<{ id: string; key: string }>).find(
    (c) => c.key === "mock_api",
  )!.id
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

/** From step 1, walks to step 3 and publishes. Returns the handle. */
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
  // The suggestion is valid as it stands; changing it and back makes the first
  // autosave store the draft.
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
const renderedTitles = (scope: Page) =>
  scope.locator("article #profile-products li span.text-\\[15px\\]").allTextContents()

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

test("a creator builds, publishes and updates a profile, and a stranger reads it", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1100 })

  const creator = await newCreator(page, "j14", "Northline Studio")
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
  await page.getByLabel("Website", { exact: true }).fill("northline.example")

  await expect(preview.getByRole("heading", { name: "Northline Studio" })).toBeVisible()
  await expect(preview).toContainText("Independent type for expressive brands.")
  await expect(page.getByText(`/@${handle}`).first()).toBeVisible()
  await expect(page.getByText("Available", { exact: true })).toBeVisible({
    timeout: SETUP_TIMEOUT,
  })
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
  const draft = await visitor.goto(`/@${handle}`)
  expect(draft?.status(), "nothing is public before Publish").toBe(404)
  await expect(visitor.getByText("Northline Studio")).toHaveCount(0)

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
  for (const word of ["Sign out", "Settings", "Billing", "Subscription"]) {
    expect(body, `${word} belongs to the application, not to a public page`).not.toContain(word)
  }

  // A crawler finds the address and not the rewrite target. Both files are
  // fetched as a stranger: they were once behind the session check, which a
  // crawler reads as "this site has no sitemap".
  const sitemap = await visitor.goto("/sitemap.xml")
  expect(sitemap?.status()).toBe(200)
  const xml = (await sitemap?.text()) ?? ""
  expect(xml).toContain(`/@${handle}`)
  expect(xml).not.toContain("/profile/")
  const robots = await visitor.goto("/robots.txt")
  expect(robots?.status()).toBe(200)
  expect(await robots?.text()).toContain("/profile/")

  // 11–13. An edit stays a draft ----------------------------------------------
  await page.getByRole("link", { name: "Edit profile" }).click()
  await page.waitForURL(/\/builder$/)
  await page.getByLabel("Short introduction").fill("Type, updated.")
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: SETUP_TIMEOUT })

  await visitor.goto(`/@${handle}`)
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
  await newCreator(intruder, "j14-intruder")
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
})

// ---------------------------------------------------------------------------
// Renames and unpublishing
// ---------------------------------------------------------------------------

test("renaming a handle leaves the old address working", async ({ page, browser }) => {
  const creator = await newCreator(page, "j14rename", "Moving Studio")
  const before = await publishProfile(page, creator.slug)

  // A reserved address is refused while the creator types. The other rules
  // and their messages are tests/unit/public-handles.test.ts and
  // tests/unit/profile-builder-model.test.ts.
  await openBuilder(page, creator.slug)
  await page.getByLabel("Studio address").fill("fanwise")
  await expect(page.getByText(/reserved by Fanwise/i)).toBeVisible()

  const after = `moved-${Date.now().toString(36)}`.slice(0, 32)
  await page.getByLabel("Studio address").fill(after)
  await publishFromDetails(page)

  const { context, visitor } = await stranger(browser)

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

  await context.close()
})

test("unpublishing removes the page from the public web", async ({ page, browser }) => {
  const creator = await newCreator(page, "j14unpub", "Vanishing Studio")
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

  // Both, from one write. The product page was never unpublished itself.
  expect((await visitor.goto(`/@${handle}`))?.status(), "the profile is gone").toBe(404)
  expect(
    (await visitor.goto(`/@${handle}/ephemeral-sans`))?.status(),
    "the product goes with it",
  ).toBe(404)

  await context.close()
})
