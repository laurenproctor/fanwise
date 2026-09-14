import { z } from "zod"

/**
 * Deleting a product draft: the vocabulary, shared by the server and the page.
 *
 * Nothing here decides whether a product may be deleted. That is
 * `product_draft_deletion_blocker()` in the database, read by the product page
 * and again, under lock, by `delete_product_draft()`
 * (supabase/migrations/20260913040000_delete_product_draft.sql). What lives
 * here is what the answer is called, what a creator is told about it, and the
 * shape the database has to return before anything acts on it (rule 6).
 *
 * No server import, so the dialog can share the confirmation word and the
 * messages with the action instead of keeping a second copy that drifts.
 */

/** Every reason the database gives. Kept in step with the migration. */
export const DRAFT_DELETION_BLOCKERS = [
  "public_page",
  "listing_external_reference",
  "listing_live",
  "publication_history",
  "activity_history",
  "import_in_progress",
  "generation_in_progress",
  "upload_in_progress",
] as const

export type DraftDeletionBlocker = (typeof DRAFT_DELETION_BLOCKERS)[number]

export const draftDeletionBlockerSchema = z.enum(DRAFT_DELETION_BLOCKERS)

/**
 * What the creator types to enable the final button, and what the server
 * checks again. Not the product's name: the name field autosaves, so the name
 * the dialog shows can be a keystroke behind the one the server reads.
 */
export const DELETE_CONFIRMATION_WORD = "DELETE"

export const deleteConfirmationSchema = z.literal(DELETE_CONFIRMATION_WORD)

/** Whether the final Delete draft button may be pressed. */
export function canConfirmDraftDeletion(typed: string, pending: boolean): boolean {
  return !pending && typed === DELETE_CONFIRMATION_WORD
}

/**
 * The result of `delete_product_draft()`, validated before anything acts on
 * it. Paths are strings and nothing else, because they are handed to storage.
 */
export const deleteDraftResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("deleted"),
    blocker: z.null(),
    asset_paths: z.array(z.string().min(1)),
    import_source_paths: z.array(z.string().min(1)),
  }),
  z.object({
    outcome: z.literal("blocked"),
    blocker: draftDeletionBlockerSchema,
    asset_paths: z.array(z.string()).length(0),
    import_source_paths: z.array(z.string()).length(0),
  }),
  z.object({
    outcome: z.literal("not_found"),
    blocker: z.null(),
    asset_paths: z.array(z.string()).length(0),
    import_source_paths: z.array(z.string()).length(0),
  }),
])

export type DeleteDraftResult = z.infer<typeof deleteDraftResultSchema>

/**
 * What `product_draft_deletion_blocker()` answered, for the product page.
 *
 * `hidden` is both "not the owner" and "not found": the page renders nothing
 * for either, so it never has to know which.
 */
export type DraftDeletionEligibility =
  { kind: "eligible" } | { kind: "blocked"; blocker: DraftDeletionBlocker } | { kind: "hidden" }

export function eligibilityFromBlocker(value: unknown): DraftDeletionEligibility {
  if (value === null) return { kind: "eligible" }
  const blocker = draftDeletionBlockerSchema.safeParse(value)
  if (blocker.success) return { kind: "blocked", blocker: blocker.data }
  // 'not_found', or anything this build does not recognise. Unknown is not
  // permission: a code added to the database before this list is hidden.
  return { kind: "hidden" }
}

/** Where the deletion was asked from, which changes what the creator is told. */
export type DraftDeletionContext = "product" | "import"

const BLOCKER_REASONS: Record<DraftDeletionBlocker, string> = {
  public_page:
    "It has a public page on your Fanwise profile. A page that has existed may already be linked or indexed.",
  listing_external_reference: "A channel holds a listing for it.",
  listing_live: "One of its channel listings has been published, or is being published now.",
  publication_history: "Fanwise has already tried to publish it to a channel.",
  activity_history: "Its activity log records publishing activity, and that history is kept.",
  import_in_progress:
    "Fanwise is still reading what it was imported from. Wait for that to finish, then try again.",
  generation_in_progress:
    "A channel listing is still being written for it. Wait for that to finish, then try again.",
  upload_in_progress:
    "A file is still uploading. Wait for it to finish, or remove the unfinished file, then try again.",
}

/** Blockers a creator can clear by waiting or tidying up, rather than never. */
const TEMPORARY: ReadonlySet<DraftDeletionBlocker> = new Set([
  "import_in_progress",
  "generation_in_progress",
  "upload_in_progress",
])

export function isTemporaryBlocker(blocker: DraftDeletionBlocker): boolean {
  return TEMPORARY.has(blocker)
}

/**
 * One sentence, or two, for a blocker. Stable per code, so a test can hold the
 * copy to it and the database's words never reach a screen (rule 8).
 */
export function draftDeletionBlockedMessage(
  blocker: DraftDeletionBlocker,
  context: DraftDeletionContext = "product",
): string {
  const reason = BLOCKER_REASONS[blocker]
  if (TEMPORARY.has(blocker)) {
    return context === "import"
      ? `This import can't be discarded yet. ${reason}`
      : `This draft can't be deleted yet. ${reason}`
  }
  return context === "import"
    ? `This product can no longer be discarded as a new draft. ${reason}`
    : `This product can't be permanently deleted. ${reason}`
}

export const DRAFT_DELETION_MESSAGES = {
  notFound: "That draft could not be found. It may already have been deleted.",
  failed: "That draft could not be deleted. Nothing was removed. Try again.",
  confirmation: `Type ${DELETE_CONFIRMATION_WORD} to confirm.`,
} as const

/** What the deletion service reports to the action that called it. */
export type DraftDeletionOutcome =
  | { kind: "deleted"; workspaceSlug: string }
  | { kind: "blocked"; blocker: DraftDeletionBlocker }
  | { kind: "not_found" }
  | { kind: "failed" }

/** The sentence for every outcome that is not a deletion. */
export function draftDeletionErrorMessage(
  outcome: Exclude<DraftDeletionOutcome, { kind: "deleted" }>,
  context: DraftDeletionContext = "product",
): string {
  switch (outcome.kind) {
    case "blocked":
      return draftDeletionBlockedMessage(outcome.blocker, context)
    case "not_found":
      return DRAFT_DELETION_MESSAGES.notFound
    case "failed":
      return context === "import"
        ? "That could not be discarded. Nothing was removed. Try again."
        : DRAFT_DELETION_MESSAGES.failed
  }
}
