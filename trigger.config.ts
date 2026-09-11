import { defineConfig } from "@trigger.dev/sdk"

/**
 * Trigger.dev, adopted at step B1.
 *
 * The tasks live in trigger/jobs.ts and there is exactly one per job name in
 * lib/jobs/types.ts. Nothing else in the application imports this file or the
 * tasks directly: application code enqueues through lib/jobs, and which queue
 * carries the job is decided in lib/jobs/index.ts by whether
 * TRIGGER_SECRET_KEY is set.
 *
 * `sharp` is native and cannot be bundled, so it is declared external and
 * installed on the worker image. The derivative pipeline is the only job that
 * needs it.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_fanwise",
  dirs: ["./trigger"],
  runtime: "node-24",
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    external: ["sharp"],
  },
})
