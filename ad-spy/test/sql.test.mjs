// Runs supabase/001_schema.sql on an in-memory Postgres (PGlite) and exercises the RPCs.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', '001_schema.sql'), 'utf8');
let db;

async function one(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows[0];
}

async function newRun() {
  return (await one(`insert into spy_runs default values returning id`)).id;
}

function ad(id, extra = {}) {
  return { external_id: id, advertiser_name: 'Alfa TI', format: 'image', headline: `Ad ${id}`, body: `Body ${id}`, is_active: true, ...extra };
}

async function ingest(runId, { platform = 'meta', competitorId = null, source = 'competitor', query = 'q', ok = true, incomplete = false, ads = [] }) {
  const row = await one(`select spy_ingest($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) as r`, [
    runId,
    platform,
    competitorId,
    source,
    query,
    ok,
    ok ? null : 'boom',
    incomplete,
    JSON.stringify(ads),
  ]);
  return row.r;
}

async function activeIds(competitorId) {
  const { rows } = await db.query(
    `select external_id from spy_ads where competitor_id = $1 and is_active order by external_id`,
    [competitorId],
  );
  return rows.map((r) => r.external_id);
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await db.exec(SCHEMA);
  await db.exec(SCHEMA); // must be idempotent
});

test('ingest inserts, updates and closes ads that disappeared', async () => {
  const c = (await one(`insert into spy_competitors (name, segment) values ('Alfa TI', 'msp') returning id`)).id;

  const run1 = await newRun();
  const r1 = await ingest(run1, { competitorId: c, ads: [ad('A'), ad('B')] });
  assert.deepEqual({ inserted: r1.inserted, updated: r1.updated, closed: r1.closed }, { inserted: 2, updated: 0, closed: 0 });

  const run2 = await newRun();
  const r2 = await ingest(run2, { competitorId: c, ads: [ad('A', { body: 'Body A, now longer' }), ad('C')] });
  assert.deepEqual({ inserted: r2.inserted, updated: r2.updated, closed: r2.closed }, { inserted: 1, updated: 1, closed: 1 });
  assert.deepEqual(await activeIds(c), ['A', 'C']);
  const b = await one(`select is_active, stopped_at from spy_ads where external_id = 'B'`);
  assert.equal(b.is_active, false);
  assert.ok(b.stopped_at);
  assert.equal((await one(`select body from spy_ads where external_id = 'A'`)).body, 'Body A, now longer');

  // B shows up again: reactivated
  const run3 = await newRun();
  await ingest(run3, { competitorId: c, ads: [ad('A'), ad('B'), ad('C')] });
  assert.deepEqual(await activeIds(c), ['A', 'B', 'C']);
  assert.equal((await one(`select stopped_at from spy_ads where external_id = 'B'`)).stopped_at, null);
});

test('failed, incomplete or first empty scrapes never close ads', async () => {
  const c = (await one(`insert into spy_competitors (name) values ('Beta Cloud') returning id`)).id;
  await ingest(await newRun(), { competitorId: c, platform: 'google', ads: [ad('G1'), ad('G2')] });

  await ingest(await newRun(), { competitorId: c, platform: 'google', ok: false });
  assert.deepEqual(await activeIds(c), ['G1', 'G2'], 'failed job');

  await ingest(await newRun(), { competitorId: c, platform: 'google', incomplete: true, ads: [ad('G1')] });
  assert.deepEqual(await activeIds(c), ['G1', 'G2'], 'incomplete listing');

  const firstEmpty = await ingest(await newRun(), { competitorId: c, platform: 'google', ads: [] });
  assert.equal(firstEmpty.closed, 0);
  assert.deepEqual(await activeIds(c), ['G1', 'G2'], 'first empty result');

  const secondEmpty = await ingest(await newRun(), { competitorId: c, platform: 'google', ads: [] });
  assert.equal(secondEmpty.closed, 2);
  assert.deepEqual(await activeIds(c), [], 'second empty result in a row');
});

test('closing is scoped to the same competitor and platform', async () => {
  const c = (await one(`insert into spy_competitors (name) values ('Gama MSP') returning id`)).id;
  const run = await newRun();
  await ingest(run, { competitorId: c, platform: 'meta', ads: [ad('M1')] });
  await ingest(run, { competitorId: c, platform: 'linkedin', ads: [ad('L1')] });
  await ingest(await newRun(), { competitorId: c, platform: 'meta', ads: [ad('M2')] });
  assert.deepEqual(await activeIds(c), ['L1', 'M2']);
});

test('keyword ads are linked to a competitor when the competitor scrape finds them', async () => {
  const c = (await one(`insert into spy_competitors (name) values ('Delta Suporte') returning id`)).id;
  const run = await newRun();
  await ingest(run, { source: 'keyword', query: 'suporte de TI', platform: 'linkedin', ads: [ad('K1', { advertiser_name: 'Delta Suporte' })] });
  let row = await one(`select competitor_id, source from spy_ads where external_id = 'K1'`);
  assert.equal(row.competitor_id, null);
  assert.equal(row.source, 'keyword');

  await ingest(run, { competitorId: c, platform: 'linkedin', ads: [ad('K1')] });
  row = await one(`select competitor_id, source from spy_ads where external_id = 'K1'`);
  assert.equal(row.competitor_id, c);
  assert.equal(row.source, 'competitor');
});

test('jobs are logged per run', async () => {
  const run = await newRun();
  await ingest(run, { platform: 'meta', source: 'keyword', query: 'NOC 24x7', ads: [ad('N1', { advertiser_name: 'Nova MSP' })] });
  await ingest(run, { platform: 'google', source: 'keyword', query: 'x', ok: false });
  const { rows } = await db.query(`select ok, ads_count, inserted from spy_run_jobs where run_id = $1 order by id`, [run]);
  assert.deepEqual(rows, [
    { ok: true, ads_count: 1, inserted: 1 },
    { ok: false, ads_count: 0, inserted: 0 },
  ]);
});

test('days_running uses the platform start date when available', async () => {
  const run = await newRun();
  const started = new Date(Date.now() - 40 * 86400000).toISOString();
  await ingest(run, { source: 'keyword', platform: 'meta', ads: [ad('D1', { platform_started_at: started })] });
  const row = await one(`select days_running from spy_ads_view where external_id = 'D1'`);
  assert.equal(row.days_running, 41);
});

test('weekly report has every section the digest uses', async () => {
  await db.query(`update spy_ads set analysis = $1::jsonb, analyzed_at = now() where external_id = 'A'`, [
    JSON.stringify({ is_relevant: true, pain: 'it_cost', offer: 'free_assessment', funnel_stage: 'middle', creative_format: 'static_image', tone: 'consultative', inspiration_score: 5, summary: 'ok' }),
  ]);
  await db.query(`update spy_ads set analysis = '{"is_relevant": false}'::jsonb, analyzed_at = now() where external_id = 'C'`);
  await db.exec(`insert into spy_runs (status) values ('partial')`);

  const report = (await one(`select spy_weekly_report(7) as r`)).r;
  for (const key of ['period', 'totals', 'by_competitor', 'new_ads', 'long_running', 'stopped', 'patterns_active_ads', 'new_advertisers', 'collection_health']) {
    assert.ok(key in report, key);
  }
  assert.equal(report.patterns_active_ads.pain.it_cost, 1);
  assert.equal(report.new_ads[0].inspiration_score, 5, 'best ads first');
  assert.ok(!report.new_ads.some((a) => a.headline === 'Ad C'), 'irrelevant ads are left out');
  assert.ok(report.new_advertisers.some((a) => a.advertiser === 'Nova MSP'), 'keyword advertiser not tracked yet');
  assert.ok(!report.new_advertisers.some((a) => a.advertiser === 'Delta Suporte'), 'tracked names are not "new"');
  assert.ok(report.by_competitor.some((c) => c.name === 'Alfa TI'));
  assert.equal(report.collection_health.last_run_status, 'partial');
});

test('anon and authenticated roles cannot call the functions', async () => {
  const { rows } = await db.query(
    `select has_function_privilege('anon', 'spy_weekly_report(int)', 'execute') as anon,
            has_function_privilege('service_role', 'spy_weekly_report(int)', 'execute') as service`,
  );
  assert.deepEqual(rows[0], { anon: false, service: true });
});
