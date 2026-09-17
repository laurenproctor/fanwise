import { buildDerivative, finalizeAsset } from "@/lib/products/assets"
import { runPublication } from "@/lib/publishing/runner"
import { runGeneration } from "@/lib/ai/runner"
import { syncBilling } from "@/lib/billing/sync"
import { runImport } from "@/lib/imports/runner"
import { runTranscription } from "@/lib/imports/transcribe"
import { runChannelWebhook } from "@/lib/channels/webhooks"
import { describeImage } from "@/lib/ai/alt-text"
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
    const outcome = await finalizeAsset(payload)
    /*
      A product image that just became ready gets its alt text written, in the
      same run rather than through a second enqueue: this file is what the
      queue is built from, so it cannot ask the queue for anything. Kept apart
      from finalize's own result on purpose. The image is ready whatever the
      model says, so a model outage is logged and never retries the finalize.
      FANWISE_AUTO_ALT_TEXT=off keeps a test suite with a real key from paying
      for a description of every fixture it uploads; the editor's button is
      unaffected.
    */
    if (outcome.describe && process.env.FANWISE_AUTO_ALT_TEXT !== "off") {
      try {
        await describeImage(payload)
      } catch (error) {
        console.error("[jobs] alt text after finalize failed", {
          assetId: payload.assetId,
          name: error instanceof Error ? error.name : "unknown",
        })
      }
    }
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
  transcribe_import_source: async (payload) => {
    await runTranscription(payload)
  },
  channel_webhook: async (payload) => {
    await runChannelWebhook(payload)
  },
  describe_image: async (payload) => {
    await describeImage(payload)
  },
}
