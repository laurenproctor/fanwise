import { task } from "@trigger.dev/sdk"
import { handlers } from "@/lib/jobs/handlers"
import type { JobPayloads } from "@/lib/jobs/types"

/**
 * One Trigger.dev task per job name.
 *
 * Each task's id is the job name and its run is the handler, so
 * lib/jobs/trigger-queue.ts can enqueue by name without importing anything
 * here. A unit test asserts this file declares exactly the names
 * lib/jobs/types.ts lists, in both directions.
 *
 * Handlers own their failure handling: a publication that throws inside the
 * adapter is normalized and persisted by the runner, not surfaced here. What
 * reaches Trigger.dev's retry is only a failure *before* the handler could
 * record anything, which is the case a retry is for.
 */

export const noop = task({
  id: "noop",
  run: async (payload: JobPayloads["noop"]) => handlers.noop(payload),
})

export const finalizeAsset = task({
  id: "finalize_asset",
  run: async (payload: JobPayloads["finalize_asset"]) => handlers.finalize_asset(payload),
})

export const buildDerivative = task({
  id: "build_derivative",
  run: async (payload: JobPayloads["build_derivative"]) => handlers.build_derivative(payload),
})

export const publishListing = task({
  id: "publish_listing",
  // The runner claims the row by compare-and-swap, so a retried delivery of a
  // job that already ran does nothing. No retry here: a provider failure is
  // recorded on the job row and the creator decides.
  retry: { maxAttempts: 1 },
  run: async (payload: JobPayloads["publish_listing"]) => handlers.publish_listing(payload),
})

export const generateListing = task({
  id: "generate_listing",
  // Same shape as publish: the generation row is claimed once and a failed
  // call is recorded, not silently retried at the creator's expense.
  retry: { maxAttempts: 1 },
  run: async (payload: JobPayloads["generate_listing"]) => handlers.generate_listing(payload),
})
