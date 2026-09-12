import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { signUp, signUpAndCreateWorkspace } from "./support"

/**
 * Settings, in the browser.
 *
 * The markup half is tests/unit/settings-page.test.ts. Everything here needs a
 * real browser to be true at all: a button that enables itself when a field
 * changes, a section that saves without touching its neighbour, a file picked
 * and staged, focus after a save, and a phone-width layout that does not scroll
 * sideways.
 */

/** A 1x1 PNG, small enough to inline and real enough to survive a sniff. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

test("the page is four sections, and Access is not one of them", async ({ page }) => {
  const { slug } = await signUp(page, "set-shape")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  await expect(main.getByRole("heading", { level: 1, name: "Studio settings" })).toBeVisible()

  const sections = main.getByRole("heading", { level: 2 })
  await expect(sections).toHaveText([
    "Studio details",
    // Public profile is a summary and a link; the identity fields live at
    // /settings/public-profile, because a page strangers read does not belong
    // in the same scroll as an email address.
    "Public profile",
    "Subscription",
    "Account",
  ])

  // The removed section, and the metadata that went with it.
  await expect(main.getByRole("table", { name: /member/i })).toHaveCount(0)
  await expect(main.getByText(/your role/i)).toHaveCount(0)
  await expect(main.getByText(/^created$/i)).toHaveCount(0)

  // One save button per section, each named for its own section.
  await expect(main.getByRole("button", { name: "Save changes" })).toHaveCount(0)
  await expect(main.getByRole("button", { name: "Save studio details" })).toHaveCount(1)
  await expect(main.getByRole("button", { name: "Save account details" })).toHaveCount(1)
  // The public profile section saves nothing here: it is a link out.
  await expect(main.getByRole("button", { name: /Save public profile/ })).toHaveCount(0)
  await expect(main.getByRole("link", { name: /public profile/i })).toHaveCount(1)

  // The shell is untouched.
  const banner = page.getByRole("banner")
  await expect(banner.getByRole("link", { name: "Products", exact: true })).toBeVisible()
  await expect(banner.getByRole("link", { name: "Channels", exact: true })).toBeVisible()
  await expect(banner.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect(banner.getByRole("button", { name: "Sign out" })).toBeVisible()
})

test("an unauthenticated visitor cannot reach settings", async ({ page }) => {
  const { slug } = await signUp(page, "set-auth")
  await page.context().clearCookies()

  await page.goto(routes.settings(slug))
  await expect(page).toHaveURL(/\/sign-in/)
  await expect(page.getByRole("heading", { level: 1, name: "Studio settings" })).toHaveCount(0)
})

test("one creator cannot open another creator's settings", async ({ browser }) => {
  const alice = await browser.newPage()
  const { slug } = await signUpAndCreateWorkspace(alice, "set-a", "Northbound Type")
  await alice.close()

  const bob = await browser.newPage()
  await signUp(bob, "set-b")
  await bob.goto(routes.settings(slug))

  // Indistinguishable from a workspace that does not exist.
  await expect(bob.getByText("Northbound Type")).toHaveCount(0)
  await expect(bob.getByRole("button", { name: "Save studio details" })).toHaveCount(0)
  await bob.close()
})

test("each save button belongs to its own section and waits for a change", async ({ page }) => {
  const { slug } = await signUp(page, "set-save")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  const studioSave = main.getByRole("button", { name: "Save studio details" })
  const accountSave = main.getByRole("button", { name: "Save account details" })

  // Nothing has changed, so neither button offers to do anything.
  await expect(studioSave).toBeDisabled()
  await expect(accountSave).toBeDisabled()

  // Typing in one section arms that section's button and only that one.
  await main.getByLabel("Workspace name").fill("Northbound Type")
  await expect(studioSave).toBeEnabled()
  await expect(accountSave).toBeDisabled()

  // And typing in the other arms the other, without disarming the first.
  await main.getByLabel("First name").fill("Lauren")
  await expect(accountSave).toBeEnabled()
  await expect(studioSave).toBeEnabled()

  // Saving the studio does not save, clear or disturb the account's changes.
  await studioSave.click()
  await expect(main.getByText("Studio details saved.")).toBeVisible()
  await expect(studioSave).toBeDisabled()
  await expect(main.getByLabel("First name")).toHaveValue("Lauren")
  await expect(accountSave).toBeEnabled()
  await expect(main.getByText("Account details saved.")).toHaveCount(0)

  // Focus stayed in the section that saved, rather than falling to the body.
  await expect(main.getByText("Studio details saved.")).toBeFocused()

  // The name really landed: the header carries it.
  await expect(page.getByRole("banner").getByText("Northbound Type")).toBeVisible()

  // Now the account's own save, which reports its own outcome.
  await accountSave.click()
  await expect(main.getByText("Account details saved.")).toBeVisible()
  await expect(accountSave).toBeDisabled()
  await expect(studioSave).toBeDisabled()
})

test("an invalid name is explained next to the field and keeps what was typed", async ({
  page,
}) => {
  const { slug } = await signUp(page, "set-valid")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  const name = main.getByLabel("Workspace name")
  await name.fill("Northbound Type")
  await expect(main.getByRole("button", { name: "Save studio details" })).toBeEnabled()

  // Blank is not a name, and the button stops offering to save it.
  await name.fill("   ")
  await expect(main.getByRole("button", { name: "Save studio details" })).toBeDisabled()
  await expect(name).toHaveValue("   ")

  // An invalid address is refused in the same way, in its own section.
  const email = main.getByLabel("Email address")
  await email.fill("not-an-address")
  await expect(main.getByRole("button", { name: "Save account details" })).toBeDisabled()
  await expect(email).toHaveValue("not-an-address")
})

test("an icon is staged, validated and only stored when the section is saved", async ({ page }) => {
  const { slug } = await signUp(page, "set-icon")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  const picker = main.getByLabel("Upload icon")
  const save = main.getByRole("button", { name: "Save studio details" })

  // A file that is not an image is refused in the browser, before any upload.
  await picker.setInputFiles({
    name: "not-an-image.png",
    mimeType: "text/plain",
    buffer: Buffer.from("this is not a png"),
  })
  await expect(main.getByText("That file is not a PNG, JPG or WebP image.")).toBeVisible()
  await expect(save).toBeDisabled()

  // A real one is staged: named in the hint, and not yet saved.
  await picker.setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: PNG })
  await expect(main.getByText(/icon\.png is ready to save/)).toBeVisible()
  await expect(save).toBeEnabled()

  await save.click()
  await expect(main.getByText("Studio details saved.")).toBeVisible()
  await expect(save).toBeDisabled()

  // It survives a reload, which is the only proof it reached storage.
  await page.reload()
  await expect(main.locator("img")).toHaveCount(1)
  await expect(main.getByRole("button", { name: "Remove" })).toBeVisible()

  // And it can be taken away again.
  await main.getByRole("button", { name: "Remove" }).click()
  await expect(main.getByText(/icon will be removed when you save/)).toBeVisible()
  await main.getByRole("button", { name: "Save studio details" }).click()
  await expect(main.getByText("Studio details saved.")).toBeVisible()
  await page.reload()
  await expect(main.locator("img")).toHaveCount(0)
})

test("the address is shown, fixed, and does not break routing", async ({ page }) => {
  const { slug } = await signUp(page, "set-addr")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  await expect(main.getByText(new RegExp(`/${slug}$`))).toBeVisible()
  await expect(main.getByRole("button", { name: "Copy" })).toBeVisible()
  await expect(main.getByText(/cannot be changed yet/)).toBeVisible()

  // It is readable and copyable, but there is nothing to type into: the studio
  // section has exactly one editable text field, and it is the name.
  const studio = main.getByRole("region", { name: "Studio details" })
  await expect(studio.locator('input[type="text"]')).toHaveCount(1)
  await expect(studio.locator('input[type="text"]')).toHaveAttribute("name", "name")
  await expect(studio.locator('input[name="slug"], input[name="address"]')).toHaveCount(0)

  // Renaming the studio leaves the address, and the workspace, exactly where
  // they were.
  await main.getByLabel("Workspace name").fill("Moved Name")
  await main.getByRole("button", { name: "Save studio details" }).click()
  await expect(main.getByText("Studio details saved.")).toBeVisible()

  await page.goto(routes.workspace(slug))
  await expect(page).toHaveURL(new RegExp(`/${slug}$`))
  await expect(page.getByRole("banner").getByText("Moved Name")).toBeVisible()
})

test("changing the email address reports a confirmation rather than a completed change", async ({
  page,
}) => {
  const { slug, email } = await signUp(page, "set-email")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  await main.getByLabel("Email address").fill("moved@fanwise.test")
  // The warning arrives before the save, not after it.
  await expect(main.getByText(/sends a confirmation link to both/)).toBeVisible()

  await main.getByRole("button", { name: "Save account details" }).click()

  /**
   * The outcome depends on whether this stack can send mail, and the local one
   * cannot: its inbucket service is not among those started. Both outcomes are
   * real and both are asserted, because the property that matters holds either
   * way: the address on the account has not moved, and the page does not claim
   * it has.
   */
  const confirmation = main.getByText(/Confirm the change to moved@fanwise\.test/)
  const failure = main.getByText(/could not be changed/)
  await expect(confirmation.or(failure)).toBeVisible()

  if (await confirmation.isVisible()) {
    // The link was sent. The account still holds the old address until both
    // ends confirm, so the field goes back to showing what actually signs in.
    await expect(main.getByText(/both have to be followed/)).toBeVisible()
    await expect(main.getByLabel("Email address")).toHaveValue(email)
  } else {
    // It was refused. What was typed survives, so it can be corrected rather
    // than retyped, and the error sits on the field that caused it.
    await expect(main.getByLabel("Email address")).toHaveValue("moved@fanwise.test")
    await expect(main.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true")
  }

  // Either way, no raw provider error reached the page (rule 8).
  await expect(main.getByText(/AuthApiError|AuthRetryableFetchError|fetch failed/)).toHaveCount(0)
})

test("changing a password sends a link rather than taking a new password here", async ({
  page,
}) => {
  const { slug, email } = await signUp(page, "set-pw")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  // No password field anywhere on the page.
  await expect(main.locator('input[type="password"]')).toHaveCount(0)

  // Before the click, the page says what the button will do.
  await expect(main.getByText(new RegExp(`secure reset link to ${email}`))).toBeVisible()

  await main.getByRole("button", { name: "Change password" }).click()

  // Sent, or honestly reported as not sent: this stack starts no mail service.
  // Either way the sentence is one Fanwise wrote, not one the provider threw.
  await expect(
    main.getByText(new RegExp(`Check ${email} for a secure link|link could not be sent`)),
  ).toBeVisible()
  await expect(main.getByText(/AuthRetryableFetchError|Error sending recovery email/)).toHaveCount(
    0,
  )
})

test("subscription shows the workspace's real state and no save button", async ({ page }) => {
  const { slug } = await signUp(page, "set-bill")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  const subscription = main.getByRole("region", { name: "Subscription" })

  // A brand new workspace is either on a trial or on a deployment with no
  // billing configured. Both are real states; neither invents a figure.
  await expect(
    subscription.getByText(/days left|Trial active|Billing is not configured/),
  ).toBeVisible()
  await expect(subscription.getByRole("button", { name: /^Save/ })).toHaveCount(0)
  await expect(subscription.getByText("Connected marketplaces")).toBeVisible()
})

test("the page is reachable by keyboard and fits a phone", async ({ page }) => {
  const { slug } = await signUp(page, "set-a11y")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  // The file input is a real input, reachable and named by the pill you see,
  // which a div-with-onclick would not be.
  await main.getByLabel("Workspace name").focus()
  await expect(main.getByLabel("Workspace name")).toBeFocused()

  await main.getByLabel("Upload icon").focus()
  await expect(main.getByLabel("Upload icon")).toBeFocused()

  // Every control is a real control: reachable, and named.
  for (const name of ["Copy", "Change password"]) {
    const control = main.getByRole("button", { name })
    await control.focus()
    await expect(control).toBeFocused()
  }

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    // The decorative fan is clipped rather than widening the document.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1)
  }
})
