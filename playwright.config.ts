import { defineConfig, devices } from "@playwright/test"

// Dedicated to this suite. Not 3000, which any dev server may already hold.
const PORT = Number(process.env.E2E_PORT ?? 3399)
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Pinned to a dedicated port, and never reused. A stray `next dev` on 3000
    // belonging to another project must not be mistaken for the app under test:
    // that failure mode is silent and the results look real.
    command: `pnpm build && pnpm exec next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_PUBLIC_APP_URL: BASE_URL },
  },
})
