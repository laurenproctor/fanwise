import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import { readConnectionCredentials } from "@/lib/credentials"
import type { ChannelConnection } from "@/lib/channels/types"
import { createShopifyClient, type ShopifyClient } from "./client"
import { staleScopes } from "./config"

/** The shape lib/credentials seals and opens for this channel. */
export const shopifyCredentialsSchema = z.object({
  accessToken: z.string().min(1),
})

export type ShopifyCredentials = z.infer<typeof shopifyCredentialsSchema>

/**
 * A signed client for one connection.
 *
 * Shared by publishing and by the webhook handler, which is why it takes the
 * connection rather than a publish context. Two refusals come first, before
 * any call:
 *
 * The connection is authorized, but is it authorized for what this build
 * needs? ADR 0004 and ADR 0015 each added scopes, and Fanwise runs its own
 * OAuth rather than Shopify's managed installation, so nothing has prompted
 * the creator on its behalf. Their existing token simply cannot do the new
 * thing. Asked here so the ask arrives as an explanation rather than as a 403
 * at the end of a write.
 */
export async function clientForConnection(
  connection: ChannelConnection,
): Promise<{ shopDomain: string; client: ShopifyClient }> {
  const missing = staleScopes(connection.scopes ?? [])
  if (missing.length > 0) {
    throw new ChannelError(
      normalized(
        "permission_denied",
        "Fanwise needs one more permission on this Shopify store before it can put products on " +
          "sale. Reconnect the store and accept the permissions it asks for. Your existing " +
          "products are not affected.",
        { missing },
      ),
    )
  }

  const shopDomain = connection.external_account_id
  if (!shopDomain) {
    throw new ChannelError(
      normalized(
        "credentials_invalid",
        "This Shopify connection is missing its store domain. Reconnect the store.",
      ),
    )
  }

  const credentials = await readConnectionCredentials({
    workspaceId: connection.workspace_id,
    connectionId: connection.id,
    schema: shopifyCredentialsSchema,
  })
  if (!credentials) {
    throw new ChannelError(
      normalized(
        "credentials_invalid",
        "Fanwise no longer holds an authorization for this Shopify store. Reconnect it.",
      ),
    )
  }

  return {
    shopDomain,
    client: createShopifyClient({ shopDomain, accessToken: credentials.accessToken }),
  }
}
