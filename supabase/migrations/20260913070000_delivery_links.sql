-- Fanwise download links, for a storefront that delivers a file by URL.
--
-- WooCommerce stores a downloadable product's file as an address and serves it
-- to every buyer, for as long as the product sells. Its API cannot upload into
-- the protected downloads folder, so until now the creator attached the file by
-- hand (ADR 0001's assisted step). ADR 0012 replaces that for WooCommerce: the
-- product carries a Fanwise address, and each request to it re-checks that the
-- listing and the file still stand, then redirects to a download link that
-- lives five minutes.
--
-- The address holds a random token. This table keeps two forms of it:
--
--   token_hash       sha256, hex. How a request is matched, so the lookup never
--                    needs the token itself to be stored readable.
--   encrypted_token  sealed by the credentials service, bound to the workspace,
--                    listing and asset. How a later publish sends the same
--                    address again instead of minting a new one, which would
--                    change the file under every past buyer's download.
--
-- Service role only, like channel_connection_secrets: no grant to anon or
-- authenticated, RLS on with no policy. The public route reads it server-side.

create table public.delivery_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_listing_id uuid not null,
  product_asset_id uuid not null,
  token_hash text not null unique,
  encrypted_token text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  -- A revoked link answers 404. Replacing a link revokes the old one.
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint delivery_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Composite, so a link cannot pair a listing or a file with another tenant.
  constraint delivery_links_listing_workspace_fkey foreign key (channel_listing_id, workspace_id)
    references public.channel_listings (id, workspace_id) on delete cascade,
  constraint delivery_links_asset_workspace_fkey foreign key (product_asset_id, workspace_id)
    references public.product_assets (id, workspace_id) on delete cascade
);

comment on table public.delivery_links is
  'Download addresses a storefront serves to buyers (ADR 0012). Token stored hashed for lookup and sealed for reuse. Service role only.';

-- One live link per file per listing.
create unique index delivery_links_one_active
  on public.delivery_links (channel_listing_id, product_asset_id)
  where revoked_at is null;

create index delivery_links_workspace_id_idx on public.delivery_links (workspace_id);

alter table public.delivery_links enable row level security;
revoke all on public.delivery_links from anon, authenticated;
