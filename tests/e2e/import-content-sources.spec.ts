import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { buildPdf } from "../unit/import-pdf-fixture"
import { signUpAndCreateWorkspace } from "./support"

/**
 * Importing a product from pasted text, a PDF and an HTML file, in a browser.
 *
 * Unlike a link, none of these needs the network, so nothing is seeded: the
 * paste or the upload goes through the real action, into the local storage
 * bucket, through the in-process queue and the real reader, and the screen
 * shows what the job wrote. No model is configured for the suite, so each
 * import settles with the evidence and no draft, which is a state the screen
 * already says plainly.
 *
 * What the readers do with awkward input is covered in
 * tests/unit/import-content-sources.test.ts. This covers the path a creator
 * takes and the two things only a browser shows: that a handed-over source is
 * never offered a link to replace, and that "paste the text instead" goes
 * somewhere.
 */

const IMPORT_URL = (slug: string) => new RegExp(`${slug}/new/link/[0-9a-f-]{36}$`)

test("pasted text becomes an import that shows what it said", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "impt1", "Paste Studio")
  await page.goto(routes.importProduct(slug))
  await page.getByRole("link", { name: "Paste text" }).click()
  await expect(page).toHaveURL(/from=text$/)

  await page
    .getByLabel("Product text")
    .fill(
      "Aster Grotesk\n\nA six-weight grotesque for screens, with matching italics.\n\n- Variable weight axis\n- Extended Latin coverage",
    )
  await page.getByRole("button", { name: "Analyze text" }).click()

  await expect(page).toHaveURL(IMPORT_URL(slug), { timeout: 20_000 })
  await expect(page.getByRole("heading", { name: "What Fanwise found" })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText("Aster Grotesk").first()).toBeVisible()
  await expect(page.getByText("Pasted text").first()).toBeVisible()
  // A paste has no link, so nothing offers to replace one.
  await expect(page.getByRole("button", { name: "Replace link" })).toHaveCount(0)
})

test("an uploaded PDF becomes an import titled from the document", async ({ page }) => {
  const { slug } = await signUpAndCreateWorkspace(page, "impt2", "Document Studio")
  await page.goto(`${routes.importProduct(slug)}?from=pdf`)

  await page.getByLabel("PDF file").setInputFiles({
    name: "aster-specimen.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(
      buildPdf(["Aster Grotesk specimen", "A six-weight grotesque for screens and print."], {
        title: "Aster Grotesk",
      }),
    ),
  })
  await page.getByRole("button", { name: "Analyze PDF" }).click()

  await expect(page).toHaveURL(IMPORT_URL(slug), { timeout: 20_000 })
  await expect(page.getByRole("heading", { name: "What Fanwise found" })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText("aster-specimen.pdf")).toBeVisible()
  await expect(page.getByText("1 page, kept private")).toBeVisible()
})

test("an HTML file that is only script is refused with a way to paste instead", async ({
  page,
}) => {
  const { slug } = await signUpAndCreateWorkspace(page, "impt3", "Shell Studio")
  await page.goto(`${routes.importProduct(slug)}?from=html`)

  await page.getByLabel("HTML file").setInputFiles({
    name: "artifact.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script>render()</script></body></html>',
    ),
  })
  await page.getByRole("button", { name: "Analyze HTML file" }).click()

  await expect(page).toHaveURL(IMPORT_URL(slug), { timeout: 20_000 })
  await expect(page.getByRole("heading", { name: "Fanwise cannot read that" })).toBeVisible({
    timeout: 30_000,
  })
  // Link-only recoveries are not offered for a file.
  await expect(page.getByRole("button", { name: "Paste a different link" })).toHaveCount(0)

  await page.getByRole("link", { name: "Paste the text instead" }).click()
  await expect(page).toHaveURL(/from=text$/)
  await expect(page.getByLabel("Product text")).toBeVisible()
})
