/**
 * A channel's one-time delivery setup (ADR 0013).
 *
 * Some channels deliver a Fanwise download link through something the creator
 * owns and Fanwise cannot write — an email template in the shop's own admin.
 * The setup is done once per connected account, never per product, and the
 * creator's confirmation is recorded on the connection's metadata under this
 * key, where the channel's readiness rule reads it.
 *
 * Browser-safe: the listing editor evaluates the same rule while typing.
 */
export const DELIVERY_SETUP_CONFIRMED_KEY = "deliverySetupConfirmedAt"

export function isDeliverySetupConfirmed(
  connectionMetadata: Record<string, unknown> | undefined,
): boolean {
  const value = connectionMetadata?.[DELIVERY_SETUP_CONFIRMED_KEY]
  return typeof value === "string" && value.length > 0
}

/**
 * Metadata a reconnect must keep.
 *
 * An authorization writes the account's metadata afresh, and the setup lives in
 * the shop, not in the token: reconnecting the same shop does not undo it.
 */
export const DURABLE_CONNECTION_METADATA_KEYS = [DELIVERY_SETUP_CONFIRMED_KEY] as const

/** Fresh authorization metadata, carrying forward what a reconnect must not erase. */
export function carryDurableMetadata(
  existing: Record<string, unknown> | null | undefined,
  fresh: Record<string, unknown>,
): Record<string, unknown> {
  const carried: Record<string, unknown> = {}
  for (const key of DURABLE_CONNECTION_METADATA_KEYS) {
    if (existing?.[key] !== undefined) carried[key] = existing[key]
  }
  return { ...fresh, ...carried }
}
