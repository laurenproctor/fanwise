import type { ImageSpec } from "@/lib/products/derivatives"

/**
 * Job contract.
 *
 * Deliberately thin. Step A0 ships an in-process runner so nothing depends on a
 * queue vendor yet; Trigger.dev is adopted at step B1 by writing a new JobQueue
 * implementation and changing one line in lib/jobs/index.ts.
 *
 * Every job that performs an external write carries an idempotency key, per
 * architecture invariant 3. The key is persisted with the job row before the
 * external call happens.
 */

export type JobName = "noop" | "finalize_asset" | "build_derivative" | "publish_listing"

export interface JobPayloads {
  noop: { message: string }
  /** Verify an uploaded object and move the asset row to ready. Step A2. */
  finalize_asset: { workspaceId: string; assetId: string }
  /** Render one image derivative for one spec. Step A2. */
  build_derivative: {
    workspaceId: string
    sourceAssetId: string
    spec: ImageSpec
  }
  /**
   * Perform one external write against a channel. Step A5.
   *
   * The payload carries ids only. Everything the write needs is loaded from the
   * database by the runner, so a job that sits in a queue while a creator keeps
   * editing performs the write against the listing as it stands when it runs,
   * not against a copy taken when they clicked.
   */
  publish_listing: { workspaceId: string; publicationJobId: string }
}

export interface EnqueueOptions {
  /** Required for any job that writes to an external system. */
  idempotencyKey?: string
  /** Delay before first attempt, milliseconds. */
  delayMs?: number
  maxAttempts?: number
}

export interface EnqueuedJob<K extends JobName = JobName> {
  id: string
  name: K
  payload: JobPayloads[K]
  idempotencyKey?: string
  enqueuedAt: Date
}

export interface JobQueue {
  enqueue<K extends JobName>(
    name: K,
    payload: JobPayloads[K],
    options?: EnqueueOptions,
  ): Promise<EnqueuedJob<K>>
}

export type JobHandler<K extends JobName> = (payload: JobPayloads[K]) => Promise<void>

export type JobHandlers = { [K in JobName]: JobHandler<K> }
