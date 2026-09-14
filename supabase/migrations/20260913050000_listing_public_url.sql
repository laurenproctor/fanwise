-- Where a buyer goes, kept apart from where the creator goes.
--
-- `external_url` has always been the address the creator uses to reach the
-- object on the channel, and for the two owned storefronts that is the admin
-- editor: it is the only address that works while a product is still a draft,
-- which is every product an adapter has just created. The public product page
-- read the same column, so its "View" buttons sent visitors to a Shopify or
-- WooCommerce admin login.
--
-- `public_url` is the storefront address, written by the publishing runner only
-- when the channel confirms the object is on sale, and cleared when it stops
-- being. The public page reads nothing else.

alter table public.channel_listings
  add column public_url text;

comment on column public.channel_listings.public_url is
  'The address a buyer uses. Set only while the channel reports the object live and purchasable; null otherwise. external_url is the creator''s address and may be an admin page.';

-- Etsy's external_url is already the public listing once active, so those rows
-- carry over. The two storefronts cannot be backfilled from here: their public
-- address comes from the provider, and each fills in at its next publish or
-- update.
update public.channel_listings l
set public_url = l.external_url
from public.channels c
where c.id = l.channel_id
  and c.key = 'etsy'
  and l.status = 'published'
  and l.external_url like 'https://www.etsy.com/listing/%'
  and coalesce(l.metadata ->> 'purchasable', 'true') <> 'false';

-- The anonymous grant moves from the creator's address to the buyer's. An admin
-- URL names the store's backend and is not a visitor's business.
revoke select (external_url) on public.channel_listings from anon;
grant select (public_url) on public.channel_listings to anon;

drop policy "live listings behind a published public page are readable by anyone"
  on public.channel_listings;

create policy "live listings behind a published public page are readable by anyone"
  on public.channel_listings for select to anon
  using (
    status = 'published'
    and public_url is not null
    and exists (
      select 1
      from public.public_product_pages pp
      join public.public_profiles pr on pr.id = pp.public_profile_id
      where pp.product_id = channel_listings.product_id
        and pp.status = 'published'
        and pr.status = 'published'
    )
  );
