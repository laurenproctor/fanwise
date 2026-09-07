import type { ImageSpec } from "@/lib/products/derivatives"

/**
 * Job contract.
 *
 * Deliberately thin. Step A0 shipped an in-process runner so nothing depended
 * on a queue vendor; step B1 adds a Trigger.dev-backed implementation behind
 * the same interface, chosen in lib/jobs/index.ts and nowhere else.
 *
 * Every job that performs an external write carries an idempotency key, per
 * architecture invariant 3. The key is persisted with the job row before the
 * external call happens.
 */

export type JobName =
  "noop" | "finalize_asset" | "build_derivative" | "publish_listing" | "generate_listing"

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
  /**
   * Compose one listing with a model. Step B1.
   *
   * Ids only, for the same reason as publish_listing: the FactSheet is derived
   * from the product as it stands when the job runs, and the row records the
   * hash of what it actually saw.
   */
  generate_listing: { workspaceId: string; generationId: string }
}

/**
 * Every job name, as a value. `JobName` is a type and cannot be iterated; the
 * Trigger.dev implementation declares one task per name and a unit test checks
 * the two lists agree, so a job added to the type without a task fails CI
 * rather than production.
 */
export const JOB_NAMES = [
  "noop",
  "finalize_asset",
  "build_derivative",
  "publish_listing",
  "generate_listing",
] as const satisfies readonly JobName[]

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
