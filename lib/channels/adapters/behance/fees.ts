/**
 * What a Behance seller receives, docs/channels/behance.md §12.
 *
 * Behance takes 30 percent of each sale unless the seller is on Behance Pro,
 * and the seller's own card processor takes 2.9 percent plus 30 cents. The
 * handoff shows this beside the price rather than letting the creator find
 * out in the processor's dashboard. "About", because the PayPal rate varies
 * by country and Behance may change or waive its fee at its discretion.
 *
 * The processor is not named in code: docs/channels/behance.md §12 names it,
 * and a unit test keeps the billing provider's name inside the billing layer.
 */

export const PLATFORM_FEE_RATE = 0.3
export const PROCESSOR_FEE_RATE = 0.029
export const PROCESSOR_FEE_FIXED = 0.3

/** The card processor's own minimum charge, the floor until Behance publishes one. */
export const MINIMUM_PRICE = 0.5

export interface FeeBreakdown {
  price: number
  platformFee: number
  processorFee: number
  net: number
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function feeBreakdown(price: number): FeeBreakdown {
  const platformFee = round(price * PLATFORM_FEE_RATE)
  const processorFee = round(price * PROCESSOR_FEE_RATE + PROCESSOR_FEE_FIXED)
  return { price, platformFee, processorFee, net: round(price - platformFee - processorFee) }
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** The sentence the handoff and the readiness info line both show. */
export function feeSentence(price: number, currency: string): string {
  if (price === 0) return "Free. Behance and the payment processor charge nothing on a free asset."
  const fees = feeBreakdown(price)
  return (
    `Behance keeps ${money(fees.platformFee, currency)} and the payment processor about ` +
    `${money(fees.processorFee, currency)}. You receive about ${money(fees.net, currency)}. ` +
    `Behance Pro waives the ${money(fees.platformFee, currency)}.`
  )
}
