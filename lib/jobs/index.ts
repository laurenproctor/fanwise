import { InMemoryQueue } from "./in-memory-queue"
import { buildDerivative, finalizeAsset } from "@/lib/products/assets"
import { runPublication } from "@/lib/publishing/runner"
import type { JobHandlers, JobQueue } from "./types"

const handlers: JobHandlers = {
  noop: async ({ message }) => {
    console.info("[jobs] noop", message)
  },
  finalize_asset: async (payload) => {
    await finalizeAsset(payload)
  },
  build_derivative: async (payload) => {
    await buildDerivative(payload)
  },
  publish_listing: async (payload) => {
    await runPublication(payload)
  },
}

/**
 * The single place the queue implementation is chosen.
 * Step B1 swaps InMemoryQueue for a Trigger.dev-backed implementation here.
 */
export const jobs: JobQueue = new InMemoryQueue(handlers)

export * from "./types"
export { InMemoryQueue }
