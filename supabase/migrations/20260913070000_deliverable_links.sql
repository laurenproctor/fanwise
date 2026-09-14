-- A durable address a channel's own server can fetch a deliverable from.
--
-- Some channels take the buyer file by upload (Etsy) and some cannot take it at
-- all (Shopify). WooCommerce is the third case: it stores a URL and fetches the
-- bytes itself whenever a buyer downloads, which may be months after the
-- publish that supplied the address. Every link Fanwise already mints expires
-- within the hour, on purpose, because a signed URL is a bearer capability; none
-- of them can serve this.
--
-- The address must also be STABLE. WooCommerce ties a buyer's download
-- permission to the download entry on the product, so an address that changed on
-- every update would churn those entries for no reason. So one listing and one
-- asset have exactly one live address, and every later write is handed the same
-- one. That is why the token is recoverable here, and how it is kept safe:
--
--   * `token_hash` is the SHA-256 of the token and is what a request is looked
--     up by. A request never touches the sealed column.
--   * `token_sealed` is the token under AES-256-GCM with the versioned
--     CREDENTIALS_ENCRYPTION_KEY keyring (lib/credentials/seal.ts), bound to the
--     listing and asset as additional authenticated data, so a sealed value
--     copied to another row does not open. A reader of this table alone -- a
--     dump, a support query -- holds nothing that can be exchanged for a file.
--     `key_version` is kept beside it, as on channel_connection_secrets, so key
--     rotation is a query and an old key can be retired without breaking an
--     address a store already holds.
--   * It cascades from both the listing and the asset. Deleting either takes
--     the address down, which is what makes removing a file or a listing
--     actually take the file off the open web.
--
-- RLS is enabled and there are deliberately NO policies. Every other tenant
-- table grants its workspace's members a policy; this one grants nobody,
-- because nobody signed in has any reason to read a token, sealed or hashed, and
-- the browser must never receive one. The service role bypasses RLS and is the
-- only thing that touches this table: the publication runner ensures, the public
-- route resolves.

create table public.listing_deliverable_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_listing_id uuid not null,
  asset_id uuid not null,
  token_hash text not null unique,
  token_sealed text not null,
  key_version integer not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_downloaded_at timestamptz,
  -- Composite, as on every tenant table: a row cannot pair one workspace's
  -- listing with another workspace's file, even written by the service role.
  constraint listing_deliverable_links_listing_fk
    foreign key (channel_listing_id, workspace_id)
    references public.channel_listings (id, workspace_id) on delete cascade,
  constraint listing_deliverable_links_asset_fk
    foreign key (asset_id, workspace_id)
    references public.product_assets (id, workspace_id) on delete cascade
);

-- One live address per listing and asset. This is also the guard against two
-- writes racing to mint: the loser's insert conflicts and it reads the winner's.
create unique index listing_deliverable_links_live_key
  on public.listing_deliverable_links (channel_listing_id, asset_id)
  where revoked_at is null;

alter table public.listing_deliverable_links enable row level security;

-- Said out loud beside the absent policies, so a later migration that adds a
-- policy cannot quietly hand the browser a token.
revoke all on public.listing_deliverable_links from anon, authenticated;

comment on table public.listing_deliverable_links is
  'Durable, revocable fetch addresses for deliverables a channel stores by URL. Service role only. Looked up by token hash; the token is kept sealed so the address stays stable.';
