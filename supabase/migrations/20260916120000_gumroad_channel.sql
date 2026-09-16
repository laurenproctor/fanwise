-- Gumroad: the second billable automatic channel.
--
-- One catalog row. Capabilities, OAuth, the product calls, the presigned
-- upload and the error map live in lib/channels/adapters/gumroad. billable is
-- true per docs/billing.md rule 4 and decision 23: every external marketplace
-- bills, and Gumroad is a marketplace, not an owned storefront.
insert into public.channels (key, name, integration_type, status, billable) values
  ('gumroad', 'Gumroad', 'api', 'available', true);
