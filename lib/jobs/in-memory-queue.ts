import type {
  EnqueueOptions,
  EnqueuedJob,
  JobHandlers,
  JobName,
  JobPayloads,
  JobQueue,
} from "./types"

/**
 * In-process queue for step A0. Runs handlers on the next tick.
 *
 * Not durable, not distributed, and not suitable for external writes. It exists
 * so application code can depend on the JobQueue interface from day one without
 * taking a vendor dependency before there is a job worth queueing.
 */
export class InMemoryQueue implements JobQueue {
  private seen = new Map<string, EnqueuedJob>()

  constructor(private readonly handlers: JobHandlers) {}

  async enqueue<K extends JobName>(
    name: K,
    payload: JobPayloads[K],
    options: EnqueueOptions = {},
  ): Promise<EnqueuedJob<K>> {
    const { idempotencyKey } = options

    if (idempotencyKey) {
      const existing = this.seen.get(idempotencyKey)
      if (existing) return existing as EnqueuedJob<K>
    }

    const job: EnqueuedJob<K> = {
      id: crypto.randomUUID(),
      name,
      payload,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      enqueuedAt: new Date(),
    }

    if (idempotencyKey) this.seen.set(idempotencyKey, job)

    const handler = this.handlers[name]
    queueMicrotask(() => {
      void handler(payload).catch((error: unknown) => {
        // Rule 8: never swallow an error silently. Replaced by real reporting at A5.
        console.error("[jobs] handler failed", { name, id: job.id, error })
      })
    })

    return job
  }

  /** Test seam. */
  clear(): void {
    this.seen.clear()
  }
}
