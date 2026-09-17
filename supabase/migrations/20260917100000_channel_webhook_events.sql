-- ---------------------------------------------------------------------------
-- Channel webhook receipts (ADR 0015).
--
-- A provider that tells Fanwise about an event on a connected account posts
-- it to /api/channels/<key>/webhook. Every delivery is recorded here by the
-- provider's own delivery id before anything acts on it, the same discipline
-- billing_webhook_events established at C1:
--
--   1. the route verifies the signature over the raw bytes, then records the
--      delivery here, then enqueues a job carrying only this row's id
--   2. a redelivery collides on the primary key and is answered without
--      being re-applied once processed
--   3. the idempotency key names the provider object the delivery is about,
--      so a second delivery id for the same object also collides, per
--      architecture invariant 3: the key is on disk before the external write
--
-- No grant to anon or authenticated, RLS on with zero policies: nothing in the
-- browser has any business reading a provider's event stream. The row carries
-- ids and an outcome, never a payload, because the payloads that would be
-- worth keeping are the ones that carry a buyer.
-- ---------------------------------------------------------------------------

create table public.channel_webhook_events (
  -- The provider's own id for the delivery. A redelivery repeats it.
  id text primary key,
  channel_key text not null,
  -- The account the delivery concerns, as channel_connections.external_account_id holds it.
  external_account_id text not null,
  topic text not null,
  -- The provider object the delivery is about, a fulfillment order for Shopify.
  external_object_id text not null,
  idempotency_key text not null,
  received_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  -- Per connection: what was done, or why nothing was. Provider bodies from a
  -- failure are persisted here and never rendered (rule 8).
  outcome jsonb,
  error text,
  constraint channel_webhook_events_idempotency_key_unique unique (idempotency_key),
  constraint channel_webhook_events_channel_key_format check (channel_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint channel_webhook_events_topic_not_blank check (length(btrim(topic)) between 1 and 120)
);

comment on table public.channel_webhook_events is
  'Every provider webhook delivery, by its own id. No grant to anon or authenticated: service role only. A redelivery collides on the key, and a second delivery about the same provider object collides on the idempotency key.';

create index channel_webhook_events_account_idx
  on public.channel_webhook_events (channel_key, external_account_id, received_at desc);

alter table public.channel_webhook_events enable row level security;

-- Deliberately NOT forced, for the reason recorded in the A1 migration.

revoke all on public.channel_webhook_events from anon, authenticated;
