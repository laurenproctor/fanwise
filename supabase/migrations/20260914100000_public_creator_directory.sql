-- The public creator directory at /creators.
--
-- Four changes, all additive except the one policy that is replaced.
--
--   1. `public_featured_profiles`: the editorial selection behind "Featured
--      creators · Selected by Fanwise". One row per featured profile, with an
--      explicit rank. It is written by Fanwise, never by a creator: `anon`
--      reads it, `authenticated` holds no grant on it at all, and only the
--      service role can insert. A creator who could write this table could
--      feature themselves, which would turn a label that says "Selected by
--      Fanwise" into a lie.
--
--   2. `public_creator_directory`: one row per public creator, with the counts,
--      the product types and up to four representative products the directory
--      renders. A view, not a table, so there is no second copy of anything to
--      keep in step with publishing. It is `security_invoker`, which is the
--      whole of its safety: it runs as the role that queries it, so `anon`
--      sees through it exactly what `anon` sees in the tables beneath it —
--      published profiles, published pages under them, and only the product
--      columns 20260912010000 granted. It adds no access. A default
--      (definer) view would run as its owner and read every draft in every
--      workspace, which is why Supabase's linter refuses one.
--
--      It is not a function, and that is deliberate. The public read path
--      executes no function in `public`; tests/db/function-privileges.test.ts
--      holds that line and this migration does not cross it.
--
--   3. The `anon` policy on `products` gains `archived_at is null`. An
--      archived product is not for sale, and before this nothing took it off
--      the public web: the policy asked only whether a published page pointed
--      at it. `archived_at` is not granted to `anon`, so no query written as
--      `anon` could filter on it. A policy expression is not subject to column
--      grants, so the policy is the one place the rule can live. Every public
--      surface inherits it: the profile catalog drops the card, the product
--      page answers 404, and the directory neither shows nor counts it.
--
--   4. `creators` joins the reserved workspace slugs, because /creators is now
--      a static route and would shadow a workspace of that name. It is already
--      a reserved handle (20260912010000). Kept in step with
--      RESERVED_WORKSPACE_SLUGS in lib/slug.ts, which a unit test checks
--      against the route tree.
--
-- Deploy precondition: no workspace may already be slugged `creators`, or the
-- constraint in (4) refuses to apply. Check with
--   select id from public.workspaces where slug = 'creators';
--
-- Rollback, in order: drop the two views; drop public_featured_profiles
-- (loses the editorial selection, which has no other copy); restore the
-- products policy from 20260912010000; restore workspaces_slug_not_reserved
-- without 'creators', after checking `app/(marketing)/creators` is gone.

-- ---------------------------------------------------------------------------
-- public_featured_profiles
-- ---------------------------------------------------------------------------

create table public.public_featured_profiles (
  public_profile_id uuid primary key
    references public.public_profiles (id) on delete cascade,
  -- Lower is earlier. Unique, so the section's order is decided by the row
  -- and never by whatever order the planner happens to return ties in.
  rank smallint not null,
  created_at timestamptz not null default now(),

  constraint public_featured_profiles_rank_range check (rank between 1 and 1000),
  constraint public_featured_profiles_rank_unique unique (rank)
);

comment on table public.public_featured_profiles is
  'Fanwise''s editorial selection for the Featured creators section of /creators. Written by the service role only; a creator can never feature themselves. Being listed here grants no visibility: a featured profile appears only while it is published and has a published product.';

comment on column public.public_featured_profiles.rank is
  'Display order within the section, lowest first. Unique, so the order is deterministic.';

alter table public.public_featured_profiles enable row level security;

revoke all on public.public_featured_profiles from anon, authenticated;
grant select on public.public_featured_profiles to anon;

-- Readable only while the profile it names is published, so the table cannot
-- be used to learn that an unpublished profile exists. Named in the subquery
-- rather than left to the profile's own RLS, for the reason 20260912010000
-- gives: it fails closed if that policy is ever widened.
create policy "featured published profiles are readable by visitors"
  on public.public_featured_profiles for select to anon
  using (
    exists (
      select 1
      from public.public_profiles p
      where p.id = public_featured_profiles.public_profile_id
        and p.status = 'published'
    )
  );

-- ---------------------------------------------------------------------------
-- Archived products leave the public web
-- ---------------------------------------------------------------------------

drop policy "products behind a published public page are readable by anyone"
  on public.products;

create policy "products behind a published public page are readable by anyone"
  on public.products for select to anon
  using (
    archived_at is null
    and exists (
      select 1
      from public.public_product_pages pp
      join public.public_profiles pr on pr.id = pp.public_profile_id
      where pp.product_id = products.id
        and pp.status = 'published'
        and pr.status = 'published'
    )
  );

-- ---------------------------------------------------------------------------
-- public_creator_directory
--
-- The statuses are named even though RLS already enforces them for `anon`.
-- Same belt and braces as lib/public/queries.ts: a reader should not have to
-- open three migrations to know what this returns. The inner join to
-- `products` is what applies the archived rule above, so it must stay inner.
--
-- Representative products, at most four, in this order: a page the creator
-- marked featured; one with a showable image; the creator's own arrangement
-- (display_order); the most recently published; the slug, which is unique per
-- profile and so settles every tie.
--
-- `search_text` is lowercase public text only: the name, the introduction,
-- the About, the place, and the titles and types of published products. It is
-- matched with ilike. Country names are not in it, because the names live in
-- lib/location; the application maps a query onto country codes instead.
-- ---------------------------------------------------------------------------

create view public.public_creator_directory
with (security_invoker = true)
as
select
  pr.id,
  pr.handle::text as handle,
  pr.display_name,
  lower(pr.display_name) as sort_name,
  pr.short_bio,
  pr.city,
  pr.country_code,
  pr.location,
  pr.avatar_path is not null as has_avatar,
  pr.updated_at,
  f.rank as featured_rank,
  count(*)::integer as product_count,
  max(pp.published_at) as latest_published_at,
  -- For filtering (`cs`). Display order comes from public_creator_product_types.
  array_agg(distinct p.product_type order by p.product_type) as product_types,
  jsonb_path_query_array(
    jsonb_agg(
      jsonb_build_object(
        'slug', pp.slug::text,
        'title', coalesce(pp.title_override, p.canonical_title, p.name),
        'productType', p.product_type,
        'coverAssetId', cover.id
      )
      order by
        pp.featured desc,
        (cover.id is not null) desc,
        pp.display_order,
        pp.published_at desc,
        pp.slug
    ),
    '$[0 to 3]'
  ) as previews,
  lower(
    concat_ws(
      ' ',
      pr.display_name,
      pr.short_bio,
      pr.about,
      pr.city,
      pr.location,
      string_agg(coalesce(pp.title_override, p.canonical_title, p.name), ' '),
      string_agg(replace(p.product_type::text, '_', ' '), ' ')
    )
  ) as search_text
from public.public_profiles pr
join public.public_product_pages pp
  on pp.public_profile_id = pr.id
 and pp.status = 'published'
join public.products p
  on p.id = pp.product_id
left join lateral (
  -- The image a card would lead with: the page's chosen cover if it is a
  -- showable image, otherwise the first gallery image. The same filters the
  -- public asset route applies, so a preview never points at an image that
  -- route would refuse and render as a broken frame.
  select a.id
  from public.product_assets a
  where a.product_id = pp.product_id
    and a.asset_state = 'ready'
    and a.asset_type in ('cover_image', 'preview_image', 'specimen', 'screenshot', 'promotional')
    and a.mime_type like 'image/%'
  order by coalesce(a.id = pp.cover_asset_id, false) desc, a.sort_order, a.id
  limit 1
) cover on true
left join public.public_featured_profiles f
  on f.public_profile_id = pr.id
where pr.status = 'published'
group by pr.id, f.rank;

comment on view public.public_creator_directory is
  'One row per public creator for /creators: a published profile with at least one published, unarchived product. security_invoker, so it grants nothing beyond the tables beneath it.';

-- The product types a creator publishes, most published first. Its own view
-- over the same rows rather than a column above, because ordering by a count
-- needs a second level of aggregation.
create view public.public_creator_product_types
with (security_invoker = true)
as
select
  pp.public_profile_id,
  p.product_type,
  count(*)::integer as product_count
from public.public_product_pages pp
join public.public_profiles pr
  on pr.id = pp.public_profile_id
 and pr.status = 'published'
join public.products p
  on p.id = pp.product_id
where pp.status = 'published'
group by pp.public_profile_id, p.product_type;

comment on view public.public_creator_product_types is
  'Published, unarchived product counts per public creator and product type. Backs the directory''s product-type filter and each creator''s primary types. security_invoker.';

-- The places public creators are in, for the Country and City filters. Distinct
-- pairs only, so the filter menu never has to read the directory itself.
create view public.public_creator_locations
with (security_invoker = true)
as
select distinct d.country_code, d.city
from public.public_creator_directory d
where d.country_code is not null;

comment on view public.public_creator_locations is
  'Distinct country and city pairs among public creators, for the directory filters. security_invoker.';

-- Views in `public` are granted to both API roles by default. Only `anon`
-- renders the directory (lib/supabase/public.ts is cookie-less), so only
-- `anon` may read these. As `authenticated` the member policies would let a
-- creator's own drafts through, which is a view of the directory nobody else
-- has.
revoke all on public.public_creator_directory from anon, authenticated;
revoke all on public.public_creator_product_types from anon, authenticated;
revoke all on public.public_creator_locations from anon, authenticated;
grant select on public.public_creator_directory to anon;
grant select on public.public_creator_product_types to anon;
grant select on public.public_creator_locations to anon;

-- ---------------------------------------------------------------------------
-- One more reserved workspace slug
-- ---------------------------------------------------------------------------

alter table public.workspaces
  drop constraint workspaces_slug_not_reserved;

alter table public.workspaces
  add constraint workspaces_slug_not_reserved check (
    slug <> all (
      array[
        'about',
        'api',
        'auth',
        'creators',
        'forgot-password',
        'how-it-works',
        'marketplaces',
        'onboarding',
        'pricing',
        'privacy',
        'profile',
        'reset-password',
        'sign-in',
        'sign-up',
        'start',
        'terms'
      ]
    )
  );
