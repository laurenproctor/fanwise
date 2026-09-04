import { describe, expect, it, vi } from "vitest"
import { InMemoryQueue } from "@/lib/jobs"
import type { JobHandlers } from "@/lib/jobs"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * The queue is generic over every declared job. These tests only exercise noop,
 * so the rest are stubs; JobHandlers stays exhaustive on purpose, so adding a
 * job name is a compile error until it has a handler.
 */
const stubs = {
  finalize_asset: async () => {},
  build_derivative: async () => {},
} satisfies Omit<JobHandlers, "noop">

describe("job queue", () => {
  it("runs the handler for an enqueued job", async () => {
    const noop = vi.fn(async () => {})
    const queue = new InMemoryQueue({ noop, ...stubs })

    await queue.enqueue("noop", { message: "hello" })
    await flush()

    expect(noop).toHaveBeenCalledWith({ message: "hello" })
  })

  it("enqueues the same idempotency key only once", async () => {
    const noop = vi.fn(async () => {})
    const queue = new InMemoryQueue({ noop, ...stubs })

    const first = await queue.enqueue("noop", { message: "a" }, { idempotencyKey: "k1" })
    const second = await queue.enqueue("noop", { message: "b" }, { idempotencyKey: "k1" })
    await flush()

    expect(second.id).toBe(first.id)
    expect(noop).toHaveBeenCalledTimes(1)
    expect(noop).toHaveBeenCalledWith({ message: "a" })
  })

  it("treats different idempotency keys as different jobs", async () => {
    const noop = vi.fn(async () => {})
    const queue = new InMemoryQueue({ noop, ...stubs })

    await queue.enqueue("noop", { message: "a" }, { idempotencyKey: "k1" })
    await queue.enqueue("noop", { message: "b" }, { idempotencyKey: "k2" })
    await flush()

    expect(noop).toHaveBeenCalledTimes(2)
  })

  it("does not let a failing handler reject the enqueue", async () => {
    const noop = vi.fn(async () => {
      throw new Error("boom")
    })
    const queue = new InMemoryQueue({ noop, ...stubs })
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(queue.enqueue("noop", { message: "x" })).resolves.toBeDefined()
    await flush()

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
