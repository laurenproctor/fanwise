import type { BillingGateway } from "@/lib/billing/gateway"
import { readStripeConfig } from "./stripe/config"
import { createStripeGateway } from "./stripe"

/**
 * The single place a billing vendor is chosen.
 *
 * Selected by the presence of its secret key, the same way the credentials
 * keyring, the channel client ids, the model key and the job queue are: a
 * deployment with no billing provider is a valid deployment, and every CI
 * run, every fresh checkout and the whole of the database suite is one.
 * There, `selectGateway` returns null and every surface says billing is not
 * configured rather than offering a button that fails.
 *
 * Read from process.env rather than lib/env.ts because the variables are
 * optional and naming a vendor in the shared schema would make it every
 * caller's concern.
 */
export function selectGateway(
  env: Record<string, string | undefined> = process.env,
): BillingGateway | null {
  const config = readStripeConfig(env)
  if (!config) return null
  return createStripeGateway(config)
}

let cached: BillingGateway | null | undefined

export function gateway(): BillingGateway | null {
  if (cached === undefined) cached = selectGateway()
  return cached
}

/** Test seam. Never call from application code. */
export function resetGatewayForTests(next?: BillingGateway | null): void {
  cached = next
}
