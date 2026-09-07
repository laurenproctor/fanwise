import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { InMemoryQueue, JOB_NAMES, TriggerQueue, selectQueue } from "@/lib/jobs"
import type { JobName } from "@/lib/jobs"

/**
 * The queue chosen at B1, and the seam that chooses it.
 *
 * Nothing here talks to Trigger.dev. What is proved is that the selection
 * follows the secret key, that an enqueue becomes one trigger with the
 * caller's delivery key and a short TTL, and that every job name has a task
 * to run it — the last by reading trigger/jobs.ts rather than importing it,
 * so the check does not depend on the vendor's module doing anything at
 * import time.
 */

const ROOT = join(__dirname, "..", "..")

describe("selectQueue", () => {
  it("keeps the in-process queue when no secret is set", () => {
    expect(selectQueue({})).toBeInstanceOf(InMemoryQueue)
    expect(selectQueue({ TRIGGER_SECRET_KEY: "   " })).toBeInstanceOf(InMemoryQueue)
  })

  it("chooses the durable queue when the secret is set", () => {
    expect(selectQueue({ TRIGGER_SECRET_KEY: "tr_dev_x" })).toBeInstanceOf(TriggerQueue)
  })
})

describe("TriggerQueue", () => {
  it("triggers the task named after the job with the caller's delivery key", async () => {
    const trigger = vi.fn(async () => ({ id: "run_1" }))
    const queue = new TriggerQueue({ trigger })

    const job = await queue.enqueue(
      "publish_listing",
      { workspaceId: "w", publicationJobId: "p" },
      { idempotencyKey: "p:0" },
    )

    expect(trigger).toHaveBeenCalledWith(
      "publish_listing",
      { workspaceId: "w", publicationJobId: "p" },
      { idempotencyKey: "p:0", idempotencyKeyTTL: "1h" },
    )
    expect(job.id).toBe("run_1")
    expect(job.idempotencyKey).toBe("p:0")
  })

  it("passes a delay in whole seconds and omits an absent key", async () => {
    const trigger = vi.fn(async () => ({ id: "run_2" }))
    const queue = new TriggerQueue({ trigger })
    await queue.enqueue("noop", { message: "m" }, { delayMs: 1500 })
    expect(trigger).toHaveBeenCalledWith("noop", { message: "m" }, { delay: "2s" })
  })
})

describe("trigger/jobs.ts", () => {
  const source = readFileSync(join(ROOT, "trigger", "jobs.ts"), "utf8")
  const declared = [...source.matchAll(/id: "([a-z_]+)"/g)].map((m) => m[1] as JobName)

  it("declares exactly one task per job name", () => {
    expect([...declared].sort()).toEqual([...JOB_NAMES].sort())
  })

  it("runs each task through the shared handler for that name", () => {
    for (const name of JOB_NAMES) {
      expect(source, name).toContain(`handlers.${name}(payload)`)
    }
  })
})
