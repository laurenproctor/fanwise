-- ---------------------------------------------------------------------------
-- Three columns, for three things a channel listing could not previously say.
--
--   1. seo_title, seo_description
--
--      Shopify's product `seo` input has both halves and Fanwise sent only one
--      of them, derived from short_description. A creator who wants the search
--      result to read differently from the product blurb had no field to say so
--      in, and the meta title was never sent at all.
--
--      Channel-shaped, so they live here and not on products, per architecture
--      invariant 1. Both are nullable and null is meaningful: it means "no
--      override", and the adapter falls back to the listing title and the short
--      description exactly as it did before this migration.
--
--   2. publish_generation, on both tables
--
--      A publish idempotency key is derived from (workspace, listing) and
--      nothing else, deliberately: two clicks of Publish are one operation. The
--      unstated assumption in that is that the external object, once created,
--      continues to exist.
--
--      It does not always. A product deleted in the Shopify admin leaves a
--      listing pointing at an id that 404s, and there is no way back: the
--      publish key is already claimed, and the runner's second guard finds an
--      earlier succeeded publish job and skips. The creator is left holding a
--      dead link with a Publish button that reports "already published".
--
--      The generation is what makes re-publishing a genuinely new operation
--      rather than a repeat of the old one. It is incremented only when the
--      provider has confirmed the object is gone — never on a failure, never on
--      a guess — and it is part of the publish and activate keys, so a new
--      generation gets a new key without weakening the check within one
--      generation. Two clicks still collide. Rule 1 is intact.
--
--      It is on publication_jobs as well because the runner's second guard asks
--      "has a publish for this listing already succeeded?", and the honest
--      version of that question is "at this generation". Without the column the
--      guard would go on skipping the re-publish that the new key just made
--      possible.
--
--   3. A repair, for the Shopify listings whose category is a Fanwise slug
--
--      Shopify's Category field is the Standard Product Taxonomy, not free
--      text, and the adapter now sends it. Existing Shopify listings carry
--      `category` seeded from the Fanwise product_type enum ('font', 'photo'),
--      which is not a label the taxonomy map knows, so without this they would
--      render as an unrecognised category in the editor and publish with no
--      category at all.
--
--      Scoped to Shopify listings by a join on channels.key. The column is
--      shared with every other channel and the mock adapters use it for their
--      own values; rewriting those would be this migration reaching outside
--      what it is for.
-- ---------------------------------------------------------------------------

alter table public.channel_listings
  add column seo_title text,
  add column seo_description text,
  add column publish_generation integer not null default 0,
  add constraint channel_listings_publish_generation_non_negative
    check (publish_generation >= 0);

comment on column public.channel_listings.seo_title is
  'Meta title override. Null means the adapter falls back to the listing title.';

comment on column public.channel_listings.seo_description is
  'Meta description override. Null means the adapter falls back to the short description.';

comment on column public.channel_listings.publish_generation is
  'Incremented only when the provider confirms the external object no longer exists. Part of the publish and activate idempotency keys, so a re-publish after a deletion is a new operation rather than a blocked repeat.';

alter table public.publication_jobs
  add column publish_generation integer not null default 0;

comment on column public.publication_jobs.publish_generation is
  'The listing generation this job was started at. The runner''s already-published guard is scoped to it, so a job from an earlier generation does not block a re-publish.';

-- The repair. update ... from is used rather than a correlated subquery so the
-- join is visible; every mapping below is the same one lib/channels/adapters/
-- shopify/categories.ts applies to a freshly built listing, and a unit test
-- holds the two in agreement.
update public.channel_listings as l
set category = case c.slug
  when 'font' then 'Fonts'
  when 'template' then 'Document Templates'
  when 'graphic' then 'Digital Artwork'
  when 'photo' then 'Stock Photographs & Video Footage'
  when 'illustration' then 'Digital Artwork'
  when 'icon' then 'Computer Icons'
  when 'mockup' then 'Document Templates'
  when 'brush' then 'Digital Artwork'
  when 'three_d' then 'Digital Artwork'
  when 'theme' then 'Web Design Software'
  when 'other' then 'Digital Goods & Currency'
end
from (
  select l2.id, l2.category as slug
  from public.channel_listings l2
  join public.channels ch on ch.id = l2.channel_id
  where ch.key = 'shopify'
    and l2.category in (
      'font', 'template', 'graphic', 'photo', 'illustration',
      'icon', 'mockup', 'brush', 'three_d', 'theme', 'other'
    )
) as c
where l.id = c.id;
