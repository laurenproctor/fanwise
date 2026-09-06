/**
 * Whether a send that was queued has landed yet.
 *
 * Extracted from the panel so the decision can be tested without a DOM. The
 * question is small but it is the one that decides whether a creator is told
 * their changes reached a channel, and "Sent" is a claim about someone else's
 * storefront.
 *
 * The evidence is deliberately the same fact the button uses. A listing that
 * still holds unsent changes has not been sent; one that holds none has, and
 * only recordSuccess writing the fingerprint can bring that about. Anything
 * else available to the client — a job id, an elapsed timer, the action having
 * returned — describes what Fanwise did, not what the channel received.
 */

export interface SendSubject {
  /** True while the listing still holds something the channel has not been sent. */
  canPublishChanges: boolean
  /** The last normalized failure, if the most recent attempt failed. */
  lastError: string | null
}

export type SendOutcome =
  { kind: "waiting" } | { kind: "sent" } | { kind: "failed"; message: string }

/**
 * `undefined` is waiting rather than sent. A card can be missing from a render
 * for reasons that have nothing to do with the channel — a refresh in flight, a
 * listing filtered out — and reading absence as success would announce a send
 * that may not have happened.
 *
 * A failure is checked before a landing. A job that failed after partially
 * writing could leave both signals true, and the honest one is the failure.
 */
export function resolveSend(subject: SendSubject | undefined): SendOutcome {
  if (!subject) return { kind: "waiting" }
  if (subject.lastError) return { kind: "failed", message: subject.lastError }
  return subject.canPublishChanges ? { kind: "waiting" } : { kind: "sent" }
}
