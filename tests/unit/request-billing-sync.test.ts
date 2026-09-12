import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const enqueue = vi.fn()
vi.mock("@/lib/jobs", () => ({ jobs: { enqueue: (...args: unknown[]) => enqueue(...args) } }))

const { requestBillingSync } = await import("@/lib/billing/request-sync")

const ROOT = join(__dirname, "..", "..")

/**
 * The queue is not the last word on whether an operation succeeded.
 *
 * Every caller of this has already committed its real work: the connection row
 * exists, or is gone, and the ledger row went in through the database trigger
 * in the same transaction. Enqueueing with a bare `await` made a queue outage
 * look like the operation failing. It cost a live run twice in one evening — a
 * store was told its connection failed and discarded a key that worked, and a
 * disconnect that had already deleted the row raised to the error boundary and
 * told the creator their workspace could not be loaded.
 */

afterEach(() => {
  enqueue.mockReset()
  vi.restoreAllMocks()
})

describe("asking for a billing sync", () => {
  it("enqueues the job for the workspace", async () => {
    enqueue.mockResolvedValue({ id: "job_1" })

    await expect(requestBillingSync("ws_1")).resolves.toBe(true)
    expect(enqueue).toHaveBeenCalledWith("sync_billing", { workspaceId: "ws_1" })
  })

  it("does not throw when the queue refuses", async () => {
    // The shape of the outage that caused this: the queue's own API answering
    // 401 because the deployment's key names an environment that is not there.
    vi.spyOn(console, "error").mockImplementation(() => {})
    enqueue.mockRejectedValue(new Error("No matching branch env"))

    await expect(requestBillingSync("ws_1")).resolves.toBe(false)
  })

  it("says so in the log, rather than swallowing it", async () => {
    // Rule 8. "The queue refused" and "the queue is not configured" need
    // different answers, and only the queue's own words tell them apart.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    enqueue.mockRejectedValue(new Error("No matching branch env"))

    await requestBillingSync("ws_7")

    expect(logged).toHaveBeenCalledTimes(1)
    const [, detail] = logged.mock.calls[0] as [string, Record<string, unknown>]
    expect(detail.workspaceId).toBe("ws_7")
    expect(detail.message).toBe("No matching branch env")
  })

  it("survives a rejection that is not an Error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    enqueue.mockRejectedValue("nope")

    await expect(requestBillingSync("ws_1")).resolves.toBe(false)
  })
})

describe("nothing enqueues the billing sync directly any more", () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
    return out
  }

  it("routes every caller through the helper", () => {
    /*
      A bare enqueue is the bug, not a style preference: it puts the queue back
      in the path of an operation that has already committed. Five call sites
      had it, in two server actions, two OAuth routes and the billing webhook,
      and each one turned a queue outage into a different lie told to a
      different audience.
    */
    const offenders: string[] = []

    for (const dir of ["lib", "app"]) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split(sep).join("/")
        if (rel === "lib/billing/request-sync.ts") continue
        // The queue's own tests and the job declarations name the task freely.
        if (rel.startsWith("lib/jobs/") || rel.startsWith("trigger/")) continue
        if (/enqueue\(\s*["']sync_billing["']/.test(readFileSync(file, "utf8"))) {
          offenders.push(rel)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it("still has callers, so the rule above is not vacuous", () => {
    const callers = ["lib", "app"].flatMap((dir) =>
      sourceFiles(join(ROOT, dir)).filter((file) =>
        /requestBillingSync\(/.test(readFileSync(file, "utf8")),
      ),
    )

    // Four files: the two server actions live together, plus both OAuth routes
    // and the webhook, and the helper itself.
    expect(callers.length).toBeGreaterThanOrEqual(5)
  })
})
