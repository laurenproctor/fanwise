import { buildDerivative, finalizeAsset } from "@/lib/products/assets"
import { runPublication } from "@/lib/publishing/runner"
import { runGeneration } from "@/lib/ai/runner"
import { syncBilling } from "@/lib/billing/sync"
import { runImport } from "@/lib/imports/runner"
import type { JobHandlers } from "./types"

/**
 * What each job does, independent of what runs it.
 *
 * Separated from index.ts so that both queue implementations can reach the
 * handlers without one importing the other: the in-process queue calls them on
 * a microtask, and the Trigger.dev tasks in trigger/jobs.ts call them from a
 * worker. Either way this is the only list of what a job name means.
 */
export const handlers: JobHandlers = {
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
  generate_listing: async (payload) => {
    await runGeneration(payload)
  },
  sync_billing: async (payload) => {
    await syncBilling(payload)
  },
  import_source: async (payload) => {
    await runImport(payload)
  },
}
