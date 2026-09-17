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
  | "noop"
  | "finalize_asset"
  | "build_derivative"
  | "publish_listing"
  | "generate_listing"
  | "sync_billing"
  | "import_source"
  | "transcribe_import_source"
  | "channel_webhook"

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
  /**
   * Carry the billing ledger to the payment provider. Step C1.
   *
   * The workspace id only. The job reads the pending ledger rows and the
   * connections that exist when it runs, and sets an absolute quantity, so a
   * job that runs late or twice sets the same number.
   */
  sync_billing: { workspaceId: string }
  /**
   * Read one public link and draft a product from it.
   *
   * Ids only, for the same reason as publish_listing and generate_listing: the
   * page is read when the job runs, not when the creator clicked, and the row
   * records what was actually found. The job claims the row by
   * compare-and-swap, so a redelivery does nothing.
   */
  import_source: { workspaceId: string; importId: string; sourceId?: string }
  /**
   * Turn one recording into text, before or after it joins an import.
   *
   * The source id only. The audio is read from storage when the job runs, and
   * the row is claimed by compare-and-swap on `transcribing`.
   */
  transcribe_import_source: { workspaceId: string; sourceId: string }
  /**
   * Act on one provider delivery (ADR 0014).
   *
   * The receipt row's id only. The route recorded the delivery before
   * enqueueing, and the job reads the provider object afresh when it runs, so
   * a delivery that sat in the queue acts on the order as it stands. A
   * finished receipt is skipped, and the provider refuses to fulfil a line
   * twice, so a redelivery does nothing.
   */
  channel_webhook: { eventId: string }
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
  "sync_billing",
  "import_source",
  "transcribe_import_source",
  "channel_webhook",
] as const satisfies readonly JobName[]

export interface EnqueueOptions {
  /** Required for any job that writes to an external system. */
  idempotencyKey?: string
  /** Delay before first attempt, milliseconds. */
  delayMs?: number
  maxAttempts?: number
  /**
   * A named queue to run on instead of the task's own, for work that has to
   * be serialized platform-wide (a provider limit shared by every workspace).
   * Declared in trigger/jobs.ts; the in-process queue has no queues and
   * ignores it, which is fine because nothing shares a process with anyone.
   */
  queue?: string
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
