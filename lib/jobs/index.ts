import { InMemoryQueue } from "./in-memory-queue"
import { TriggerQueue } from "./trigger-queue"
import { handlers } from "./handlers"
import type { JobQueue } from "./types"

/**
 * The single place the queue implementation is chosen.
 *
 * Step B1 adopted Trigger.dev. It is selected by the presence of its secret
 * key, the same way the credentials keyring and the first channel's client id
 * are: an application with no queue vendor configured is a valid application,
 * and every CI run, every fresh checkout and the whole of the database test
 * suite is one. Those keep the in-process queue, which runs the same handlers
 * on the next tick. A deployment sets the key and gets a durable queue with no
 * other change.
 *
 * Read from process.env rather than lib/env.ts for the reason the channel
 * adapters do: the variable is optional, and naming a vendor in the shared
 * environment schema would make it every caller's concern.
 */
export function selectQueue(env: Record<string, string | undefined> = process.env): JobQueue {
  const secret = env.TRIGGER_SECRET_KEY
  if (secret && secret.trim().length > 0) return new TriggerQueue()
  return new InMemoryQueue(handlers)
}

export const jobs: JobQueue = selectQueue()

export * from "./types"
export { InMemoryQueue }
export { TriggerQueue }
export { handlers }
