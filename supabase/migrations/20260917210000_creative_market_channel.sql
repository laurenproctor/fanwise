-- Creative Market: the first channel in the plan, built at A8, and the third
-- assisted channel to land.
--
-- Two changes.
--
--   1. One catalog row. Capabilities (every one false but drafts, all for the
--      permanent reason: no seller API, and the terms close browser automation
--      in writing), the requirements, the category and license tables, the
--      package build, the handoff and the submission parser live in
--      lib/channels/adapters/creative-market. No new table and nothing in
--      channel_connection_secrets: the adapter declares no oauth, so Connect
--      writes the connection row and no credential for this channel ever
--      exists. billable is true per docs/billing.md rule 4: it is a
--      marketplace, and decision 16 governs what an assisted one costs.
--
--   2. `products.made_with_generative_ai`, decision 24. Creative Market's
--      upload form requires a yes or no to whether the product, or one of its
--      key features, was primarily created with generative AI tools, and other
--      marketplaces are adding the same question. It is a fact about the
--      product, so it lives on `products` and in the FactSheet, never on a
--      listing and never composed by a model. Nullable: null means unanswered,
--      never no. Neutral Fanwise wording, so each adapter maps it onto its
--      channel's own question. Required by Creative Market's readiness check
--      rather than by the product schema, so a product headed only to
--      channels that do not ask is not blocked.
--
-- Rollback: delete the channels row (refused while a connection references
-- it, which is right); drop the column. Data loss on rollback: every answer
-- to the disclosure.

insert into public.channels (key, name, integration_type, status, billable) values
  ('creative_market', 'Creative Market', 'assisted', 'available', true);

alter table public.products
  add column made_with_generative_ai boolean;

comment on column public.products.made_with_generative_ai is
  'Whether the product, or one of its key features, was primarily made with generative AI tools. Null is unanswered, never no. A fact the creator states; never composed by a model. Decision 24.';
