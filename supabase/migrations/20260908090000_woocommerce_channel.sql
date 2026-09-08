-- WooCommerce: the second owned storefront.
--
-- One catalog row. Capabilities, authorization, the product write and the
-- error map live in lib/channels/adapters/woocommerce; this is identity, not
-- behaviour. No new table: the authorization flow reuses channel_oauth_states,
-- and the grant the store posts is sealed into channel_connection_secrets like
-- any other credential.
--
-- billable is false on the reading docs/decisions/0002 item 23 recommends:
-- "owned storefront" is a kind, and every owned storefront is included. That
-- decision is still open. Flipping it is one migration and nothing bills
-- before C1 either way.
insert into public.channels (key, name, integration_type, status, billable) values
  ('woocommerce', 'WooCommerce', 'api', 'available', false);
