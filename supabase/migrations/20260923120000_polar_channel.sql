-- Polar: the third billable automatic channel, and the first that delivers
-- the file to the buyer itself.
--
-- One catalog row. Capabilities, OAuth, the product, file and benefit calls
-- and the error map live in lib/channels/adapters/polar. billable is true per
-- docs/billing.md rule 4: Polar is an external platform the creator does not
-- own, not the included owned storefront. It is a checkout rather than a
-- marketplace, so whether it should bill at the marketplace price is
-- decision 32 in docs/decisions/0002; flipping this row is one migration.
insert into public.channels (key, name, integration_type, status, billable) values
  ('polar', 'Polar', 'api', 'available', true);
