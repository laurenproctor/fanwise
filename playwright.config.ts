import { execFileSync } from "node:child_process"
import { defineConfig, devices } from "@playwright/test"

// Dedicated to this suite. Not 3000, which any dev server may already hold.
const PORT = Number(process.env.E2E_PORT ?? 3399)
const BASE_URL = `http://127.0.0.1:${PORT}`

/**
 * The Supabase this suite is allowed to touch, read from the running local
 * stack rather than from the environment.
 *
 * This is not a convenience. These tests sign up users, create workspaces,
 * upload files and connect channels, and `next start` loads `.env.local` like
 * any other production build — so whatever that file points at is what the
 * suite writes to. Once `.env.local` pointed at a hosted project, a single
 * `pnpm test:e2e` put seventy-four accounts, seventy-three workspaces and
 * thirty-three stored files into it, and the only signal was that the tests got
 * slower.
 *
 * Asking the CLI for the local values makes the safe thing automatic: there is
 * no variable to remember to override, and no committed key to drift. If the
 * local stack is not running the suite refuses to start, which is the right
 * answer — the alternative is falling back to whatever `.env.local` says, and
 * that is exactly the accident this prevents.
 */
function localSupabaseEnv(): Record<string, string> {
  let raw: string
  try {
    raw = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" })
  } catch {
    throw new Error(
      "The e2e suite needs the local Supabase stack. Run `supabase start`.\n" +
        "It will not fall back to .env.local: these tests write real rows, and " +
        "that file may point at a deployed project.",
    )
  }

  const values = new Map<string, string>()
  for (const line of raw.split("\n")) {
    const at = line.indexOf("=")
    if (at > 0)
      values.set(
        line.slice(0, at).trim(),
        line
          .slice(at + 1)
          .trim()
          .replace(/^"|"$/g, ""),
      )
  }

  const apiUrl = values.get("API_URL")
  const anonKey = values.get("ANON_KEY")
  const serviceKey = values.get("SERVICE_ROLE_KEY")
  if (!apiUrl || !anonKey || !serviceKey) {
    throw new Error("`supabase status` did not report a local API URL and keys.")
  }

  // Belt and braces. If the CLI is ever linked in a way that reports a remote
  // host, stop rather than write to it.
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(apiUrl)) {
    throw new Error(`Refusing to run the e2e suite against a non-local Supabase: ${apiUrl}`)
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    NEXT_PUBLIC_APP_URL: BASE_URL,
  }
}

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
    // Real environment variables win over .env files in Next, so these override
    // whatever .env.local happens to be pointing at today.
    env: localSupabaseEnv(),
  },
})
