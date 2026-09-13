-- The public profile as a storefront: structured location, links a creator
-- chooses, a longer About, and publishing every eligible product at once.
--
-- Six changes, in the order they have to happen.
--
--   1. `public_profiles` gains `city`, `country_code` and `about`. The free-text
--      `location` column stays, untouched, for every profile that has one:
--      nothing parses it, so nothing can corrupt it. A profile shows its
--      structured location once it has one and its legacy text until then,
--      and publishing a structured location is what clears the legacy text.
--
--   2. `public_profile_links`, one row per link, in order. The live profile
--      read `website_url`, `instagram_url` and `behance_url`; those three
--      values are copied into rows here, and the columns are left in place
--      but no longer read or written by the application. Publication nulls
--      them, so a link a creator has removed is not left readable by `anon`
--      in a column the page no longer shows.
--
--   3. `public_profile_drafts` gains `city`, `country_code`, `about` and
--      `links`, the last a jsonb array like the draft's `products`. Existing
--      drafts are backfilled: links from the three typed fields, with an
--      Instagram or Behance username turned into the address it stands for,
--      and nothing dropped even when what was typed does not parse. The old
--      draft columns likewise stay and stop being written.
--
--   4. `publish_profile_product_pages()`, the loop that publishes a profile's
--      product pages, moved out of `publish_public_profile()` so the second
--      caller below cannot drift from it. No grant to anybody: only the two
--      security definer functions call it.
--
--   5. `publish_public_profile()` replaced, same signature, snapshotting and
--      writing the new fields and links.
--
--   6. `publish_all_profile_products()`, new. Publishes the named products'
--      pages on an already-live profile in one transaction, keeps the draft's
--      arrangement in step so the next builder publish does not take them
--      down again, and records a publication. It changes public Fanwise
--      visibility only: no listing, channel or connection is read or written.
--
-- And one small change beside them: `profile` joins the reserved product
-- slugs, because the profile's management page moves to `/<workspace>/profile`
-- and would otherwise shadow a product slugged `profile`.
--
-- Rollback: restore publish_public_profile() from
-- 20260913020000_profile_contact_and_location.sql; drop
-- publish_all_profile_products() and publish_profile_product_pages(); drop
-- public_profile_links (the three legacy columns still hold what was live when
-- this migration ran, but not links changed since); drop the added draft and
-- profile columns; restore products_slug_not_reserved without 'profile'. Data
-- loss on rollback: every link, city, country and About written after this
-- migration.

-- ---------------------------------------------------------------------------
-- Reserved product slug: profile
-- ---------------------------------------------------------------------------

-- A product already slugged `profile` is moved rather than refused: a product
-- slug is an address inside the application only, and a failed migration
-- would block every other change here for one unlikely row.
update public.products
set slug = 'profile-' || substr(md5(id::text), 1, 4)
where slug = 'profile';

alter table public.products
  drop constraint products_slug_not_reserved;

alter table public.products
  add constraint products_slug_not_reserved check (
    slug <> all (array['assets', 'channels', 'new', 'profile', 'settings'])
  );

-- ---------------------------------------------------------------------------
-- public_profiles: city, country, About
-- ---------------------------------------------------------------------------

alter table public.public_profiles
  add column city text,
  add column country_code text,
  add column about text;

alter table public.public_profiles
  add constraint public_profiles_country_code_format
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add constraint public_profiles_city_length
    check (city is null or length(btrim(city)) between 1 and 80),
  -- A city means nothing without the country it is in: "Paris" is in France
  -- and in Texas. The application checks the pair against its dataset; this
  -- is the half that holds on any other path.
  add constraint public_profiles_city_needs_country
    check (city is null or country_code is not null),
  add constraint public_profiles_about_length
    check (about is null or length(btrim(about)) between 1 and 2000);

comment on column public.public_profiles.location is
  'Legacy free-text location, from before city and country. Shown only when country_code is null; publishing a structured location clears it.';
comment on column public.public_profiles.city is
  'A city name as spelled in the location dataset (lib/location). Requires country_code.';
comment on column public.public_profiles.country_code is
  'ISO 3166-1 alpha-2, uppercase. The display name is derived, never stored.';
comment on column public.public_profiles.website_url is
  'Deprecated: superseded by public_profile_links. Not read by the application; nulled on publish.';
comment on column public.public_profiles.instagram_url is
  'Deprecated: superseded by public_profile_links. Not read by the application; nulled on publish.';
comment on column public.public_profiles.behance_url is
  'Deprecated: superseded by public_profile_links. Not read by the application; nulled on publish.';

-- ---------------------------------------------------------------------------
-- public_profile_links
-- ---------------------------------------------------------------------------

create table public.public_profile_links (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null,
  public_profile_id uuid not null,
  position smallint not null,
  url text not null,
  -- Null derives a label from the address when the page renders.
  label text,
  created_at timestamptz not null default now(),

  -- Only ever https, the rule every link on a public page has kept since
  -- 20260912010000. The application validates too; this holds on every path.
  constraint public_profile_links_url_https
    check (url ~ '^https://[^\s<>"]+$' and length(url) <= 2048),
  constraint public_profile_links_label_length
    check (label is null or length(btrim(label)) between 1 and 40),
  -- The same ceiling the builder enforces.
  constraint public_profile_links_position_range
    check (position between 0 and 7),
  constraint public_profile_links_position_unique
    unique (public_profile_id, position),

  -- The tenant boundary as a foreign key, as on every child of a profile.
  constraint public_profile_links_profile_fk
    foreign key (public_profile_id, workspace_id)
    references public.public_profiles (id, workspace_id)
    on delete cascade
);

comment on table public.public_profile_links is
  'The links a published profile shows, in order. Written only by publish_public_profile(); readable by anyone while the profile is published.';

create index public_profile_links_workspace_idx
  on public.public_profile_links (workspace_id);

alter table public.public_profile_links enable row level security;

revoke all on public.public_profile_links from anon, authenticated;
-- Read only, for both roles. No member writes a link row directly: the one
-- writer is the publish function, so a live link can only be one that went
-- through review.
grant select on public.public_profile_links to anon, authenticated;

create policy "links of published profiles are readable by anyone"
  on public.public_profile_links for select to anon, authenticated
  using (
    exists (
      select 1
      from public.public_profiles p
      where p.id = public_profile_links.public_profile_id
        and p.status = 'published'
    )
  );

create policy "profile links are readable by workspace members"
  on public.public_profile_links for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Backfill: what each profile shows today, in the order it showed it.
insert into public.public_profile_links (workspace_id, public_profile_id, position, url)
select p.workspace_id, p.id, (row_number() over (partition by p.id order by l.ord) - 1)::smallint, l.url
from public.public_profiles p
cross join lateral (
  values (1, p.website_url), (2, p.instagram_url), (3, p.behance_url)
) as l (ord, url)
where l.url is not null;

-- ---------------------------------------------------------------------------
-- public_profile_drafts: city, country, About, links
-- ---------------------------------------------------------------------------

alter table public.public_profile_drafts
  add column city text not null default '',
  add column country_code text not null default '',
  add column about text not null default '',
  add column links jsonb not null default '[]'::jsonb;

-- Bounded, never shape-checked beyond structure, like every draft field: a
-- half-typed address has to survive a refresh.
alter table public.public_profile_drafts
  add constraint public_profile_drafts_city_length check (length(city) <= 200),
  add constraint public_profile_drafts_country_code_length check (length(country_code) <= 2),
  add constraint public_profile_drafts_about_length check (length(about) <= 2000),
  add constraint public_profile_drafts_links_array
    check (
      jsonb_typeof(links) = 'array'
      and jsonb_array_length(links) <= 8
      and length(links::text) <= 20000
    );

comment on column public.public_profile_drafts.links is
  'As typed: an array of { url, label } in display order, at most 8. Validated at Continue and at publish, never on save.';
comment on column public.public_profile_drafts.website is
  'Deprecated: superseded by links. Not written by the application.';
comment on column public.public_profile_drafts.instagram is
  'Deprecated: superseded by links. Not written by the application.';
comment on column public.public_profile_drafts.behance is
  'Deprecated: superseded by links. Not written by the application.';

-- A bare Instagram or Behance username becomes its address, because the
-- links field takes addresses; anything else is carried as typed, so a value
-- that does not parse is still there to be fixed rather than gone.
update public.public_profile_drafts d
set links = coalesce((
  select jsonb_agg(jsonb_build_object('url', l.url, 'label', '') order by l.ord)
  from (
    values
      (1, nullif(btrim(d.website), '')),
      (2, case
            when btrim(d.instagram) ~ '^@?[A-Za-z0-9._]{1,30}$'
              then 'https://www.instagram.com/' || regexp_replace(btrim(d.instagram), '^@', '') || '/'
            else nullif(btrim(d.instagram), '')
          end),
      (3, case
            when btrim(d.behance) ~ '^@?[A-Za-z0-9_-]{1,64}$'
              then 'https://www.behance.net/' || regexp_replace(btrim(d.behance), '^@', '')
            else nullif(btrim(d.behance), '')
          end)
  ) as l (ord, url)
  where l.url is not null
), '[]'::jsonb)
where d.links = '[]'::jsonb;

-- Drafts that exist today are copies of a profile that has no structured
-- location or About yet, so there is nothing to copy for those three.

-- ---------------------------------------------------------------------------
-- publish_profile_product_pages
-- ---------------------------------------------------------------------------

create or replace function public.publish_profile_product_pages(
  p_public_profile_id uuid,
  p_workspace_id uuid,
  p_ids uuid[],
  p_hide_others boolean
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_product uuid;
  v_position bigint;
  v_page_id uuid;
  v_base text;
  v_slug text;
  v_attempt integer;
begin
  for v_product, v_position in
    select x, ord from unnest(p_ids) with ordinality as t(x, ord)
  loop
    select id into v_page_id
    from public.public_product_pages
    where public_profile_id = p_public_profile_id
      and product_id = v_product;

    if v_page_id is not null then
      update public.public_product_pages
      set status = 'published',
          published_at = coalesce(published_at, v_now),
          display_order = (v_position - 1)::integer,
          featured = false
      where id = v_page_id;
    else
      select lower(p.slug::text) into v_base
      from public.products p
      where p.id = v_product
        and p.workspace_id = p_workspace_id;

      if v_base is null then
        raise exception 'product is not in this workspace' using errcode = '42501';
      end if;

      -- The product's own slug first; a short suffix if the profile already
      -- uses it (live or retired) or it is reserved.
      v_attempt := 0;
      loop
        v_slug := case
          when v_attempt = 0 then v_base
          else left(v_base, 59) || '-' || substr(md5(extensions.gen_random_uuid()::text), 1, 4)
        end;
        begin
          insert into public.public_product_pages (
            workspace_id, public_profile_id, product_id, slug,
            status, display_order, featured, published_at
          )
          values (
            p_workspace_id, p_public_profile_id, v_product, v_slug::extensions.citext,
            'published', (v_position - 1)::integer, false, v_now
          );
          exit;
        exception when unique_violation or check_violation then
          v_attempt := v_attempt + 1;
          if v_attempt > 5 then
            raise;
          end if;
        end;
      end loop;
    end if;

    v_page_id := null;
    v_base := null;
  end loop;

  -- Everything not named goes back to draft, in the caller's transaction, so
  -- a product the builder hid is never left public.
  if p_hide_others then
    update public.public_product_pages
    set status = 'draft',
        published_at = null,
        featured = false
    where public_profile_id = p_public_profile_id
      and not (product_id = any (p_ids))
      and (status = 'published' or featured);
  end if;
end;
$$;

comment on function public.publish_profile_product_pages is
  'Internal. Publishes the named product pages of a profile in order, creating any that do not exist, and optionally returns every other page to draft. Called only by publish_public_profile() and publish_all_profile_products(), which authorize first.';

-- Nobody executes this directly. The two security definer callers run as the
-- function owner, which needs no grant.
revoke all on function public.publish_profile_product_pages(uuid, uuid, uuid[], boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The live links of a profile, as the jsonb a snapshot records.
-- ---------------------------------------------------------------------------

create or replace function public.profile_links_snapshot(p_public_profile_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('url', l.url, 'label', l.label) order by l.position),
    '[]'::jsonb
  )
  from public.public_profile_links l
  where l.public_profile_id = p_public_profile_id;
$$;

comment on function public.profile_links_snapshot is
  'Internal. The live links of a profile in snapshot form. Called only by the publish functions.';

revoke all on function public.profile_links_snapshot(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- publish_public_profile
-- ---------------------------------------------------------------------------

create or replace function public.publish_public_profile(
  p_public_profile_id uuid,
  p_expected_draft_updated_at timestamptz,
  p_values jsonb,
  p_product_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.public_profiles;
  v_draft public.public_profile_drafts;
  v_latest public.public_profile_publications;
  v_ids uuid[] := coalesce(p_product_ids, array[]::uuid[]);
  v_handle text;
  v_links jsonb;
  v_snapshot jsonb;
  v_recorded jsonb;
  v_ever_published boolean;
  v_now timestamptz := now();
  v_publication_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_profile
  from public.public_profiles
  where id = p_public_profile_id
  for update;

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(v_profile.workspace_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_draft
  from public.public_profile_drafts
  where public_profile_id = p_public_profile_id
  for update;

  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;

  if v_draft.updated_at is distinct from p_expected_draft_updated_at then
    -- PT409, not serialization_failure (40001): PostgREST retries a 40001
    -- transaction itself, which would re-run this same refusal until the
    -- request timed out.
    raise exception 'the draft changed after it was reviewed' using errcode = 'PT409';
  end if;

  if jsonb_typeof(p_values) is distinct from 'object' then
    raise exception 'malformed publish values' using errcode = '22023';
  end if;

  -- The product list: no repeats, each one visible in the draft, in the
  -- draft's order.
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) as x) then
    raise exception 'a product appears twice' using errcode = '23514';
  end if;

  if exists (
    with requested as (
      select x as product_id, ord from unnest(v_ids) with ordinality as t(x, ord)
    ),
    arranged as (
      select public.uuid_or_null(e ->> 'productId') as product_id,
             (e ->> 'visible')::boolean as visible,
             ord
      from jsonb_array_elements(v_draft.products) with ordinality as d(e, ord)
    ),
    matched as (
      select r.ord as requested_ord,
             a.ord as arranged_ord,
             a.visible,
             lag(a.ord) over (order by r.ord) as previous_arranged_ord
      from requested r
      left join arranged a on a.product_id = r.product_id
    )
    select 1 from matched
    where arranged_ord is null
       or visible is not true
       or (previous_arranged_ord is not null and arranged_ord <= previous_arranged_ord)
  ) then
    raise exception 'the product list does not match the draft' using errcode = '23514';
  end if;

  -- Links: an array of { url, label }, each url https, at most eight. The
  -- table's constraints refuse anything else too; checking here first turns
  -- a malformed call into one clear refusal before anything is written.
  v_links := coalesce(p_values -> 'links', '[]'::jsonb);
  if jsonb_typeof(v_links) <> 'array' or jsonb_array_length(v_links) > 8 then
    raise exception 'malformed links' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_links) e
    -- coalesce, because jsonb_typeof of a missing key is null, and a null
    -- comparison would wave through an entry that has no url at all.
    where jsonb_typeof(e) <> 'object'
       or coalesce(jsonb_typeof(e -> 'url'), 'missing') <> 'string'
       or (e ? 'label' and jsonb_typeof(e -> 'label') not in ('string', 'null'))
  ) then
    raise exception 'malformed links' using errcode = '22023';
  end if;
  -- Canonical form: label null when empty, and nothing but url and label.
  v_links := (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('url', e ->> 'url', 'label', nullif(btrim(coalesce(e ->> 'label', '')), ''))
        order by ord
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(v_links) with ordinality as t(e, ord)
  );

  v_handle := lower(btrim(coalesce(p_values ->> 'handle', '')));

  v_snapshot := jsonb_build_object(
    'handle', v_handle,
    'display_name', p_values ->> 'display_name',
    'short_bio', nullif(p_values ->> 'short_bio', ''),
    'about', nullif(p_values ->> 'about', ''),
    'links', v_links,
    'city', nullif(p_values ->> 'city', ''),
    'country_code', nullif(p_values ->> 'country_code', ''),
    'location', nullif(p_values ->> 'location', ''),
    'contact_url', nullif(p_values ->> 'contact_url', ''),
    'avatar_path', v_draft.avatar_path,
    'product_ids', to_jsonb(v_ids)
  );

  select * into v_latest
  from public.public_profile_publications
  where public_profile_id = p_public_profile_id
  order by published_at desc
  limit 1;

  -- Idempotency: already live, and live is exactly this. A publication
  -- recorded before a field existed has no key for it; the live row's value is
  -- what that publication left, so it fills the gap. The three retired link
  -- keys are dropped, because `links` now says what they said.
  if v_latest.id is not null then
    v_recorded := jsonb_build_object(
        'location', v_profile.location,
        'contact_url', v_profile.contact_url,
        'city', v_profile.city,
        'country_code', v_profile.country_code,
        'about', v_profile.about,
        'links', public.profile_links_snapshot(p_public_profile_id)
      )
      || (v_latest.snapshot - 'website_url' - 'instagram_url' - 'behance_url');
  end if;

  if v_profile.status = 'published' and v_latest.id is not null and v_recorded = v_snapshot then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'publication_id', v_latest.id,
      'handle', v_profile.handle::text,
      'previous_handle', v_profile.handle::text,
      'previous_avatar_path', v_profile.avatar_path
    );
  end if;

  v_ever_published := v_profile.status = 'published' or v_latest.id is not null;

  -- The handle, exactly as before: a profile that has been public keeps its
  -- old handle as a permanent redirect.
  if v_profile.handle::text <> v_handle then
    if v_ever_published then
      delete from public.public_handle_history
      where public_profile_id = p_public_profile_id
        and handle = v_handle::extensions.citext;

      update public.public_profiles
      set handle = v_handle::extensions.citext
      where id = p_public_profile_id;

      insert into public.public_handle_history (public_profile_id, workspace_id, handle)
      values (p_public_profile_id, v_profile.workspace_id, v_profile.handle)
      on conflict (handle) do nothing;
    else
      update public.public_profiles
      set handle = v_handle::extensions.citext
      where id = p_public_profile_id;
    end if;
  end if;

  update public.public_profiles
  set display_name = v_snapshot ->> 'display_name',
      short_bio = v_snapshot ->> 'short_bio',
      about = v_snapshot ->> 'about',
      city = v_snapshot ->> 'city',
      country_code = v_snapshot ->> 'country_code',
      location = v_snapshot ->> 'location',
      contact_url = v_snapshot ->> 'contact_url',
      website_url = null,
      instagram_url = null,
      behance_url = null,
      avatar_path = v_draft.avatar_path,
      status = 'published',
      published_at = case when v_profile.status = 'published' then v_profile.published_at else v_now end
  where id = p_public_profile_id;

  -- Links: replaced wholesale, in order.
  delete from public.public_profile_links where public_profile_id = p_public_profile_id;
  insert into public.public_profile_links (workspace_id, public_profile_id, position, url, label)
  select v_profile.workspace_id, p_public_profile_id, (ord - 1)::smallint, e ->> 'url', e ->> 'label'
  from jsonb_array_elements(v_links) with ordinality as t(e, ord);

  perform public.publish_profile_product_pages(p_public_profile_id, v_profile.workspace_id, v_ids, true);

  insert into public.public_profile_publications (
    public_profile_id, workspace_id, handle, draft_updated_at, snapshot, published_by
  )
  values (
    p_public_profile_id, v_profile.workspace_id, v_handle::extensions.citext,
    v_draft.updated_at, v_snapshot, auth.uid()
  )
  returning id into v_publication_id;

  return jsonb_build_object(
    'outcome', 'published',
    'publication_id', v_publication_id,
    'handle', v_handle,
    'previous_handle', v_profile.handle::text,
    'previous_avatar_path', v_profile.avatar_path
  );
end;
$$;

comment on function public.publish_public_profile is
  'Publishes a profile draft onto the live profile, its links and its product pages in one transaction, and records the publication. Refuses a draft changed since review (PT409). Idempotent while the live snapshot is unchanged.';

revoke all on function public.publish_public_profile(uuid, timestamptz, jsonb, uuid[]) from public, anon;
grant execute on function public.publish_public_profile(uuid, timestamptz, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- publish_all_profile_products
-- ---------------------------------------------------------------------------
--
-- Load-bearing properties, each tested in tests/db/profile-publish-all.test.ts:
--
--   1. Authorized and scoped. Membership is re-checked inside (security
--      definer), and every product must belong to the profile's workspace and
--      not be archived. Listing liveness is an application rule
--      (lib/publishing), decided by the server action against the caller's own
--      RLS-scoped read before the call, the same trust publish_public_profile
--      already extends for its product list.
--
--   2. A live profile only. Publishing product pages under a draft profile
--      would make nothing visible, and a button that did that would say it
--      had. PT412 (HTTP 412 Precondition Failed) is not retried by PostgREST.
--
--   3. Additive. Named products are published; nothing already published is
--      taken down, and no other profile field changes. The draft's other
--      unpublished edits stay unpublished.
--
--   4. The draft follows. The arrangement shows every named product, in its
--      existing position or appended, so step 2 of the builder and its next
--      publish agree with what is now live. The revision moves, so a builder
--      tab open on the old arrangement reports a conflict instead of
--      overwriting this.
--
--   5. Idempotent. Nothing to change returns `unchanged` and writes nothing.
--      The profile row lock serializes two presses of the button.

create or replace function public.publish_all_profile_products(
  p_public_profile_id uuid,
  p_product_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.public_profiles;
  v_draft public.public_profile_drafts;
  v_has_draft boolean;
  v_ids uuid[] := coalesce(p_product_ids, array[]::uuid[]);
  v_arrangement jsonb;
  v_live uuid[];
  v_order uuid[];
  v_newly integer;
  v_snapshot jsonb;
  v_publication_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_profile
  from public.public_profiles
  where id = p_public_profile_id
  for update;

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(v_profile.workspace_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_profile.status <> 'published' then
    raise exception 'the profile is not published' using errcode = 'PT412';
  end if;

  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) as x) then
    raise exception 'a product appears twice' using errcode = '23514';
  end if;

  if cardinality(v_ids) > 0 and (
    select count(*)
    from public.products p
    where p.id = any (v_ids)
      and p.workspace_id = v_profile.workspace_id
      and p.archived_at is null
  ) <> cardinality(v_ids) then
    raise exception 'a product is not an eligible product of this workspace' using errcode = '42501';
  end if;

  -- What is live now, in display order.
  select coalesce(array_agg(pp.product_id order by pp.display_order, pp.published_at), array[]::uuid[])
  into v_live
  from public.public_product_pages pp
  where pp.public_profile_id = p_public_profile_id
    and pp.status = 'published';

  select count(*) into v_newly
  from unnest(v_ids) as x
  where not (x = any (v_live));

  select * into v_draft
  from public.public_profile_drafts
  where public_profile_id = p_public_profile_id
  for update;
  v_has_draft := found;

  if v_has_draft then
    -- The draft's entries in order, with every named product switched on,
    -- then any named product the draft has never arranged.
    select coalesce(jsonb_agg(entry order by ord), '[]'::jsonb) into v_arrangement
    from (
      select jsonb_build_object(
               'productId', e ->> 'productId',
               'visible', coalesce((e ->> 'visible')::boolean, false)
                          or coalesce(public.uuid_or_null(e ->> 'productId') = any (v_ids), false)
             ) as entry,
             ord
      from jsonb_array_elements(v_draft.products) with ordinality as d(e, ord)
      union all
      select jsonb_build_object('productId', x::text, 'visible', true),
             (jsonb_array_length(v_draft.products) + ord)
      from unnest(v_ids) with ordinality as t(x, ord)
      where not exists (
        select 1 from jsonb_array_elements(v_draft.products) e
        where public.uuid_or_null(e ->> 'productId') = x
      )
    ) as merged;
  else
    v_arrangement := null;
  end if;

  if v_newly = 0 and (not v_has_draft or v_arrangement = v_draft.products) then
    return jsonb_build_object('outcome', 'unchanged', 'published_count', 0);
  end if;

  -- The live order after this: the draft's order where it has one, then
  -- anything else already live in its current order.
  if v_has_draft then
    select coalesce(array_agg(pid order by ord), array[]::uuid[]) into v_order
    from (
      select public.uuid_or_null(e ->> 'productId') as pid, ord
      from jsonb_array_elements(v_arrangement) with ordinality as a(e, ord)
    ) as arranged
    where pid = any (v_ids) or pid = any (v_live);

    v_order := v_order || coalesce((
      select array_agg(x order by ord)
      from unnest(v_live) with ordinality as t(x, ord)
      where not (x = any (v_order))
    ), array[]::uuid[]);
  else
    v_order := v_live || coalesce((
      select array_agg(x order by ord)
      from unnest(v_ids) with ordinality as t(x, ord)
      where not (x = any (v_live))
    ), array[]::uuid[]);
  end if;

  perform public.publish_profile_product_pages(p_public_profile_id, v_profile.workspace_id, v_order, false);

  if v_has_draft and v_arrangement is distinct from v_draft.products then
    update public.public_profile_drafts
    set products = v_arrangement,
        revision = revision + 1,
        updated_by = auth.uid()
    where public_profile_id = p_public_profile_id
    returning * into v_draft;
  end if;

  -- The record says what is live: the profile's own published fields, which
  -- this did not change, and the product list, which it did. Built from the
  -- live row rather than the last snapshot, because the live row is exactly
  -- what the last publication left, including fields older snapshots lack.
  v_snapshot := jsonb_build_object(
    'handle', v_profile.handle::text,
    'display_name', v_profile.display_name,
    'short_bio', v_profile.short_bio,
    'about', v_profile.about,
    'links', public.profile_links_snapshot(p_public_profile_id),
    'city', v_profile.city,
    'country_code', v_profile.country_code,
    'location', v_profile.location,
    'contact_url', v_profile.contact_url,
    'avatar_path', v_profile.avatar_path,
    'product_ids', to_jsonb(v_order)
  );

  insert into public.public_profile_publications (
    public_profile_id, workspace_id, handle, draft_updated_at, snapshot, published_by
  )
  values (
    p_public_profile_id, v_profile.workspace_id, v_profile.handle,
    coalesce(v_draft.updated_at, now()), v_snapshot, auth.uid()
  )
  returning id into v_publication_id;

  return jsonb_build_object(
    'outcome', 'published',
    'published_count', v_newly,
    'publication_id', v_publication_id,
    'handle', v_profile.handle::text
  );
end;
$$;

comment on function public.publish_all_profile_products is
  'Publishes the named eligible products on a live public profile in one transaction, keeps the builder draft in step, and records a publication. Public Fanwise visibility only; never touches listings or channels. Refuses a draft profile (PT412).';

revoke all on function public.publish_all_profile_products(uuid, uuid[]) from public, anon;
grant execute on function public.publish_all_profile_products(uuid, uuid[]) to authenticated;
