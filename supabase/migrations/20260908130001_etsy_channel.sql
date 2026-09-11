-- Etsy: the first billable automatic channel.
--
-- One catalog row. Capabilities, OAuth, the listing calls and the error map
-- live in lib/channels/adapters/etsy. billable is true per docs/billing.md
-- rule 4: every external marketplace bills, and this is the one the pricing
-- model was written around.
insert into public.channels (key, name, integration_type, status, billable) values
  ('etsy', 'Etsy', 'api', 'available', true);
