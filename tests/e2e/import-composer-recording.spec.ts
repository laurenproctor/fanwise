import { expect, test } from "@playwright/test"
import { routes } from "@/lib/routes"
import { newCreator } from "./support"

/**
 * A recording, from Record to Transcribed to a draft.
 *
 * Chromium's fake microphone supplies the audio and the suite's fixed
 * transcript stands in for a vendor (see lib/ai/transcription, which allows it
 * only against a local database). Everything between is real: MediaRecorder,
 * the signed upload, the server's sniff of the stored bytes, the transcription
 * job and the status poll. In its own file because the fake device is a launch
 * option, which is per worker.
 */

test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
})

test("a recording is transcribed before it becomes a source", async ({ page }) => {
  const { slug } = await newCreator(page, "rec1", "Voice Studio")
  await page.goto(routes.importProduct(slug))

  await page.getByRole("button", { name: "Record" }).click()
  await expect(page.getByText("Recording", { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(1_500)
  await page.getByRole("button", { name: "Stop" }).click()

  const pills = page.getByRole("list", { name: "Added sources" })
  await expect(pills.getByText(/Product notes · 00:0\d/)).toBeVisible({ timeout: 10_000 })
  await expect(pills.getByText("Transcribed")).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: "Create draft" }).click()
  await expect(page).toHaveURL(new RegExp(`${slug}/new/link/[0-9a-f-]{36}$`), { timeout: 20_000 })
  const sources = page.getByRole("region", { name: /Your source/ })
  await expect(sources.getByText("Transcribed")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Canvas tote in natural cotton/).first()).toBeVisible({
    timeout: 30_000,
  })
})
