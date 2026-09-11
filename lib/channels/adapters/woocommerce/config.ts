/**
 * WooCommerce needs no app registration.
 *
 * The authorization flow is the store's own: Fanwise sends the creator to
 * their store with an app name and two URLs, the store mints a key pair, and
 * posts it back. There is no client id, no client secret and nothing to put
 * in the environment, which is why this file is short and why the channel
 * card never says "not configured on this deployment".
 */

/** The name the store shows the creator on its approval screen. */
export const APP_NAME = "Fanwise"

/** The one permission the flow asks for. Publishing writes; ingestion reads. */
export const SCOPES = ["read_write"] as const

/** The REST namespace this adapter is written against. Pinned, never "latest". */
export const API_NAMESPACE = "wc/v3"
