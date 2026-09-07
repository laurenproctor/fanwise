import { describe, expect, it } from "vitest"
import { resolveSend } from "@/lib/publishing/send-outcome"

/**
 * When the panel is allowed to say "Sent".
 *
 * The bug that prompted this: an update deliberately does not set the listing
 * to `publishing`, because the product is live throughout and flipping the row
 * would report a live product as not live. That left "Sending your changes to
 * Shopify." with nothing to end it — it was set when the job was queued, and
 * no later render had any reason to replace it, so it sat there long after the
 * images had arrived.
 *
 * The fix is not a timer. "Sent" is a claim about someone else's storefront,
 * so it waits for the fact that only a successful write produces.
 */

describe("resolving a queued send", () => {
  it("waits while the listing still holds something unsent", () => {
    expect(resolveSend({ canPublishChanges: true, lastError: null })).toEqual({ kind: "waiting" })
  })

  it("is sent once the listing holds nothing the channel has not received", () => {
    // The same fact the button uses, and only recordSuccess can produce it.
    expect(resolveSend({ canPublishChanges: false, lastError: null })).toEqual({ kind: "sent" })
  })

  it("reports a failure instead of a landing when both could be read", () => {
    // A job that failed after writing part of what it meant to could satisfy
    // both signals. Announcing "Sent" over a recorded failure is the worse of
    // the two mistakes.
    expect(
      resolveSend({ canPublishChanges: false, lastError: "Shopify rejected the title." }),
    ).toEqual({ kind: "failed", message: "Shopify rejected the title." })
  })

  it("keeps waiting when the card is missing rather than assuming success", () => {
    // A card can be absent mid-refresh for reasons that have nothing to do with
    // the channel, and absence is not evidence of a send.
    expect(resolveSend(undefined)).toEqual({ kind: "waiting" })
  })
})
