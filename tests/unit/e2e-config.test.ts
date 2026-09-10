import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { InMemoryQueue, selectQueue } from "@/lib/jobs"

/**
 * The E2E suite must never reach the hosted project, and there are two roads
 * to it: the database, which playwright.config.ts pins to the local stack, and
 * the job queue, which it pins to the in-process one. This test holds the
 * second pin from both ends: the config hands the web server an empty
 * TRIGGER_SECRET_KEY (a real variable, so it beats the checkout's .env.local),
 * and lib/jobs treats an empty key as no key. Remove either half and a local
 * E2E run in a checkout with a .env.local sends its uploads and connections to
 * the cloud queue, whose worker runs them against whatever that file names.
 */

const ROOT = join(__dirname, "..", "..")

describe("the e2e suite runs its jobs in process", () => {
  it("playwright.config.ts empties the Trigger.dev variables for the web server", () => {
    const config = readFileSync(join(ROOT, "playwright.config.ts"), "utf8")
    const env = config.slice(config.indexOf("function localSupabaseEnv"))
    expect(env).toMatch(/^\s+TRIGGER_SECRET_KEY: "",$/m)
    expect(env).toMatch(/^\s+TRIGGER_PROJECT_REF: "",$/m)
  })

  it("lib/jobs selects the in-process queue for an empty or blank key", () => {
    expect(selectQueue({ TRIGGER_SECRET_KEY: "" })).toBeInstanceOf(InMemoryQueue)
    expect(selectQueue({ TRIGGER_SECRET_KEY: "   " })).toBeInstanceOf(InMemoryQueue)
    expect(selectQueue({})).toBeInstanceOf(InMemoryQueue)
  })
})
