-- Ad Spy (Espião de Anúncios): competitor ad monitoring for Meta, LinkedIn and Google.
-- Run once in the Supabase SQL Editor. Safe to re-run: every statement is idempotent.
-- All tables use the spy_ prefix and keep RLS on with no policies, so only the
-- secret/service_role key used by n8n can read or write them.

-- Companies we watch. One row per competitor; each platform column is optional.
create table if not exists public.spy_competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  segment text not null default 'other'
    check (segment in ('msp', 'outsourcing', 'cloud_m365', 'security', 'tech_b2b', 'other')),
  city text,
  state text,
  domain text,          -- Google Ads Transparency Center: ads pointing to this domain
  facebook_url text,    -- Meta Ad Library: facebook.com/<page>
  linkedin_slug text,   -- LinkedIn Ad Library: linkedin.com/company/<slug>
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists spy_competitors_name_key on public.spy_competitors (lower(name));

-- Niche keywords used to discover advertisers that are not in spy_competitors yet.
create table if not exists public.spy_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null unique,
  platforms text[] not null default array['meta', 'linkedin'],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint spy_keywords_platforms_check check (platforms <@ array['meta', 'linkedin'])
);

-- One row per weekly collection.
create table if not exists public.spy_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  stats jsonb not null default '{}'::jsonb
);

-- One row per scraper call (competitor x platform, or keyword x platform).
create table if not exists public.spy_run_jobs (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.spy_runs (id) on delete cascade,
  platform text not null check (platform in ('meta', 'linkedin', 'google')),
  competitor_id uuid references public.spy_competitors (id) on delete set null,
  source text not null check (source in ('competitor', 'keyword')),
  source_query text,
  ok boolean not null,
  error text,
  ads_count int not null default 0,
  inserted int not null default 0,
  updated int not null default 0,
  closed int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists spy_run_jobs_lookup_idx
  on public.spy_run_jobs (competitor_id, platform, source, created_at desc);

-- Every ad ever seen. (platform, external_id) is the dedupe key.
create table if not exists public.spy_ads (
  id bigint generated always as identity primary key,
  platform text not null check (platform in ('meta', 'linkedin', 'google')),
  external_id text not null,
  competitor_id uuid references public.spy_competitors (id) on delete set null,
  advertiser_name text,
  source text not null check (source in ('competitor', 'keyword')),
  source_query text,
  format text,
  headline text,
  body text,
  cta text,
  link_url text,
  image_url text,
  video_url text,
  library_url text,
  publisher_platforms text[],
  variations int,
  platform_started_at timestamptz,    -- start date reported by the platform, when it reports one
  platform_last_shown_at timestamptz, -- last shown date reported by the platform (Google)
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_run_id uuid references public.spy_runs (id) on delete set null,
  is_active boolean not null default true,
  stopped_at timestamptz,
  raw jsonb,
  analysis jsonb,
  analyzed_at timestamptz,
  analysis_attempts int not null default 0,
  analysis_error text,
  unique (platform, external_id)
);
create index if not exists spy_ads_competitor_idx on public.spy_ads (competitor_id, platform, is_active);
create index if not exists spy_ads_pending_idx on public.spy_ads (first_seen_at desc) where analyzed_at is null;
create index if not exists spy_ads_first_seen_idx on public.spy_ads (first_seen_at desc);

-- Weekly WhatsApp digests, kept for history.
create table if not exists public.spy_digests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  period_start timestamptz,
  period_end timestamptz,
  report jsonb,
  message text,
  model text
);

-- Ads with competitor name and days running. Days running uses the platform's own
-- start date when it gives one (Meta, Google) and our first sighting otherwise (LinkedIn).
create or replace view public.spy_ads_view
with (security_invoker = true) as
select
  a.*,
  c.name as competitor_name,
  c.segment as competitor_segment,
  greatest(
    0,
    coalesce(a.stopped_at, greatest(a.platform_last_shown_at, a.last_seen_at))::date
      - coalesce(a.platform_started_at, a.first_seen_at)::date
  ) + 1 as days_running
from public.spy_ads a
left join public.spy_competitors c on c.id = a.competitor_id;

alter table public.spy_competitors enable row level security;
alter table public.spy_keywords enable row level security;
alter table public.spy_runs enable row level security;
alter table public.spy_run_jobs enable row level security;
alter table public.spy_ads enable row level security;
alter table public.spy_digests enable row level security;

-- Saves one scraper result. Upserts ads, logs the job and marks as stopped the ads of
-- this competitor/platform that did not show up this time.
-- Closing is skipped when the listing may be incomplete (limit reached or partial errors), and an empty
-- result only closes ads when the previous job for the same target was empty too,
-- so one bad scrape never wipes a competitor's active ads.
create or replace function public.spy_ingest(
  p_run_id uuid,
  p_platform text,
  p_competitor_id uuid,
  p_source text,
  p_source_query text,
  p_ok boolean,
  p_error text,
  p_incomplete boolean,
  p_ads jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ad jsonb;
  v_is_new boolean;
  v_inserted int := 0;
  v_updated int := 0;
  v_closed int := 0;
  v_count int := coalesce(jsonb_array_length(p_ads), 0);
  v_previous_empty boolean;
begin
  if p_ok and v_count > 0 then
    for v_ad in select value from jsonb_array_elements(p_ads) loop
      insert into spy_ads (
        platform, external_id, competitor_id, advertiser_name, source, source_query,
        format, headline, body, cta, link_url, image_url, video_url, library_url,
        publisher_platforms, variations, platform_started_at, platform_last_shown_at,
        last_run_id, is_active, stopped_at, raw
      ) values (
        p_platform,
        v_ad ->> 'external_id',
        p_competitor_id,
        v_ad ->> 'advertiser_name',
        p_source,
        p_source_query,
        v_ad ->> 'format',
        v_ad ->> 'headline',
        v_ad ->> 'body',
        v_ad ->> 'cta',
        v_ad ->> 'link_url',
        v_ad ->> 'image_url',
        v_ad ->> 'video_url',
        v_ad ->> 'library_url',
        case when jsonb_typeof(v_ad -> 'publisher_platforms') = 'array'
          then array(select jsonb_array_elements_text(v_ad -> 'publisher_platforms')) end,
        (v_ad ->> 'variations')::int,
        (v_ad ->> 'platform_started_at')::timestamptz,
        (v_ad ->> 'platform_last_shown_at')::timestamptz,
        p_run_id,
        coalesce((v_ad ->> 'is_active')::boolean, true),
        case when coalesce((v_ad ->> 'is_active')::boolean, true) then null else now() end,
        v_ad -> 'raw'
      )
      on conflict (platform, external_id) do update set
        competitor_id = coalesce(spy_ads.competitor_id, excluded.competitor_id),
        source = case when excluded.competitor_id is not null then 'competitor' else spy_ads.source end,
        advertiser_name = coalesce(excluded.advertiser_name, spy_ads.advertiser_name),
        format = coalesce(excluded.format, spy_ads.format),
        headline = coalesce(excluded.headline, spy_ads.headline),
        body = case when length(coalesce(excluded.body, '')) >= length(coalesce(spy_ads.body, ''))
          then excluded.body else spy_ads.body end,
        cta = coalesce(excluded.cta, spy_ads.cta),
        link_url = coalesce(excluded.link_url, spy_ads.link_url),
        image_url = coalesce(excluded.image_url, spy_ads.image_url),
        video_url = coalesce(excluded.video_url, spy_ads.video_url),
        library_url = coalesce(excluded.library_url, spy_ads.library_url),
        publisher_platforms = coalesce(excluded.publisher_platforms, spy_ads.publisher_platforms),
        variations = coalesce(excluded.variations, spy_ads.variations),
        platform_started_at = coalesce(spy_ads.platform_started_at, excluded.platform_started_at),
        platform_last_shown_at = greatest(spy_ads.platform_last_shown_at, excluded.platform_last_shown_at),
        last_seen_at = now(),
        last_run_id = excluded.last_run_id,
        is_active = excluded.is_active,
        stopped_at = case when excluded.is_active then null else coalesce(spy_ads.stopped_at, now()) end,
        raw = coalesce(excluded.raw, spy_ads.raw)
      returning (xmax = 0) into v_is_new;

      if v_is_new then
        v_inserted := v_inserted + 1;
      else
        v_updated := v_updated + 1;
      end if;
    end loop;
  end if;

  if p_ok and p_source = 'competitor' and p_competitor_id is not null
     and not coalesce(p_incomplete, false) then
    if v_count = 0 then
      select coalesce(j.ok and j.ads_count = 0, false) into v_previous_empty
      from spy_run_jobs j
      where j.competitor_id = p_competitor_id
        and j.platform = p_platform
        and j.source = 'competitor'
        and j.run_id <> p_run_id
      order by j.created_at desc
      limit 1;
    end if;

    if v_count > 0 or coalesce(v_previous_empty, false) then
      update spy_ads
      set is_active = false, stopped_at = now()
      where competitor_id = p_competitor_id
        and platform = p_platform
        and is_active
        and last_run_id is distinct from p_run_id;
      get diagnostics v_closed = row_count;
    end if;
  end if;

  insert into spy_run_jobs (
    run_id, platform, competitor_id, source, source_query, ok, error,
    ads_count, inserted, updated, closed
  ) values (
    p_run_id, p_platform, p_competitor_id, p_source, p_source_query, p_ok, left(p_error, 2000),
    v_count, v_inserted, v_updated, v_closed
  );

  return jsonb_build_object(
    'platform', p_platform,
    'source_query', p_source_query,
    'ok', p_ok,
    'ads', v_count,
    'inserted', v_inserted,
    'updated', v_updated,
    'closed', v_closed
  );
end;
$$;

-- Everything the weekly digest needs, in one JSON document.
create or replace function public.spy_weekly_report(p_days int default 7)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with params as (
  select now() - make_interval(days => p_days) as since, now() as until
),
relevant as (
  select v.*
  from spy_ads_view v
  where coalesce((v.analysis ->> 'is_relevant')::boolean, true)
),
new_ads as (
  select r.* from relevant r, params p where r.first_seen_at >= p.since
),
stopped as (
  select r.* from relevant r, params p where not r.is_active and r.stopped_at >= p.since
),
active as (
  select * from relevant where is_active
),
card as (
  select
    r.id,
    jsonb_strip_nulls(jsonb_build_object(
      'id', r.id,
      'platform', r.platform,
      'advertiser', coalesce(r.competitor_name, r.advertiser_name),
      'tracked_competitor', r.competitor_id is not null,
      'format', r.format,
      'headline', left(r.headline, 160),
      'body', left(r.body, 450),
      'cta', r.cta,
      'days_running', r.days_running,
      'variations', r.variations,
      'library_url', r.library_url,
      'summary', r.analysis ->> 'summary',
      'pain', r.analysis ->> 'pain',
      'offer', r.analysis ->> 'offer',
      'funnel_stage', r.analysis ->> 'funnel_stage',
      'hook', r.analysis ->> 'hook',
      'visual_style', r.analysis ->> 'visual_style',
      'proof', r.analysis -> 'proof',
      'tone', r.analysis ->> 'tone',
      'inspiration_score', r.analysis -> 'inspiration_score',
      'idea_for_us', r.analysis ->> 'idea_for_us'
    )) as doc
  from relevant r
),
last_run as (
  select * from spy_runs order by started_at desc limit 1
)
select jsonb_build_object(
  'period', (select jsonb_build_object('from', since, 'to', until, 'days', p_days) from params),
  'totals', jsonb_build_object(
    'active_ads', (select count(*) from active),
    'new_ads', (select count(*) from new_ads),
    'stopped_ads', (select count(*) from stopped),
    'tracked_competitors', (select count(*) from spy_competitors where active),
    'active_by_platform', (
      select coalesce(jsonb_object_agg(platform, n), '{}'::jsonb)
      from (select platform, count(*) as n from active group by platform) t
    ),
    'new_by_platform', (
      select coalesce(jsonb_object_agg(platform, n), '{}'::jsonb)
      from (select platform, count(*) as n from new_ads group by platform) t
    )
  ),
  'by_competitor', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.new_ads desc, t.active_ads desc), '[]'::jsonb)
    from (
      select
        r.competitor_name as name,
        count(*) filter (where r.is_active) as active_ads,
        count(*) filter (where r.first_seen_at >= (select since from params)) as new_ads,
        count(*) filter (where not r.is_active and r.stopped_at >= (select since from params)) as stopped_ads,
        array_agg(distinct r.platform) filter (where r.is_active) as active_platforms,
        max(r.days_running) filter (where r.is_active) as longest_running_days
      from relevant r
      where r.competitor_id is not null
      group by r.competitor_name
      having count(*) filter (where r.is_active) > 0
          or count(*) filter (where r.first_seen_at >= (select since from params)) > 0
          or count(*) filter (where not r.is_active and r.stopped_at >= (select since from params)) > 0
    ) t
  ),
  'new_ads', (
    select coalesce(jsonb_agg(c.doc order by (n.analysis ->> 'inspiration_score')::int desc nulls last, n.first_seen_at desc), '[]'::jsonb)
    from (select * from new_ads order by (analysis ->> 'inspiration_score')::int desc nulls last, first_seen_at desc limit 40) n
    join card c on c.id = n.id
  ),
  'long_running', (
    select coalesce(jsonb_agg(c.doc order by a.days_running desc), '[]'::jsonb)
    from (select * from active where days_running >= 21 order by days_running desc limit 15) a
    join card c on c.id = a.id
  ),
  'stopped', (
    select coalesce(jsonb_agg(c.doc order by s.days_running asc), '[]'::jsonb)
    from (select * from stopped order by days_running asc limit 15) s
    join card c on c.id = s.id
  ),
  'patterns_active_ads', jsonb_build_object(
    'pain', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select analysis ->> 'pain' as k, count(*) as n from active where analysis is not null group by 1) t),
    'offer', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select analysis ->> 'offer' as k, count(*) as n from active where analysis is not null group by 1) t),
    'funnel_stage', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select analysis ->> 'funnel_stage' as k, count(*) as n from active where analysis is not null group by 1) t),
    'creative_format', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select analysis ->> 'creative_format' as k, count(*) as n from active where analysis is not null group by 1) t),
    'tone', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select analysis ->> 'tone' as k, count(*) as n from active where analysis is not null group by 1) t)
  ),
  'new_advertisers', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.ads desc), '[]'::jsonb)
    from (
      select
        n.advertiser_name as advertiser,
        n.platform,
        count(*) as ads,
        min(n.source_query) as found_by_keyword,
        (array_agg(coalesce(n.headline, left(n.body, 120)) order by n.first_seen_at desc))[1] as sample
      from new_ads n
      where n.competitor_id is null
        and n.advertiser_name is not null
        and not exists (
          select 1 from spy_competitors c where lower(c.name) = lower(n.advertiser_name)
        )
      group by n.advertiser_name, n.platform
      order by count(*) desc
      limit 15
    ) t
  ),
  'collection_health', (
    select jsonb_build_object(
      'last_run_status', lr.status,
      'last_run_started_at', lr.started_at,
      'last_run_finished_at', lr.finished_at,
      'failed_jobs', (
        select coalesce(jsonb_agg(jsonb_build_object('platform', j.platform, 'query', j.source_query, 'error', left(j.error, 200))), '[]'::jsonb)
        from spy_run_jobs j
        where j.run_id = lr.id and not j.ok
      )
    )
    from last_run lr
  )
);
$$;

-- Only the backend key (used by n8n) may call these functions.
revoke all on function public.spy_ingest(uuid, text, uuid, text, text, boolean, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.spy_weekly_report(int) from public, anon, authenticated;
grant execute on function public.spy_ingest(uuid, text, uuid, text, text, boolean, text, boolean, jsonb) to service_role;
grant execute on function public.spy_weekly_report(int) to service_role;
