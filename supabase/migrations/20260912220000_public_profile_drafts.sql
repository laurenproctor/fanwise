-- The public-profile builder's draft, and the three small changes it needs.
--
-- Until now the settings form wrote straight to `public_profiles`, so editing
-- the bio of a published profile changed the public page as the creator typed
-- Save. The builder autosaves, and an autosave that touched the live row would
-- publish every keystroke. So the builder writes here instead, and nothing in
-- this file makes a draft visible to anybody but its own workspace.
--
-- Four things here are load-bearing.
--
--   1. A draft is private, full stop. `anon` has no grant on the table at all
--      (not a policy that filters to nothing: no grant), so there is no row
--      filter to get wrong later. Members read and write their own workspace's
--      draft through RLS, exactly as they do the profile.
--
--   2. A draft is a faithful copy of what was typed, not a validated record.
--      A half-typed website address has to survive a refresh, and a CHECK that
--      refused it would turn "restore my draft" into "restore the last value
--      that happened to be valid". Validation is the builder's Continue and,
--      later, Publish; both run the same Zod schema, and the live row keeps
--      every one of its constraints. What the table does bound is size, so a
--      draft cannot be used as free storage.
--
--   3. The tenant boundary is a composite foreign key, the rule
--      public_product_pages set: `(public_profile_id, workspace_id)` references
--      the profile, so a member cannot attach a draft to another workspace's
--      profile even with a workspace_id RLS would accept.
--
--   4. `revision` is optimistic concurrency, not history. Two tabs editing one
--      draft would otherwise overwrite each other in whichever order their
--      debounces fired; the save action updates `where revision = <what I read>`
--      and a miss is reported as a conflict rather than silently lost.
--
-- The other changes:
--
--   - `public_profiles.behance_url`, nullable and https-only with the same
--     shape of constraint as `instagram_url`, so the builder's Behance link has
--     somewhere to be published to.
--   - The avatar bucket's limit rises from 2 MiB to 5 MiB, the limit the
--     builder states. The server action checks the same number.
--   - `channels` joins the reserved handles. `/<workspace>/channels` is a
--     route, and the reserved list is meant to cover the route tree whether or
--     not handles ever move out of the `@` namespace.
--
-- Rollback. Drop public_profile_drafts (its avatar objects share the profile
-- bucket and are removed by deleting objects whose path is not any profile's
-- avatar_path). Drop public_profiles.behance_url, which loses every Behance
-- link. Restore the bucket limit to 2097152 after checking no object exceeds
-- it. Restore public_profiles_handle_not_reserved without 'channels'.

-- ---------------------------------------------------------------------------
-- Guard: the reservation below must not strand an existing profile.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.public_profiles where handle = 'channels') then
    raise exception 'a public profile already holds the handle "channels"; rename it before reserving the word';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- public_profiles: Behance, and one more reserved handle
-- ---------------------------------------------------------------------------

alter table public.public_profiles
  add column behance_url text;

alter table public.public_profiles
  add constraint public_profiles_behance_url_https
    check (behance_url is null or behance_url ~ '^https://([a-z0-9-]+\.)*behance\.net/[^\s<>"]*$');

-- Kept in step with RESERVED_HANDLES in lib/public/handles.ts, which a unit
-- test checks against the latest definition of this constraint.
alter table public.public_profiles
  drop constraint public_profiles_handle_not_reserved;

alter table public.public_profiles
  add constraint public_profiles_handle_not_reserved
    check (
      handle <> all (
        array[
          'about', 'account', 'admin', 'api', 'app', 'assets', 'auth',
          'billing', 'channels', 'collections', 'contact', 'creator', 'creators',
          'dashboard', 'discover', 'docs', 'fanwise', 'favicon', 'forgot-password',
          'help', 'how-it-works', 'legal', 'login', 'logout', 'marketplaces',
          'new', 'onboarding', 'pricing', 'privacy', 'products', 'profile',
          'public', 'reset-password', 'robots', 'root', 'search', 'security',
          'settings', 'sign-in', 'sign-up', 'sitemap', 'start', 'static',
          'status', 'support', 'terms', 'www'
        ]::extensions.citext[]
      )
    );

-- ---------------------------------------------------------------------------
-- public_profile_drafts
-- ---------------------------------------------------------------------------

create table public.public_profile_drafts (
  public_profile_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- As typed. Bounded, never shape-checked: see the header.
  handle text not null default '',
  display_name text not null default '',
  short_bio text not null default '',
  website text not null default '',
  instagram text not null default '',
  behance text not null default '',

  avatar_path text,

  -- The product selection, visibility and order the builder's second step
  -- edits: an array of { productId, visible } in display order. Product ids
  -- cannot be foreign keys inside jsonb, so publication re-reads each one
  -- through RLS before it writes anything public.
  products jsonb not null default '[]'::jsonb,

  revision integer not null default 0,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint public_profile_drafts_handle_length check (length(handle) <= 64),
  constraint public_profile_drafts_display_name_length check (length(display_name) <= 200),
  constraint public_profile_drafts_short_bio_length check (length(short_bio) <= 160),
  constraint public_profile_drafts_website_length check (length(website) <= 2048),
  constraint public_profile_drafts_instagram_length check (length(instagram) <= 2048),
  constraint public_profile_drafts_behance_length check (length(behance) <= 2048),
  constraint public_profile_drafts_products_array
    check (jsonb_typeof(products) = 'array' and jsonb_array_length(products) <= 500),
  constraint public_profile_drafts_revision_nonnegative check (revision >= 0),

  -- The same scoping as public_profiles_avatar_path_scoped, keyed on the
  -- profile id, so storage_object_profile_workspace_id() governs draft avatars
  -- with no new storage policy.
  constraint public_profile_drafts_avatar_path_scoped
    check (avatar_path is null or avatar_path like (public_profile_id::text || '/%')),

  constraint public_profile_drafts_profile_fk
    foreign key (public_profile_id, workspace_id)
    references public.public_profiles (id, workspace_id)
    on delete cascade
);

comment on table public.public_profile_drafts is
  'The public-profile builder''s unpublished working copy, one per profile. Private to the workspace: anon holds no grant. Autosave writes here and never to public_profiles.';

comment on column public.public_profile_drafts.revision is
  'Optimistic concurrency. A save names the revision it read; a mismatch is a conflict, not an overwrite.';

create index public_profile_drafts_workspace_idx
  on public.public_profile_drafts (workspace_id);

create trigger set_updated_at
  before update on public.public_profile_drafts
  for each row execute function public.set_updated_at();

alter table public.public_profile_drafts enable row level security;

revoke all on public.public_profile_drafts from anon, authenticated;
grant select, insert, update, delete on public.public_profile_drafts to authenticated;

create policy "profile drafts are readable by workspace members"
  on public.public_profile_drafts for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "profile drafts are insertable by workspace members"
  on public.public_profile_drafts for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "profile drafts are updatable by workspace members"
  on public.public_profile_drafts for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "profile drafts are deletable by workspace members"
  on public.public_profile_drafts for delete to authenticated
  using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Avatar bucket: 5 MiB
-- ---------------------------------------------------------------------------

update storage.buckets
set file_size_limit = 5242880 -- 5 MiB, the limit the builder states
where id = 'public-profile-avatars';
