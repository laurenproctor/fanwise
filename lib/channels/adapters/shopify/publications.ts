import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"

/**
 * Finding the sales channel a digital product belongs on.
 *
 * ## Why this file exists
 *
 * `status: ACTIVE` does not make a Shopify product purchasable. Status and
 * *published to a sales channel* are separate facts, and A5's exit test found
 * three products that were the first and not the second: active, on no channel,
 * `publishedAt: null`, no storefront page, no buyer able to reach them. ADR 0004
 * is the decision to close that in the adapter rather than by asking the creator
 * to do it by hand.
 *
 * ## Why identifying the Online Store is awkward
 *
 * It should be one field and it is not. On the `2026-07` Admin API both of the
 * obvious ones are deprecated:
 *
 *     Publication.name    deprecated
 *     Publication.app     deprecated
 *
 * What is left is `Publication.channels`, and `Channel.handle` is documented as
 * "a unique, human-readable identifier for the channel within the shop". The
 * Online Store's handle is conventionally `online_store`, but shopify.dev does
 * not state that anywhere this could be checked against, so it is a convention
 * this file relies on and does not trust.
 *
 * ## So it does not trust it
 *
 * `resolvePublication` returns a result rather than an id, and the caller
 * cannot use it without handling the case where the shop's publications did not
 * yield an unambiguous answer. Three outcomes, and the third is the point:
 *
 *   matched     exactly one publication looks like the Online Store
 *   only        the shop has exactly one publication at all, so there is
 *               nothing to be ambiguous about
 *   ambiguous   neither of the above, and the adapter refuses
 *
 * Guessing here has a specific cost that is worth naming, because it is not
 * "the wrong thing happens". Publishing a font to Point of Sale, or to a
 * wholesale catalog with its own price list, is the adapter putting a product
 * somewhere the creator never asked for, on a channel they may not have noticed
 * they have. That is worse than an error message, and an error message is what
 * they get.
 */

/**
 * Handles that mean the Online Store, lowest-risk first.
 *
 * A list rather than a constant because the value is a convention rather than a
 * documented contract, and a shop that spells it differently should widen this
 * list on evidence rather than force the whole lookup into a fallback.
 */
const ONLINE_STORE_HANDLES = new Set(["online_store", "online-store", "onlinestore"])

export const PUBLICATIONS = `
  query FanwisePublications {
    publications(first: 25) {
      nodes {
        id
        autoPublish
        channels(first: 5) {
          nodes {
            id
            handle
          }
        }
      }
    }
  }
`

export const publicationsSchema = z.object({
  publications: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        autoPublish: z.boolean().nullish(),
        channels: z
          .object({
            nodes: z.array(z.object({ id: z.string(), handle: z.string().nullish() })),
          })
          .nullish(),
      }),
    ),
  }),
})

export type PublicationsResponse = z.infer<typeof publicationsSchema>

export interface ResolvedPublication {
  publicationId: string
  /**
   * True when the shop already puts new products on this channel by itself.
   *
   * Recorded rather than acted on. It would be reasonable to skip the publish
   * call when it is true, and it is deliberately not skipped: `autoPublish` is
   * the merchant's setting, it can change between one publish and the next, and
   * `publishablePublish` on a product that is already published is the cheaper
   * of the two ways to be wrong.
   */
  autoPublish: boolean
  /** How it was found, for the job row. A guess and a match must be tellable apart later. */
  reason: "handle" | "only_publication"
}

export function resolvePublication(response: PublicationsResponse): ResolvedPublication {
  const nodes = response.publications.nodes

  if (nodes.length === 0) {
    throw new ChannelError(
      normalized(
        "validation_rejected",
        "This Shopify store has no sales channels Fanwise can publish to. Add the Online Store " +
          "channel in Shopify, then try again.",
        response,
      ),
    )
  }

  const byHandle = nodes.filter((node) =>
    (node.channels?.nodes ?? []).some(
      (channel) => channel.handle && ONLINE_STORE_HANDLES.has(channel.handle.toLowerCase()),
    ),
  )

  if (byHandle.length === 1) {
    const match = byHandle[0]!
    return {
      publicationId: match.id,
      autoPublish: match.autoPublish ?? false,
      reason: "handle",
    }
  }

  // No handle matched, but there is only one place a product could go, so there
  // is no judgement to get wrong. A single-publication shop is the ordinary
  // development store.
  if (byHandle.length === 0 && nodes.length === 1) {
    const only = nodes[0]!
    return {
      publicationId: only.id,
      autoPublish: only.autoPublish ?? false,
      reason: "only_publication",
    }
  }

  /*
   * Either nothing looked like the Online Store among several channels, or more
   * than one did. Both are refusals rather than a pick.
   *
   * The alternative is putting a font on Point of Sale, or into a wholesale
   * catalog with its own price list, because a handle this file guessed at did
   * not match. A creator can act on this sentence; they cannot act on a product
   * quietly appearing on a channel they forgot they had.
   */
  throw new ChannelError(
    normalized(
      "validation_rejected",
      byHandle.length > 1
        ? "Fanwise found more than one Online Store sales channel on this Shopify store and did " +
            "not guess between them. Publish this product to a channel in Shopify yourself."
        : "Fanwise could not tell which of this store's sales channels is the Online Store, so it " +
            "did not put the product on one. Publish it to a channel in Shopify yourself.",
      { candidates: nodes.length, matched: byHandle.length },
    ),
  )
}
