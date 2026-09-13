-- Contact and location, back on the public profile and editable in the builder.
--
-- The builder shipped in #83 without either. It retired the settings form that
-- had edited them, but the product page kept rendering `contact_url` as a
-- Contact button, so a creator who had set one before the builder held a
-- public button they could neither change nor remove. Location stopped being
-- shown at all. Both are now optional builder fields: set, they appear; left
-- empty, they do not.
--
-- Three changes, in the order they have to happen.
--
--   1. `public_profile_drafts` gains `location` and `contact`, stored as typed,
--      bounded and never shape-checked, like the draft's other text fields.
--
--   2. Existing drafts are backfilled from their live row. Without this, a
--      draft created before this migration holds empty strings, and its next
--      publish would silently clear a location or contact link the creator
--      never touched. `mailto:` is stripped for the draft, because the field
--      takes a bare address and adds the scheme itself.
--
--   3. `publish_public_profile()` is replaced with a version that snapshots,
--      compares and writes both columns. Its signature is unchanged, so its
--      execute grants are unchanged; they are restated below anyway, per
--      20260909170000.
--
-- The comparison needs one allowance. A publication made before this
-- migration has no `location` or `contact_url` key in its snapshot. The
-- previous function never wrote either column, so for those publications the
-- live row's current values are exactly what was published. The comparison
-- fills the two missing keys from the live row, which keeps an unchanged
-- republish a no-op instead of a spurious new publication. The builder's
-- "unpublished changes" state makes the same allowance in
-- lib/public/publish-state.ts.
--
-- Rollback: restore publish_public_profile() from
-- 20260912220200_publish_public_profile.sql, then drop the two draft columns
-- and their constraints. Live `location` and `contact_url` are not touched by
-- the rollback; they are the columns #72 created.

alter table public.public_profile_drafts
  add column location text not null default '',
  add column contact text not null default '';

alter table public.public_profile_drafts
  add constraint public_profile_drafts_location_length check (length(location) <= 200),
  add constraint public_profile_drafts_contact_length check (length(contact) <= 2048);

comment on column public.public_profile_drafts.location is
  'As typed. Optional; empty means no location on the public profile.';
comment on column public.public_profile_drafts.contact is
  'As typed: a website address or an email address. Optional; empty means no Contact button.';

update public.public_profile_drafts d
set location = coalesce(p.location, ''),
    contact = coalesce(regexp_replace(p.contact_url, '^mailto:', ''), '')
from public.public_profiles p
where p.id = d.public_profile_id;

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

  -- Idempotency: already live, and live is exactly this.
  if v_profile.status = 'published' and v_latest.id is not null and (jsonb_build_object('location', v_profile.location, 'contact_url', v_profile.contact_url)
        || v_latest.snapshot) = v_snapshot then
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
      location = v_snapshot ->> 'location',
      contact_url = v_snapshot ->> 'contact_url',
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
  'Publishes a profile draft onto the live profile and product-page rows in one transaction, and records the publication. Includes location and contact_url. Refuses a draft changed since review (PT409). Idempotent while the live snapshot is unchanged.';

revoke all on function public.publish_public_profile(uuid, timestamptz, jsonb, uuid[]) from public, anon;
grant execute on function public.publish_public_profile(uuid, timestamptz, jsonb, uuid[]) to authenticated;
