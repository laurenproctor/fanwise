-- Behance: the second assisted channel, and the first whose unit is a
-- portfolio project rather than a product.
--
-- One catalog row. Capabilities (every one false but drafts, all for the
-- permanent reason), the requirements, the two mapping tables, the handoff
-- and the submission parser live in lib/channels/adapters/behance. No new
-- table and nothing in channel_connection_secrets: the adapter declares no
-- oauth, so Connect writes the connection row and no credential for this
-- channel ever exists. billable is true per docs/billing.md rule 4: it is a
-- marketplace, and decision 16 governs what an assisted one costs.
insert into public.channels (key, name, integration_type, status, billable) values
  ('behance', 'Behance', 'assisted', 'available', true);
