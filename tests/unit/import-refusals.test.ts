import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/jobs", () => ({
  jobs: {
    enqueue: async () => {
      throw new Error("the default queue was reached")
    },
  },
}))

import { startImport } from "@/lib/imports/start"
import { validateSourceUrl } from "@/lib/imports/url"
import { classifyInput, initialComposerState, readiness } from "@/lib/imports/composer"

/**
 * The bad shapes are refused before anything is fetched, in words a creator
 * can act on.
 *
 * A browser test used to paste three of them and read the complaint. Which
 * shapes are refused, and why, is tests/unit/import-machine.test.ts; this is
 * the message each one carries, that the server refuses them without touching
 * the database or the queue, and that the form refuses them before it submits.
 * One of the three is still pasted in product-link-import.spec.ts.
 */

const SHAPES = [
  ["http://example.com/a", "Fanwise reads https links only. Paste the secure version of it."],
  ["https://localhost/a", "That link points somewhere Fanwise cannot reach from the internet."],
  ["https://example.com:8443/a", "Fanwise reads links on the standard https port only."],
] as const

/** A database client that fails the test if anything at all is asked of it. */
const untouchable = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`the database was touched: ${String(property)}`)
    },
  },
) as Parameters<typeof startImport>[0]["supabase"]

const refusingQueue = {
  enqueue: async () => {
    throw new Error("a job was queued")
  },
} as unknown as NonNullable<Parameters<typeof startImport>[0]["queue"]>

describe("a link the importer will not read", () => {
  it.each(SHAPES)("refuses %s and says why", (input, message) => {
    expect(validateSourceUrl(input)).toMatchObject({ ok: false, message })
  })

  it.each(SHAPES)(
    "is refused by the server before any row or job exists: %s",
    async (input, message) => {
      await expect(
        startImport({
          supabase: untouchable,
          workspaceId: "workspace-1",
          userId: "user-1",
          rawUrl: input,
          queue: refusingQueue,
        }),
      ).resolves.toEqual({ kind: "invalid", message })
    },
  )

  it.each(SHAPES)(
    "is refused by the composer before it submits, with the same message: %s",
    (input, message) => {
      // The composer reads a standalone link through the same validator, and
      // "Create draft" stays shut with the validator's own sentence as the reason.
      const typed = classifyInput(input)
      expect(typed).toEqual({ kind: "refused_link", message })
      expect(readiness(initialComposerState, typed)).toEqual({ canSubmit: false, reason: message })
    },
  )
})
