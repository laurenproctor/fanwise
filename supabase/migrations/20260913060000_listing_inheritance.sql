-- Listings inherit the product's words unless they say otherwise.
--
-- Until now a build copied the product's title, description, short description
-- and price into every listing, and a later edit to the product changed none of
-- them: a creator who fixed a typo fixed it once per channel. An empty column
-- now means "whatever the product says", resolved on every read
-- (lib/channels/listings.ts). No column changes shape; what changes is what an
-- empty one means.
--
-- This backfill turns the copies that still match their product into inherited
-- fields. A listing whose value differs — edited by hand, or written by a
-- generation — is left exactly as it is, because that difference is the whole
-- point of a per-channel listing.

update public.channel_listings l
set title = null
from public.products p
where p.id = l.product_id
  and l.title is not null
  and l.title = coalesce(p.canonical_title, p.name);

update public.channel_listings l
set description = null
from public.products p
where p.id = l.product_id
  and l.description is not null
  and l.description is not distinct from p.canonical_description;

update public.channel_listings l
set short_description = null
from public.products p
where p.id = l.product_id
  and l.short_description is not null
  and l.short_description is not distinct from p.short_description;

-- Price carries its currency: an inherited price is quoted in the product's
-- currency, so a listing selling in another one keeps both.
update public.channel_listings l
set price = null
from public.products p
where p.id = l.product_id
  and l.price is not null
  and l.price = p.base_price
  and l.currency = p.currency;

comment on column public.channel_listings.title is
  'This channel''s own title, or null to use the product''s (canonical_title, falling back to name).';
comment on column public.channel_listings.description is
  'This channel''s own description, or null to use the product''s canonical_description.';
comment on column public.channel_listings.short_description is
  'This channel''s own short description, or null to use the product''s.';
comment on column public.channel_listings.price is
  'This channel''s own price, in this row''s currency, or null to use the product''s base_price and currency.';
