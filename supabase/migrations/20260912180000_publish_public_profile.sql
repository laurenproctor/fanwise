-- Publishing a public profile from the builder's draft.
--
-- The live rows stay the published state. `public_profiles` and
-- `public_product_pages` are what the public route and its RLS already read,
-- and that read path is not touched here. What this migration adds is the one
-- way a draft becomes those rows, and a record of every time it did.
--
-- Five things here are load-bearing.
--
--   1. Atomic. `publish_public_profile()` is one function, so one transaction:
--      the handle claim, the profile columns, every product page, and the
--      publication record either all land or none do. A handle somebody else
--      holds raises from the unique index or the history trigger, the whole
--      call rolls back, and the draft and the live profile are exactly as they
--      were. There is no half-published profile to clean up.
--
--   2. Reviewed means reviewed. The caller names the draft's `updated_at` as
--      it was when the creator looked at the final preview. The draft row is
--      locked and compared; any write since — another tab, an image upload —
--      raises PT409 (HTTP 409 Conflict) rather than publishing something
--      nobody reviewed.
--
--   3. Idempotent. The profile row is locked for the whole call, so two
--      publishes of the same profile serialize. The second one finds the
--      profile already published with a latest snapshot identical to the one
--      it would write, and returns that publication without writing anything.
--      Repeated requests never produce a second record.
--
--   4. Only what the draft shows. Every product id passed must be one the
--      draft arranges as visible, in the draft's order, and belong to the
--      profile's workspace — the last is also the composite foreign key on
--      `public_product_pages`. Every other page under the profile is set back
--      to draft in the same transaction, so a product the creator hid is not
--      left public. The builder is the one authority for which product pages
--      a profile publishes; `featured` is cleared because the builder's order
--      is the order.
--
--   5. Security definer, with its own authorization. Like
--      release_public_handle(), it re-checks is_workspace_member() itself,
--      because definer privileges apply once it runs. Everything it writes is
--      scoped to the locked profile's workspace.
--
-- What it deliberately trusts the caller for: the canonical link URLs and the
-- eligibility of the product list. Canonicalising "studio.com" into an https
-- URL and computing listing liveness are application rules
-- (lib/public/profile-links.ts, lib/publishing/manual-steps.ts); the server
-- action runs them against the locked draft's contents. The table CHECKs still
-- refuse any non-https link, a malformed handle or a reserved one.
--
-- Rollback: drop publish_public_profile, the immutability trigger and its
-- function, then public_profile_publications. Live rows are not rolled back;
-- they remain whatever was last published. Data loss: the publication history.

-- ---------------------------------------------------------------------------
-- public_profile_publications
-- ---------------------------------------------------------------------------

create table public.public_profile_publications (
  id uuid primary key default extensions.gen_random_uuid(),
  public_profile_id uuid not null,
  workspace_id uuid not null,
  handle extensions.citext not null,
  -- The draft's updated_at at the moment it was published: what was reviewed.
  draft_updated_at timestamptz not null,
  -- Exactly what became public: profile columns and the ordered product ids.
  snapshot jsonb not null,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz not null default now(),

  constraint public_profile_publications_snapshot_object
    check (jsonb_typeof(snapshot) = 'object'),

  constraint public_profile_publications_profile_fk
    foreign key (public_profile_id, workspace_id)
    references public.public_profiles (id, workspace_id)
    on delete cascade
);

comment on table public.public_profile_publications is
  'One immutable row per successful publish of a public profile. Written only by publish_public_profile(); never updated.';

create index public_profile_publications_profile_idx
  on public.public_profile_publications (public_profile_id, published_at desc);

create or replace function public.enforce_profile_publication_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a profile publication is immutable' using errcode = '42501';
end;
$$;

create trigger enforce_profile_publication_immutability
  before update on public.public_profile_publications
  for each row execute function public.enforce_profile_publication_immutability();

revoke all on function public.enforce_profile_publication_immutability() from public, anon, authenticated;

alter table public.public_profile_publications enable row level security;

revoke all on public.public_profile_publications from anon, authenticated;
grant select on public.public_profile_publications to authenticated;

create policy "profile publications are readable by workspace members"
  on public.public_profile_publications for select to authenticated
  using (public.is_workspace_member(workspace_id));

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
  v_snapshot jsonb;
  v_ever_published boolean;
  v_now timestamptz := now();
  v_product uuid;
  v_position bigint;
  v_page_id uuid;
  v_base text;
  v_slug text;
  v_attempt integer;
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
    -- request timed out. PT-prefixed codes are PostgREST's way to answer with
    -- an HTTP status, here 409 Conflict, and are not retried.
    raise exception 'the draft changed after it was reviewed' using errcode = 'PT409';
  end if;

  if jsonb_typeof(p_values) is distinct from 'object' then
    raise exception 'malformed publish values' using errcode = '22023';
  end if;

  -- The product list: no repeats, each one visible in the draft, in the
  -- draft's order. A subsequence of the draft's visible entries is exactly
  -- "the draft's selection minus any product no longer eligible".
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

  v_handle := lower(btrim(coalesce(p_values ->> 'handle', '')));

  v_snapshot := jsonb_build_object(
    'handle', v_handle,
    'display_name', p_values ->> 'display_name',
    'short_bio', nullif(p_values ->> 'short_bio', ''),
    'website_url', nullif(p_values ->> 'website_url', ''),
    'instagram_url', nullif(p_values ->> 'instagram_url', ''),
    'behance_url', nullif(p_values ->> 'behance_url', ''),
    'avatar_path', v_draft.avatar_path,
    'product_ids', to_jsonb(v_ids)
  );

  select * into v_latest
  from public.public_profile_publications
  where public_profile_id = p_public_profile_id
  order by published_at desc
  limit 1;

  -- Idempotency: already live, and live is exactly this.
  if v_profile.status = 'published' and v_latest.id is not null and v_latest.snapshot = v_snapshot then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'publication_id', v_latest.id,
      'handle', v_profile.handle::text,
      'previous_handle', v_profile.handle::text,
      'previous_avatar_path', v_profile.avatar_path
    );
  end if;

  v_ever_published := v_profile.status = 'published' or v_latest.id is not null;

  -- The handle. A profile that has been public keeps its old handle as a
  -- permanent redirect; one that never was has no printed links to protect,
  -- and reserving a suggestion nobody saw would only take a name from someone
  -- else. Either way a handle another profile holds raises here (23505) and
  -- the transaction rolls back.
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
      website_url = v_snapshot ->> 'website_url',
      instagram_url = v_snapshot ->> 'instagram_url',
      behance_url = v_snapshot ->> 'behance_url',
      avatar_path = v_draft.avatar_path,
      status = 'published',
      published_at = case when v_profile.status = 'published' then v_profile.published_at else v_now end
  where id = p_public_profile_id;

  -- Product pages: the selection, published in order.
  for v_product, v_position in
    select x, ord from unnest(v_ids) with ordinality as t(x, ord)
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
        and p.workspace_id = v_profile.workspace_id;

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
            v_profile.workspace_id, p_public_profile_id, v_product, v_slug::extensions.citext,
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

  -- Everything the draft does not show goes back to draft, in this same
  -- transaction, so a hidden product is never left public.
  update public.public_product_pages
  set status = 'draft',
      published_at = null,
      featured = false
  where public_profile_id = p_public_profile_id
    and not (product_id = any (v_ids))
    and (status = 'published' or featured);

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
  'Publishes a profile draft onto the live profile and product-page rows in one transaction, and records the publication. Refuses a draft changed since review (PT409). Idempotent while the live snapshot is unchanged.';

revoke all on function public.publish_public_profile(uuid, timestamptz, jsonb, uuid[]) from public, anon;
grant execute on function public.publish_public_profile(uuid, timestamptz, jsonb, uuid[]) to authenticated;
