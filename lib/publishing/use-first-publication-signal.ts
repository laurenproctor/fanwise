"use client"

import { useEffect, useRef } from "react"
import { notifyFanwiseProductPublished } from "@/lib/favicon/events"
import {
  firstPublicationLanded,
  summarizePublications,
  type PublicationFacts,
  type PublicationSummary,
} from "./first-publication"

/**
 * Tells the favicon when a product's first listing lands on a channel.
 *
 * Mounted where the refreshed cards arrive, which is the one place the
 * server's answer reaches the browser. Each render's cards are summarized and
 * compared with the summary from the render before; the deciding is in
 * ./first-publication and is tested on its own. The first render has nothing
 * to compare with and says nothing, so opening a product that is already on
 * three channels is silent, as it should be.
 *
 * A ref rather than state: the previous summary is remembered, not rendered,
 * and it must survive React's development double-mount without firing on the
 * second pass, which a ref does and a fresh closure would not.
 */
export function useFirstPublicationSignal(
  productId: string,
  cards: readonly PublicationFacts[],
): void {
  const previous = useRef<PublicationSummary | null>(null)

  useEffect(() => {
    const next = summarizePublications(productId, cards)
    if (firstPublicationLanded(previous.current, next)) notifyFanwiseProductPublished()
    previous.current = next
  }, [productId, cards])
}
