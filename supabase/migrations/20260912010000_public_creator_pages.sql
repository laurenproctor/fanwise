-- Public creator pages: the profile at /@handle and the product page beneath it.
--
-- Four tables and one event log. The shape follows the tenancy doctrine A1 and
-- A2 set, and departs from it in exactly one place, which is the point of this
-- migration: these are the first tables in Fanwise that `anon` may read.
--
-- Five things here are load-bearing.
--
--   1. Nothing is public by default. Both `public_profiles` and
--      `public_product_pages` are born `draft`, and the anon policies name
--      `published` explicitly. A product page is additionally gated on its
--      parent profile being published, so unpublishing a profile takes every
--      product beneath it out of public view in one write.
--
--   2. The gate a child uses to ask whether its profile is published names
--      `status = 'published'` itself, inside the subquery, rather than relying
--      on the parent's own RLS to have filtered the row away. Both are true
--      today and the redundancy is the point: widen the profile SELECT policy
--      later and the children stay private, narrow it and the children
--      disappear. It fails closed in both directions, which a subquery that
--      leaned on RLS alone would not. It is deliberately not a security
--      definer helper, because that would mean granting `anon` EXECUTE on a
--      function in `public`, and the catalog test in
--      tests/db/function-privileges.test.ts holds the line that anon executes
--      nothing at all. That line is worth more than the tidier expression.
--
--   3. Handles live in one namespace with their own history. A handle that has
--      been released still routes to the profile that gave it up, so a link
--      printed in someone's portfolio does not rot. That means uniqueness has
--      to span `public_profiles` and `public_handle_history` together, which no
--      single unique index can express; a trigger does it, on both tables.
--
--   4. The tenant boundary is a foreign key, not only a policy. Every child
--      carries `workspace_id` and references its parent as a
--      `(id, workspace_id)` pair, so a member cannot attach their own
--      workspace's row to another workspace's parent — the mistake
--      `product_assets` was built to prevent in A2.
--
--   5. One profile per workspace is a *policy*, not a model. It is a named
--      unique index that can be dropped in one line when a workspace should own
--      several public identities; nothing else in the schema assumes it.
--
-- Rollback. Mostly additive, but not entirely, and the exceptions are the part
-- worth writing down, because they touch objects that existed before this file.
--
--   1. Drop the new tables, children first: public_outbound_clicks,
--      public_product_slug_history, public_product_pages,
--      public_handle_history, public_profiles. Then release_public_handle,
--      release_public_product_slug, storage_object_profile_workspace_id, the
--      four check_* trigger functions, and the type public_page_status.
--      Nothing outside this migration references any of them.
--
--   2. Revoke the column grants this file adds to `anon` on the four
--      pre-existing tables (products, product_assets, channel_listings,
--      channels) and drop the five policies it adds to them. This is the only
--      change here to objects older than this migration. Leaving them behind
--      is not itself an exposure — with public_product_pages dropped the
--      EXISTS subqueries are false and nothing is readable — but a grant whose
--      gate no longer exists is exactly the kind of thing that becomes an
--      exposure the next time somebody adds a table with that name.
--
--   3. Restore workspaces_slug_not_reserved without 'profile'. Check first
--      that no workspace has since been slugged `profile`; removing it is safe
--      only while `app/profile` is gone too.
--
--   4. Drop the four storage policies on the public-profile-avatars bucket and
--      then the bucket, after deleting its objects. Dropping a bucket that
--      still holds objects fails, which is the right default.
--
-- Data loss on rollback: every public profile, public page, redirect-history
-- row and click row. There is no second copy of any of them.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- Deliberately two values. A public page is either something a visitor can see
-- or something only its workspace can see, and a third state would be a promise
-- the routing layer cannot keep.
create type public.public_page_status as enum ('draft', 'published');

-- ---------------------------------------------------------------------------
-- public_profiles
-- ---------------------------------------------------------------------------

create table public.public_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  handle extensions.citext not null unique,
  display_name text not null,
  short_bio text,
  location text,
  avatar_path text,
  website_url text,
  instagram_url text,
  contact_url text,
  status public.public_page_status not null default 'draft',
  seo_title text,
  seo_description text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The handle character set is deliberately narrow: lowercase ASCII letters,
  -- digits, and single internal hyphens. It is narrow for a reason that is not
  -- tidiness. A handle is an identity claim rendered in someone else's
  -- typeface, and the moment the set admits Unicode it admits homoglyphs:
  -- Cyrillic а, Greek ο, a zero-width joiner between two letters. Every one of
  -- those produces a handle that is visually indistinguishable from an existing
  -- one and distinct to the database. ASCII cannot express that attack.
  --
  -- Uppercase is excluded rather than folded, so the stored value is already
  -- the canonical URL form and no caller has to remember to lowercase it
  -- before putting it in a link or a canonical tag. citext then makes the
  -- *comparison* case-insensitive, which is what stops `/@Northline` claiming
  -- a second row.
  --
  -- Note the cast. `~` on a citext operand is the case-INSENSITIVE match, so
  -- `handle ~ '^[a-z0-9...]'` accepts `NorthLine` — the pattern looks like it
  -- forbids uppercase and does not. Casting to text first restores the
  -- case-sensitive operator and makes the constraint mean what it reads as.
  -- Found by a test that asserted the refusal and got a successful update.
  constraint public_profiles_handle_format
    check (handle::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint public_profiles_handle_length
    check (length(handle::text) between 3 and 32),

  -- Kept in step with RESERVED_HANDLES in lib/public/handles.ts, which a unit
  -- test checks against the route tree. Same rule as workspaces_slug_not_reserved
  -- (20260905173722): a handle a route would shadow is not a broken link, it is
  -- a row that inserts happily and a page nobody can ever open.
  constraint public_profiles_handle_not_reserved
    check (
      handle <> all (
        array[
          'about', 'account', 'admin', 'api', 'app', 'assets', 'auth',
          'billing', 'collections', 'contact', 'creator', 'creators',
          'dashboard', 'discover', 'docs', 'fanwise', 'favicon', 'forgot-password',
          'help', 'how-it-works', 'legal', 'login', 'logout', 'marketplaces',
          'new', 'onboarding', 'pricing', 'privacy', 'products', 'profile',
          'public', 'reset-password', 'robots', 'root', 'search', 'security',
          'settings', 'sign-in', 'sign-up', 'sitemap', 'start', 'static',
          'status', 'support', 'terms', 'www'
        ]::extensions.citext[]
      )
    ),

  constraint public_profiles_display_name_not_blank
    check (length(btrim(display_name)) between 1 and 80),
  constraint public_profiles_short_bio_length
    check (short_bio is null or length(short_bio) <= 280),
  constraint public_profiles_location_length
    check (location is null or length(btrim(location)) between 1 and 80),
  constraint public_profiles_seo_title_length
    check (seo_title is null or length(btrim(seo_title)) between 1 and 70),
  constraint public_profiles_seo_description_length
    check (seo_description is null or length(btrim(seo_description)) between 1 and 200),

  -- Only ever https, and never a javascript: or data: URL wearing a link's
  -- clothes. The application validates these too; this is the half that holds
  -- when something other than the application writes the row.
  constraint public_profiles_website_url_https
    check (website_url is null or website_url ~ '^https://[^\s<>"]+$'),
  constraint public_profiles_instagram_url_https
    check (instagram_url is null or instagram_url ~ '^https://([a-z0-9-]+\.)*instagram\.com/[^\s<>"]*$'),
  -- A contact action is either a page or an address, so mailto: joins https
  -- here and nowhere else.
  constraint public_profiles_contact_url_scheme
    check (contact_url is null or contact_url ~ '^(https://[^\s<>"]+|mailto:[^\s<>"@]+@[^\s<>"@]+)$'),

  -- Same shape and the same reasoning as workspaces_icon_path_scoped: the path
  -- is built by the server action from ids it has already checked, and the
  -- constraint is a second pair of eyes on that rather than the first.
  constraint public_profiles_avatar_path_scoped
    check (avatar_path is null or avatar_path like (id::text || '/%')),

  -- published_at is the moment the page became visible, and it is meaningless
  -- on a draft. Keeping them consistent here means the public queries can order
  -- by it without a coalesce.
  constraint public_profiles_published_at_matches_status
    check ((status = 'published') = (published_at is not null)),

  -- The target of the composite foreign keys below.
  constraint public_profiles_id_workspace_unique unique (id, workspace_id)
);

comment on table public.public_profiles is
  'A public creator identity, served at /@handle. Separate from the workspace: a workspace is an operational container, a profile is a public identity, and the architecture allows a workspace to own several.';

comment on column public.public_profiles.handle is
  'Globally unique, lowercase, ASCII. Shares a namespace with public_handle_history, enforced by trigger rather than by index.';

comment on column public.public_profiles.avatar_path is
  'Storage path in the public-profile-avatars bucket, scoped to the profile id by constraint. Null falls back to initials.';

-- One profile per workspace, for now. This is the whole of that limit: drop
-- this index and the schema supports several, because nothing else assumes it.
create unique index public_profiles_one_per_workspace_idx
  on public.public_profiles (workspace_id);

comment on index public.public_profiles_one_per_workspace_idx is
  'V1 limit, not a model constraint. Drop this single index to let a workspace own more than one public profile.';

-- The public read path: resolve a handle, then list what is published under it.
create index public_profiles_published_idx
  on public.public_profiles (handle)
  where status = 'published';

create trigger set_updated_at
  before update on public.public_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- public_handle_history
--
-- A handle a profile used to answer to. Rows are written by the trigger below,
-- never by the application, so history cannot be forged into a claim on a
-- handle someone else holds.
-- ---------------------------------------------------------------------------

create table public.public_handle_history (
  id uuid primary key default extensions.gen_random_uuid(),
  public_profile_id uuid not null,
  workspace_id uuid not null,
  handle extensions.citext not null unique,
  created_at timestamptz not null default now(),

  constraint public_handle_history_profile_fk
    foreign key (public_profile_id, workspace_id)
    references public.public_profiles (id, workspace_id)
    on delete cascade
);

comment on table public.public_handle_history is
  'Handles a profile has released. /@old-handle permanently redirects to its current handle, so a printed link does not rot. Written only by release_public_handle().';

create index public_handle_history_profile_idx
  on public.public_handle_history (public_profile_id);

-- ---------------------------------------------------------------------------
-- public_product_pages
-- ---------------------------------------------------------------------------

create table public.public_product_pages (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  public_profile_id uuid not null,
  product_id uuid not null,
  slug extensions.citext not null,
  status public.public_page_status not null default 'draft',
  featured boolean not null default false,
  display_order integer not null default 0,
  title_override text,
  summary_override text,
  description_override text,
  cover_asset_id uuid,
  seo_title text,
  seo_description text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Cast to text for the same reason as the handle above: `~` on citext is
  -- the case-insensitive operator, and an uncast pattern would admit
  -- `Aster-Grotesk` into a column whose whole job is to be a canonical URL.
  constraint public_product_pages_slug_format
    check (slug::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint public_product_pages_slug_length
    check (length(slug::text) between 3 and 64),

  -- `collections` is reserved at this level because /@handle/collections/<x>
  -- is the reserved shape for a future collection page. A product slugged
  -- `collections` would be shadowed by it. Kept in step with
  -- RESERVED_PUBLIC_PRODUCT_SLUGS in lib/public/handles.ts.
  constraint public_product_pages_slug_not_reserved
    check (slug <> all (array['collections']::extensions.citext[])),

  constraint public_product_pages_title_override_length
    check (title_override is null or length(btrim(title_override)) between 1 and 200),
  constraint public_product_pages_summary_override_length
    check (summary_override is null or length(btrim(summary_override)) between 1 and 300),
  constraint public_product_pages_description_override_length
    check (description_override is null or length(btrim(description_override)) <= 4000),
  constraint public_product_pages_seo_title_length
    check (seo_title is null or length(btrim(seo_title)) between 1 and 70),
  constraint public_product_pages_seo_description_length
    check (seo_description is null or length(btrim(seo_description)) between 1 and 200),

  constraint public_product_pages_published_at_matches_status
    check ((status = 'published') = (published_at is not null)),

  constraint public_product_pages_slug_unique_per_profile unique (public_profile_id, slug),
  -- A product has at most one public page under a given profile. Without this
  -- the same product could be published twice at two slugs and compete with
  -- itself for the same search result.
  constraint public_product_pages_product_unique_per_profile unique (public_profile_id, product_id),

  constraint public_product_pages_id_workspace_unique unique (id, workspace_id),

  -- The tenant boundary as a foreign key. Referencing products(id) alone would
  -- let a member point their own workspace's public page at another workspace's
  -- product: the RLS policy checks workspace_id and would pass. This was the
  -- A2 lesson and it applies unchanged.
  constraint public_product_pages_profile_fk
    foreign key (public_profile_id, workspace_id)
    references public.public_profiles (id, workspace_id)
    on delete cascade,
  constraint public_product_pages_product_fk
    foreign key (product_id, workspace_id)
    references public.products (id, workspace_id)
    on delete cascade,
  -- The chosen cover must be an asset of this same workspace. Nulled rather
  -- than cascaded: losing the cover should not delete the public page.
  constraint public_product_pages_cover_asset_fk
    foreign key (cover_asset_id, workspace_id)
    references public.product_assets (id, workspace_id)
    on delete set null
);

comment on table public.public_product_pages is
  'The public showcase for a canonical product, served at /@handle/<slug>. Inherits from products; the override columns are the deliberate exceptions, not a copy of the record.';

comment on column public.public_product_pages.cover_asset_id is
  'Which of the product''s own images leads the public page. Null takes the product''s first gallery image.';

create index public_product_pages_profile_idx
  on public.public_product_pages (public_profile_id);

create index public_product_pages_product_idx
  on public.public_product_pages (product_id);

create index public_product_pages_workspace_idx
  on public.public_product_pages (workspace_id);

-- The catalog read: everything published under one profile, in display order.
create index public_product_pages_published_idx
  on public.public_product_pages (public_profile_id, featured desc, display_order, published_at desc)
  where status = 'published';

create trigger set_updated_at
  before update on public.public_product_pages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- public_product_slug_history
-- ---------------------------------------------------------------------------

create table public.public_product_slug_history (
  id uuid primary key default extensions.gen_random_uuid(),
  public_product_page_id uuid not null,
  public_profile_id uuid not null,
  workspace_id uuid not null,
  slug extensions.citext not null,
  created_at timestamptz not null default now(),

  constraint public_product_slug_history_page_fk
    foreign key (public_product_page_id, workspace_id)
    references public.public_product_pages (id, workspace_id)
    on delete cascade,

  -- Scoped to the profile, exactly like the live slug, so two creators may both
  -- have retired `aster-grotesk` and neither learns the other exists.
  constraint public_product_slug_history_unique unique (public_profile_id, slug)
);

comment on table public.public_product_slug_history is
  'Slugs a public product page has released. /@handle/<old> permanently redirects to the current slug. Written only by release_public_product_slug().';

create index public_product_slug_history_page_idx
  on public.public_product_slug_history (public_product_page_id);

-- ---------------------------------------------------------------------------
-- Handle and slug namespaces
--
-- A live handle and a retired one occupy the same namespace: /@old-handle has
-- to keep resolving, so nobody else may claim it. That is a uniqueness rule
-- across two tables, which no unique index can express. Both directions are
-- checked, because guarding only the live table would let a history row be
-- written over a handle someone already holds.
-- ---------------------------------------------------------------------------

create or replace function public.check_handle_available()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.public_handle_history h
    where h.handle = new.handle
      and h.public_profile_id <> new.id
  ) then
    raise exception 'handle % is retained by another profile', new.handle
      using errcode = '23505';
  end if;
  return new;
end;
$$;

comment on function public.check_handle_available is
  'Refuses a live handle that another profile still redirects from. The other half of the handle namespace, which the unique index on public_profiles cannot see.';

create trigger check_handle_available
  before insert or update of handle on public.public_profiles
  for each row execute function public.check_handle_available();

create or replace function public.check_history_handle_available()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.public_profiles p
    where p.handle = new.handle
      and p.id <> new.public_profile_id
  ) then
    raise exception 'handle % is held by another profile', new.handle
      using errcode = '23505';
  end if;
  return new;
end;
$$;

comment on function public.check_history_handle_available is
  'The mirror of check_handle_available: a released handle cannot be recorded over one another profile currently holds.';

create trigger check_history_handle_available
  before insert or update of handle on public.public_handle_history
  for each row execute function public.check_history_handle_available();

-- The same rule one level down: a product's retired slug and its live slug
-- share a namespace within the profile.
create or replace function public.check_product_slug_available()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.public_product_slug_history h
    where h.public_profile_id = new.public_profile_id
      and h.slug = new.slug
      and h.public_product_page_id <> new.id
  ) then
    raise exception 'slug % is retained by another page on this profile', new.slug
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger check_product_slug_available
  before insert or update of slug on public.public_product_pages
  for each row execute function public.check_product_slug_available();

create or replace function public.check_history_product_slug_available()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.public_product_pages p
    where p.public_profile_id = new.public_profile_id
      and p.slug = new.slug
      and p.id <> new.public_product_page_id
  ) then
    raise exception 'slug % is held by another page on this profile', new.slug
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger check_history_product_slug_available
  before insert or update of slug on public.public_product_slug_history
  for each row execute function public.check_history_product_slug_available();

-- ---------------------------------------------------------------------------
-- Releasing an identifier
--
-- Both of these are security definer and write the history row themselves, so
-- the application never inserts history directly. A creator renaming their
-- handle for the third time should not be able to fabricate a fourth row
-- claiming a handle they never held.
--
-- Re-taking an identifier you previously released deletes its history row: the
-- redirect would otherwise point a handle at itself.
-- ---------------------------------------------------------------------------

create or replace function public.release_public_handle(
  p_public_profile_id uuid,
  p_new_handle text
)
returns public.public_profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.public_profiles;
  v_old extensions.citext;
begin
  select * into v_profile
  from public.public_profiles
  where id = p_public_profile_id;

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(v_profile.workspace_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_old := v_profile.handle;

  if v_old = lower(btrim(p_new_handle))::extensions.citext then
    return v_profile;
  end if;

  -- Taking back a handle this profile used to hold: drop the stale redirect
  -- before the unique index on the live table sees it.
  delete from public.public_handle_history
  where public_profile_id = p_public_profile_id
    and handle = lower(btrim(p_new_handle))::extensions.citext;

  update public.public_profiles
  set handle = lower(btrim(p_new_handle))::extensions.citext
  where id = p_public_profile_id
  returning * into v_profile;

  insert into public.public_handle_history (public_profile_id, workspace_id, handle)
  values (p_public_profile_id, v_profile.workspace_id, v_old)
  on conflict (handle) do nothing;

  return v_profile;
end;
$$;

comment on function public.release_public_handle is
  'Changes a profile handle and records the old one as a permanent redirect, in one transaction. The only sanctioned way to write public_handle_history.';

revoke all on function public.release_public_handle(uuid, text) from public, anon;
grant execute on function public.release_public_handle(uuid, text) to authenticated;

create or replace function public.release_public_product_slug(
  p_public_product_page_id uuid,
  p_new_slug text
)
returns public.public_product_pages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_page public.public_product_pages;
  v_old extensions.citext;
begin
  select * into v_page
  from public.public_product_pages
  where id = p_public_product_page_id;

  if not found then
    raise exception 'public product page not found' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(v_page.workspace_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_old := v_page.slug;

  if v_old = lower(btrim(p_new_slug))::extensions.citext then
    return v_page;
  end if;

  delete from public.public_product_slug_history
  where public_profile_id = v_page.public_profile_id
    and slug = lower(btrim(p_new_slug))::extensions.citext;

  update public.public_product_pages
  set slug = lower(btrim(p_new_slug))::extensions.citext
  where id = p_public_product_page_id
  returning * into v_page;

  insert into public.public_product_slug_history
    (public_product_page_id, public_profile_id, workspace_id, slug)
  values (p_public_product_page_id, v_page.public_profile_id, v_page.workspace_id, v_old)
  on conflict (public_profile_id, slug) do nothing;

  return v_page;
end;
$$;

comment on function public.release_public_product_slug is
  'Changes a public product slug and records the old one as a permanent redirect, in one transaction.';

revoke all on function public.release_public_product_slug(uuid, text) from public, anon;
grant execute on function public.release_public_product_slug(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Outbound clicks
--
-- Deliberately thin. A row says that someone left a public product page for a
-- named channel, and nothing about who they were: no IP, no user agent, no
-- visitor identifier, no session. The referrer is reduced to a host before it
-- is stored, because a full referrer URL is a path someone was reading.
--
-- No grant to anon at all. The browser posts to a route handler which writes
-- with the service role after checking the page is genuinely published, so a
-- table that accepts anonymous writes never exists.
-- ---------------------------------------------------------------------------

create table public.public_outbound_clicks (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  public_profile_id uuid not null,
  public_product_page_id uuid not null,
  channel_id uuid not null references public.channels (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  referrer_host text,
  campaign text,

  constraint public_outbound_clicks_referrer_host_length
    check (referrer_host is null or length(referrer_host) between 1 and 253),
  constraint public_outbound_clicks_campaign_length
    check (campaign is null or length(campaign) between 1 and 64),

  constraint public_outbound_clicks_profile_fk
    foreign key (public_profile_id, workspace_id)
    references public.public_profiles (id, workspace_id)
    on delete cascade,
  constraint public_outbound_clicks_page_fk
    foreign key (public_product_page_id, workspace_id)
    references public.public_product_pages (id, workspace_id)
    on delete cascade
);

comment on table public.public_outbound_clicks is
  'One row per visitor leaving a public product page for a channel. Carries no visitor identity by design: no IP, no user agent, no session. Written only by the service role.';

create index public_outbound_clicks_page_idx
  on public.public_outbound_clicks (public_product_page_id, occurred_at desc);

create index public_outbound_clicks_workspace_idx
  on public.public_outbound_clicks (workspace_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Deliberately NOT forced, for the reason recorded in the A1 migration.
--
-- The grants are the first thing to read here. `anon` gets SELECT on four
-- tables and nothing else, anywhere: no insert, no update, no delete, and no
-- grant at all on public_outbound_clicks.
-- ---------------------------------------------------------------------------

alter table public.public_profiles enable row level security;
alter table public.public_handle_history enable row level security;
alter table public.public_product_pages enable row level security;
alter table public.public_product_slug_history enable row level security;
alter table public.public_outbound_clicks enable row level security;

revoke all on public.public_profiles from anon, authenticated;
revoke all on public.public_handle_history from anon, authenticated;
revoke all on public.public_product_pages from anon, authenticated;
revoke all on public.public_product_slug_history from anon, authenticated;
revoke all on public.public_outbound_clicks from anon, authenticated;

grant select on public.public_profiles to anon, authenticated;
grant select on public.public_handle_history to anon, authenticated;
grant select on public.public_product_pages to anon, authenticated;
grant select on public.public_product_slug_history to anon, authenticated;

grant insert, update, delete on public.public_profiles to authenticated;
grant insert, update, delete on public.public_product_pages to authenticated;
grant select on public.public_outbound_clicks to authenticated;

-- public_profiles ------------------------------------------------------------

create policy "published profiles are readable by anyone"
  on public.public_profiles for select to anon, authenticated
  using (status = 'published');

create policy "profiles are readable by workspace members"
  on public.public_profiles for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "profiles are insertable by workspace members"
  on public.public_profiles for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "profiles are updatable by workspace members"
  on public.public_profiles for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "profiles are deletable by workspace members"
  on public.public_profiles for delete to authenticated
  using (public.is_workspace_member(workspace_id));

-- public_handle_history ------------------------------------------------------
--
-- Readable publicly only while the profile it points at is published, so an
-- unpublished profile's former handles are not a way to enumerate it. No write
-- grant to anyone: rows are born in release_public_handle().

create policy "handle history is readable for published profiles"
  on public.public_handle_history for select to anon, authenticated
  using (
    exists (
      select 1
      from public.public_profiles p
      where p.id = public_handle_history.public_profile_id
        and p.status = 'published'
    )
  );

create policy "handle history is readable by workspace members"
  on public.public_handle_history for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- public_product_pages -------------------------------------------------------

create policy "published pages under published profiles are readable by anyone"
  on public.public_product_pages for select to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.public_profiles p
      where p.id = public_product_pages.public_profile_id
        and p.status = 'published'
    )
  );

create policy "public pages are readable by workspace members"
  on public.public_product_pages for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "public pages are insertable by workspace members"
  on public.public_product_pages for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "public pages are updatable by workspace members"
  on public.public_product_pages for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "public pages are deletable by workspace members"
  on public.public_product_pages for delete to authenticated
  using (public.is_workspace_member(workspace_id));

-- public_product_slug_history ------------------------------------------------

create policy "slug history is readable for published profiles"
  on public.public_product_slug_history for select to anon, authenticated
  using (
    exists (
      select 1
      from public.public_profiles p
      where p.id = public_product_slug_history.public_profile_id
        and p.status = 'published'
    )
  );

create policy "slug history is readable by workspace members"
  on public.public_product_slug_history for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- public_outbound_clicks -----------------------------------------------------
--
-- Members may read their own. Nobody may write through PostgREST at all; the
-- route handler writes with the service role.

create policy "outbound clicks are readable by workspace members"
  on public.public_outbound_clicks for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Avatar storage
--
-- Private, like every other bucket. A public page's avatar is served through a
-- route handler that mints a short signed URL, which is what makes unpublishing
-- take the image out of public reach along with the page. A public bucket would
-- leave the object fetchable by anyone who had ever seen the URL.
--
-- Path convention: <public_profile_id>/<avatar_id><ext>. The profile id leads,
-- matching workspace-icons and product-assets.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'public-profile-avatars',
  'public-profile-avatars',
  false,
  2097152, -- 2 MiB, the limit the settings page states
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reads the owning profile out of the first path segment, the sibling of
-- storage_object_workspace_id().
create or replace function public.storage_object_profile_workspace_id(p_name text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.workspace_id
  from public.public_profiles p
  where p.id = public.uuid_or_null((storage.foldername(p_name))[1]);
$$;

comment on function public.storage_object_profile_workspace_id is
  'Extracts the owning workspace from a public-profile-avatars object path, via the profile id in its first segment.';

grant execute on function public.storage_object_profile_workspace_id(text) to authenticated;

-- These govern direct client access. The server action writes with the service
-- role and is itself the authorization boundary (docs/security.md).

create policy "profile avatars are readable by workspace members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'public-profile-avatars'
    and public.is_workspace_member(public.storage_object_profile_workspace_id(name))
  );

create policy "profile avatars are writable by workspace members"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'public-profile-avatars'
    and public.is_workspace_member(public.storage_object_profile_workspace_id(name))
  );

create policy "profile avatars are updatable by workspace members"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'public-profile-avatars'
    and public.is_workspace_member(public.storage_object_profile_workspace_id(name))
  )
  with check (
    bucket_id = 'public-profile-avatars'
    and public.is_workspace_member(public.storage_object_profile_workspace_id(name))
  );

create policy "profile avatars are deletable by workspace members"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'public-profile-avatars'
    and public.is_workspace_member(public.storage_object_profile_workspace_id(name))
  );

-- ---------------------------------------------------------------------------
-- Execute privileges, stated
--
-- Migration 20260909170000 turned the default for a new function to nothing and
-- left a test enumerating pg_proc. Every function this migration adds is named
-- here, so the catalog carries an explicit ACL rather than a default, and so
-- the reasoning survives next to the grant.
--
-- Note what is absent: `anon` appears in no grant. The public read path is RLS
-- on four tables and nothing else. A signed-out visitor executes no function in
-- `public`, which is the property tests/db/function-privileges.test.ts holds.
-- ---------------------------------------------------------------------------

-- Trigger-only. Postgres checks EXECUTE at CREATE TRIGGER, not when the trigger
-- fires, so a member's insert still runs these with no grant at all.
revoke all on function public.check_handle_available() from public, anon, authenticated;
revoke all on function public.check_history_handle_available() from public, anon, authenticated;
revoke all on function public.check_product_slug_available() from public, anon, authenticated;
revoke all on function public.check_history_product_slug_available() from public, anon, authenticated;

-- Read by the storage.objects policies, which are `to authenticated` and
-- evaluate as that role.
revoke all on function public.storage_object_profile_workspace_id(text) from public, anon;
grant execute on function public.storage_object_profile_workspace_id(text) to authenticated;

-- RPC. Called by a server action as the signed-in user, and each re-checks
-- membership itself rather than trusting the caller, because security definer
-- means the function's own privileges apply once it is running.
revoke all on function public.release_public_handle(uuid, text) from public, anon;
revoke all on function public.release_public_product_slug(uuid, text) from public, anon;
grant execute on function public.release_public_handle(uuid, text) to authenticated;
grant execute on function public.release_public_product_slug(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- One more reserved workspace slug
--
-- `/profile/<handle>` is the internal route the proxy rewrites `/@<handle>`
-- onto. It is a real path in the route tree, so it shadows a workspace slugged
-- `profile` exactly as `/pricing` shadows one slugged `pricing`. Same rule as
-- 20260905173722 and 20260906193000, same fix, and RESERVED_WORKSPACE_SLUGS in
-- lib/slug.ts is the other half of it.
--
-- Nobody reaches `/profile/<handle>` with a browser: the proxy answers it with
-- a permanent redirect to the canonical `/@<handle>` before routing sees it.
-- The reservation is not about that. It is about the slug that would insert
-- happily and never open.
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

-- ---------------------------------------------------------------------------
-- What a published page may read from the canonical tables
--
-- A public product page renders facts that live on `products`,
-- `product_assets`, `channel_listings` and `channels`. None of those tables
-- has ever been readable by `anon`, and the obvious move — a policy admitting
-- the published ones — is wrong on its own, for the reason docs/data-model.md
-- records about credentials: **RLS filters rows, never columns**. A policy
-- that admits a product row admits every column of it, `status` and
-- `archived_at` and whatever is added next, and the only thing standing
-- between a visitor and those is every present and future query remembering to
-- name its columns.
--
-- So the grant is the column list, and the policy is the row filter. Postgres
-- checks both. `anon` is granted SELECT on named columns only, which makes
-- `select *` a permission error rather than a wide read, and the policies then
-- restrict those columns to rows that are genuinely published. Neither half is
-- sufficient alone and neither is a formality.
--
-- Every policy here is `to anon` and deliberately not `to anon, authenticated`.
-- `authenticated` already holds SELECT on all columns of these tables, so
-- adding that role to a permissive policy would hand a signed-in member every
-- column of another workspace's product the moment it was published — the
-- exact leak the column grants exist to prevent. The public read path never
-- runs as `authenticated`: lib/supabase/public.ts is cookie-less by
-- construction, so it is always `anon`, and these policies are written for the
-- one role that actually executes them.
--
-- The new public_* tables above are the other case, and they keep
-- `to anon, authenticated`: every column on them is public by design, so there
-- is no column there that `authenticated` should not already see.
-- ---------------------------------------------------------------------------

-- products -------------------------------------------------------------------

grant select (
  id,
  name,
  product_type,
  canonical_title,
  canonical_description,
  short_description,
  brand_name,
  base_price,
  currency,
  version,
  license_summary,
  metadata,
  updated_at
) on public.products to anon;

create policy "products behind a published public page are readable by anyone"
  on public.products for select to anon
  using (
    exists (
      select 1
      from public.public_product_pages pp
      join public.public_profiles pr on pr.id = pp.public_profile_id
      where pp.product_id = products.id
        and pp.status = 'published'
        and pr.status = 'published'
    )
  );

-- product_assets -------------------------------------------------------------
--
-- Enough to lay out a gallery and nothing more. `filename` and `storage_path`
-- are both withheld: a filename is the creator's own working title for a file
-- and frequently says more than the listing does, and a storage path is the
-- object's address. The bytes are served by a route handler that mints a short
-- signed URL, so the browser never needs either.

grant select (
  id,
  product_id,
  asset_type,
  asset_state,
  sort_order,
  mime_type
) on public.product_assets to anon;

create policy "images behind a published public page are readable by anyone"
  on public.product_assets for select to anon
  using (
    asset_state = 'ready'
    and exists (
      select 1
      from public.public_product_pages pp
      join public.public_profiles pr on pr.id = pp.public_profile_id
      where pp.product_id = product_assets.product_id
        and pp.status = 'published'
        and pr.status = 'published'
    )
  );

-- channel_listings -----------------------------------------------------------
--
-- The destination list: where a visitor can buy this, and for how much.
-- `channel_connection_id`, `status_source`, `metadata` and every timestamp are
-- withheld. A connection id is an internal object and the one field on this
-- table that points at a credential.
--
-- Only a listing that is published and actually has somewhere to send a
-- visitor. A published listing with no external_url is a row that would render
-- as a button leading nowhere.

grant select (
  id,
  product_id,
  channel_id,
  external_url,
  price,
  currency,
  status
) on public.channel_listings to anon;

create policy "live listings behind a published public page are readable by anyone"
  on public.channel_listings for select to anon
  using (
    status = 'published'
    and external_url is not null
    and exists (
      select 1
      from public.public_product_pages pp
      join public.public_profiles pr on pr.id = pp.public_profile_id
      where pp.product_id = channel_listings.product_id
        and pp.status = 'published'
        and pr.status = 'published'
    )
  );

-- channels -------------------------------------------------------------------
--
-- A global catalog with no tenant data, but `billable` is a commercial fact
-- about Fanwise's own pricing and `status` is a roadmap signal, so the grant is
-- the three columns a destination row renders and no policy is needed beyond
-- "the catalog is the catalog".

grant select (id, key, name) on public.channels to anon;

create policy "channel identity is readable by anyone"
  on public.channels for select to anon
  using (true);
