-- ---------------------------------------------------------------------------
-- Public page views, and the numbers a creator reads from them.
--
-- One row per visit to a creator's public profile (`/@handle`, product page id
-- null) or to one of its product pages (`/@handle/<slug>`). Modelled on
-- public_outbound_clicks, and held to the same line:
--
--   - No visitor identity. No IP, no user agent, no cookie, no session or
--     visitor id, no full referrer. A row says a page was seen at a time, and
--     where from as a bare host. That answers "is anyone looking, and what
--     sends them" and cannot reconstruct anybody's browsing.
--   - Written only by the service role, from /api/public/view, which checks
--     the page against an `anon` read first. `anon` has no grant here at all:
--     a table with an anonymous insert grant is a table anybody on the
--     internet can write into.
--   - Readable by the workspace's own members, and nobody else.
--
-- The counts are an honest floor, not a census: a visitor without JavaScript,
-- or one whose browser blocks beacons, is not counted, and the same tab
-- reloading is counted once (the browser remembers, not the server).
-- ---------------------------------------------------------------------------

create table public.public_page_views (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  public_profile_id uuid not null,
  -- Null for a view of the profile itself.
  public_product_page_id uuid,
  occurred_at timestamptz not null default now(),
  referrer_host text,
  campaign text,

  constraint public_page_views_referrer_host_length
    check (referrer_host is null or length(referrer_host) between 1 and 253),
  constraint public_page_views_campaign_length
    check (campaign is null or length(campaign) between 1 and 64),

  constraint public_page_views_profile_fk
    foreign key (public_profile_id, workspace_id)
    references public.public_profiles (id, workspace_id)
    on delete cascade,
  -- MATCH SIMPLE: a profile view's null page id skips this check.
  constraint public_page_views_page_fk
    foreign key (public_product_page_id, workspace_id)
    references public.public_product_pages (id, workspace_id)
    on delete cascade
);

comment on table public.public_page_views is
  'One row per visit to a public profile or product page. Carries no visitor identity by design: no IP, no user agent, no session. Written only by the service role.';

create index public_page_views_profile_idx
  on public.public_page_views (public_profile_id, occurred_at desc);

create index public_page_views_workspace_idx
  on public.public_page_views (workspace_id, occurred_at desc);

-- The analytics function reads clicks by profile; the existing indexes are by
-- page and by workspace.
create index public_outbound_clicks_profile_idx
  on public.public_outbound_clicks (public_profile_id, occurred_at desc);

alter table public.public_page_views enable row level security;

revoke all on public.public_page_views from anon, authenticated;
grant select on public.public_page_views to authenticated;

create policy "page views are readable by workspace members"
  on public.public_page_views for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- public_profile_analytics(profile, days)
--
-- Everything the Profile page's Visitors section draws, in one round trip:
-- totals for the window and the window before it, a per-day series, and the
-- top products, referrers and channels.
--
-- Aggregated here rather than in the application because PostgREST caps a
-- select at max_rows (1000): counting rows fetched to Node would silently stop
-- at a thousand views, which is a wrong number that looks like a right one.
--
-- Security invoker and stable. Every read passes the caller's own RLS, so a
-- signed-in user asking about somebody else's profile gets zeros, not their
-- numbers, and the function needs no membership check of its own.
--
-- Days are UTC days. The window is the last `p_days` of them including today,
-- clamped to 1..365.
-- ---------------------------------------------------------------------------

create or replace function public.public_profile_analytics(
  p_public_profile_id uuid,
  p_days integer
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      d.days,
      d.today - make_interval(days => d.days - 1) as since,
      d.today - make_interval(days => 2 * d.days - 1) as previous_since,
      d.today
    from (
      select
        least(greatest(coalesce(p_days, 30), 1), 365) as days,
        date_trunc('day', now(), 'UTC') as today
    ) d
  ),
  views as (
    select v.public_product_page_id, v.occurred_at, v.referrer_host,
           v.occurred_at >= b.since as current
    from public.public_page_views v, bounds b
    where v.public_profile_id = p_public_profile_id
      and v.occurred_at >= b.previous_since
  ),
  clicks as (
    select c.public_product_page_id, c.channel_id, c.occurred_at >= b.since as current
    from public.public_outbound_clicks c, bounds b
    where c.public_profile_id = p_public_profile_id
      and c.occurred_at >= b.previous_since
  ),
  daily as (
    select
      day,
      count(v.occurred_at) filter (where v.public_product_page_id is null) as profile_views,
      count(v.occurred_at) filter (where v.public_product_page_id is not null) as product_views
    from bounds b
    cross join lateral generate_series(b.since, b.today, interval '1 day') as day
    left join views v
      on v.current
     and v.occurred_at >= day
     and v.occurred_at < day + interval '1 day'
    group by day
  ),
  product_counts as (
    select page_id, sum(views) as views, sum(clicks) as clicks
    from (
      select public_product_page_id as page_id, 1 as views, 0 as clicks
      from views where current and public_product_page_id is not null
      union all
      select public_product_page_id, 0, 1 from clicks where current
    ) u
    group by page_id
  ),
  top_products as (
    select
      pc.page_id,
      pp.slug,
      coalesce(pp.title_override, pr.canonical_title, pr.name) as title,
      pc.views,
      pc.clicks
    from product_counts pc
    join public.public_product_pages pp on pp.id = pc.page_id
    join public.products pr on pr.id = pp.product_id
    order by pc.views desc, pc.clicks desc, title
    limit 10
  ),
  top_referrers as (
    select referrer_host as host, count(*) as views
    from views
    where current
    group by referrer_host
    order by count(*) desc, referrer_host nulls last
    limit 8
  ),
  top_channels as (
    select ch.name, count(*) as clicks
    from clicks c
    join public.channels ch on ch.id = c.channel_id
    where c.current
    group by ch.name
    order by count(*) desc, ch.name
    limit 8
  )
  select jsonb_build_object(
    'days', (select days from bounds),
    'since', (select since from bounds),
    'profileViews', (select count(*) from views where current and public_product_page_id is null),
    'productViews', (select count(*) from views where current and public_product_page_id is not null),
    'outboundClicks', (select count(*) from clicks where current),
    'previousProfileViews',
      (select count(*) from views where not current and public_product_page_id is null),
    'previousProductViews',
      (select count(*) from views where not current and public_product_page_id is not null),
    'previousOutboundClicks', (select count(*) from clicks where not current),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', to_char(day at time zone 'UTC', 'YYYY-MM-DD'),
        'profileViews', profile_views,
        'productViews', product_views
      ) order by day)
      from daily
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', slug, 'title', title, 'views', views, 'clicks', clicks
      ) order by views desc, clicks desc, title)
      from top_products
    ), '[]'::jsonb),
    'referrers', coalesce((
      select jsonb_agg(jsonb_build_object('host', host, 'views', views)
        order by views desc, host nulls last)
      from top_referrers
    ), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'clicks', clicks)
        order by clicks desc, name)
      from top_channels
    ), '[]'::jsonb)
  )
$$;

comment on function public.public_profile_analytics(uuid, integer) is
  'Views of a public profile and its product pages, and clicks out to channels, over the last p_days UTC days and the window before. Security invoker: RLS decides what is counted.';

revoke all on function public.public_profile_analytics(uuid, integer) from public, anon;
grant execute on function public.public_profile_analytics(uuid, integer) to authenticated;
