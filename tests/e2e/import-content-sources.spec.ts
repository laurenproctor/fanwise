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
 * tests/unit/import-content-sources.test.ts, and the recovery a file is offered
 * is rendered there too. Two journeys stay here because only the integrated
 * path proves them: a paste goes through the action, storage and the job to the
 * screen, and a PDF goes through a signed upload the browser makes itself.
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
