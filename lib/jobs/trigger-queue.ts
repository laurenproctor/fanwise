import { tasks } from "@trigger.dev/sdk"
import type { EnqueueOptions, EnqueuedJob, JobName, JobPayloads, JobQueue } from "./types"

/**
 * The durable queue, adopted at step B1.
 *
 * Every job name is a Trigger.dev task of the same id, declared in
 * trigger/jobs.ts, and enqueueing is `tasks.trigger` with the payload the
 * handler expects. The worker that runs the task calls the same handler the
 * in-process queue would have, so a job does not know which queue carried it.
 *
 * Why this exists rather than the in-process queue continuing: an in-process
 * queue dies with the serverless function that started it. That was survivable
 * while every job was short and a lost one was an upload to retry, and it stops
 * being survivable at B1, where a lost job is a model call that was paid for
 * and never recorded, and at A7, where it is half of Publish Everywhere.
 *
 * The delivery key given to Trigger.dev is the caller's `idempotencyKey`,
 * unchanged. Its meaning is the one lib/publishing/start.ts documents: has this
 * exact hand-off already been queued, not may this operation happen at all.
 * The database owns the second question. The TTL is short for the same reason
 * the in-process queue keys on the attempt: a retry of a failed job must be
 * deliverable, and a key that Trigger.dev remembered for thirty days would make
 * it vanish.
 */

const IDEMPOTENCY_KEY_TTL = "1h"

export interface TriggerLike {
  trigger(
    id: string,
    payload: unknown,
    options?: { idempotencyKey?: string; idempotencyKeyTTL?: string; delay?: string },
  ): Promise<{ id: string }>
}

export class TriggerQueue implements JobQueue {
  constructor(private readonly client: TriggerLike = tasks as unknown as TriggerLike) {}

  async enqueue<K extends JobName>(
    name: K,
    payload: JobPayloads[K],
    options: EnqueueOptions = {},
  ): Promise<EnqueuedJob<K>> {
    const { idempotencyKey, delayMs } = options

    const handle = await this.client.trigger(name, payload, {
      ...(idempotencyKey ? { idempotencyKey, idempotencyKeyTTL: IDEMPOTENCY_KEY_TTL } : {}),
      ...(delayMs && delayMs > 0 ? { delay: `${Math.ceil(delayMs / 1000)}s` } : {}),
    })

    return {
      id: handle.id,
      name,
      payload,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      enqueuedAt: new Date(),
    }
  }
}
