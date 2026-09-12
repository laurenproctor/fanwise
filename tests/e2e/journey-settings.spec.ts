import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { newCreator } from "./support"

/**
 * Settings, in the browser.
 *
 * The markup half is tests/unit/settings-page.test.ts: the four sections and
 * their order, that Access is gone, one save button per section, the address
 * shown with no field to edit it, and no password input anywhere. Everything
 * here needs a real browser to be true at all: a button that enables itself
 * when a field changes, a section that saves without touching its neighbour, a
 * file picked and staged, focus after a save, and a phone-width layout that
 * does not scroll sideways.
 *
 * Who may open settings is not a question for this page. A signed-out visitor
 * is turned away by the proxy (tests/unit/proxy.test.ts) and by the page's own
 * check (tests/unit/settings-page.test.ts); another creator's settings sit
 * under the same workspace layout that journey-09-tenancy.spec.ts proves
 * answers 404, over rows tests/db/tenancy.test.ts proves they cannot read.
 */

/** A 1x1 PNG, small enough to inline and real enough to survive a sniff. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

test("each save button belongs to its own section and waits for a change", async ({ page }) => {
  const { slug } = await newCreator(page, "set-save")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  const studioSave = main.getByRole("button", { name: "Save studio details" })
  const accountSave = main.getByRole("button", { name: "Save account details" })

  // Nothing has changed, so neither button offers to do anything.
  await expect(studioSave).toBeDisabled()
  await expect(accountSave).toBeDisabled()

  // An invalid value is refused in its own section, and what was typed is kept.
  // Blank is not a name, and the button stops offering to save it.
  const name = main.getByLabel("Workspace name")
  await name.fill("Northbound Type")
  await expect(studioSave).toBeEnabled()
  await name.fill("   ")
  await expect(studioSave).toBeDisabled()
  await expect(name).toHaveValue("   ")
  const email = main.getByLabel("Email address")
  const original = await email.inputValue()
  await email.fill("not-an-address")
  await expect(accountSave).toBeDisabled()
  await expect(email).toHaveValue("not-an-address")
  await email.fill(original)

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

  // The address is shown, fixed and copyable, and renaming the studio left it,
  // and the workspace, exactly where they were.
  await expect(page).toHaveURL(new RegExp(`/${slug}/settings$`))
  await expect(main.getByText(new RegExp(`/${slug}$`))).toBeVisible()
  await expect(main.getByRole("button", { name: "Copy" })).toBeVisible()

  // Now the account's own save, which reports its own outcome.
  await accountSave.click()
  await expect(main.getByText("Account details saved.")).toBeVisible()
  await expect(accountSave).toBeDisabled()
  await expect(studioSave).toBeDisabled()
})

test("an icon is staged, validated and only stored when the section is saved", async ({ page }) => {
  const { slug } = await newCreator(page, "set-icon")
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

test("changing the email address reports a confirmation rather than a completed change", async ({
  page,
}) => {
  const { slug, email } = await newCreator(page, "set-email")
  await page.goto(routes.settings(slug))
  const main = page.getByRole("main")

  // A password change sends a link rather than taking a new password here. Sent,
  // or honestly reported as not sent: this stack starts no mail service. Either
  // way the sentence is one Fanwise wrote, not one the provider threw.
  await expect(main.getByText(new RegExp(`secure reset link to ${email}`))).toBeVisible()
  await main.getByRole("button", { name: "Change password" }).click()
  await expect(
    main.getByText(new RegExp(`Check ${email} for a secure link|link could not be sent`)),
  ).toBeVisible()
  await expect(main.getByText(/AuthRetryableFetchError|Error sending recovery email/)).toHaveCount(
    0,
  )

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

test("subscription shows the workspace's real state and no save button", async ({ page }) => {
  const { slug } = await newCreator(page, "set-bill")
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

  // Every control is a real control, reachable and named: the file input is a
  // real input named by the pill you see, which a div-with-onclick would not be.
  for (const control of [
    main.getByLabel("Workspace name"),
    main.getByLabel("Upload icon"),
    main.getByRole("button", { name: "Copy" }),
    main.getByRole("button", { name: "Change password" }),
  ]) {
    await control.focus()
    await expect(control).toBeFocused()
  }

  // And the page fits a phone and a tablet: the decorative fan is clipped
  // rather than widening the document.
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1)
  }
})
