import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadNodeCode, fixture, runNodeCode } from './load-node-code.mjs';

const { buildJobs, normalizeLinkedinSlug, normalizeDomain, normalizeFacebookUrl } = loadNodeCode(
  'collect/build-jobs.js',
  ['buildJobs', 'normalizeLinkedinSlug', 'normalizeDomain', 'normalizeFacebookUrl'],
);
const { normalizeJobResult, normalizeMeta } = loadNodeCode('collect/normalize.js', ['normalizeJobResult', 'normalizeMeta']);
const { summarizeRun } = loadNodeCode('collect/summarize-run.js', ['summarizeRun']);

const NOW = new Date('2026-11-23T08:00:00Z');
const CONFIG = {
  country: 'BR',
  lookback_days: 14,
  meta_results_limit: 30,
  linkedin_results_limit: 30,
  google_results_limit: 20,
  keyword_results_limit: 30,
  linkedin_include_details: true,
  max_charge_usd_per_job: 0.5,
  apify_timeout_secs: 280,
  actors: {
    meta: 'jmlp~meta-ad-library-scraper',
    linkedin: 'alexmorain~linkedin-ad-library-scraper',
    google: 'scrapesage~google-ads-transparency-scraper',
  },
};
const COMPETITOR = {
  id: 'c1',
  name: 'Alfa TI',
  domain: 'https://www.alfati.com.br/',
  facebook_url: 'facebook.com/alfatitecnologia',
  linkedin_slug: 'https://www.linkedin.com/company/alfa-ti-tecnologia/',
};

test('input cleaners accept URLs and bare values', () => {
  assert.equal(normalizeLinkedinSlug('https://www.linkedin.com/company/alfa-ti-tecnologia/'), 'alfa-ti-tecnologia');
  assert.equal(normalizeLinkedinSlug('beta-cloud'), 'beta-cloud');
  assert.equal(normalizeLinkedinSlug(''), null);
  assert.equal(normalizeDomain('https://www.AlfaTI.com.br/servicos?x=1'), 'alfati.com.br');
  assert.equal(normalizeFacebookUrl('facebook.com/alfati'), 'https://facebook.com/alfati');
  assert.equal(normalizeFacebookUrl('@alfati'), 'https://www.facebook.com/alfati');
  assert.equal(normalizeFacebookUrl('https://www.facebook.com/x'), 'https://www.facebook.com/x');
});

test('buildJobs creates one job per platform and keyword', () => {
  const jobs = buildJobs({
    config: CONFIG,
    runId: 'run-1',
    competitors: [COMPETITOR, { id: 'c2', name: 'Sem redes', domain: null, facebook_url: '', linkedin_slug: null }],
    keywords: [{ keyword: 'outsourcing de TI', platforms: ['meta', 'linkedin'] }, { keyword: '  ', platforms: ['meta'] }],
    now: NOW,
  });
  assert.deepEqual(
    jobs.map((j) => `${j.source}:${j.platform}`),
    ['competitor:meta', 'competitor:linkedin', 'competitor:google', 'keyword:meta', 'keyword:linkedin'],
  );
  for (const job of jobs) {
    assert.equal(job.run_id, 'run-1');
    assert.equal(job.max_charge_usd, 0.5);
  }

  const [meta, linkedin, google, metaKw, linkedinKw] = jobs;
  assert.deepEqual(meta.input.adLibraryUrls, ['https://facebook.com/alfatitecnologia']);
  assert.equal(meta.input.country, 'BR');
  assert.equal(meta.input.keywordFallback, false);
  assert.equal(meta.competitor_id, 'c1');
  assert.deepEqual(linkedin.input.advertisers, ['alfa-ti-tecnologia']);
  assert.equal(linkedin.input.startDate, '2026-11-09');
  assert.equal(linkedin.input.endDate, '2026-11-22');
  assert.deepEqual(google.input.domains, ['alfati.com.br']);
  assert.equal(google.input.maxAdsPerSearch, 20);
  assert.equal(metaKw.input.keyword, 'outsourcing de TI');
  assert.equal(metaKw.input.searchType, 'keyword_exact_phrase');
  assert.equal(metaKw.competitor_id, null);
  assert.equal(linkedinKw.input.keyword, 'outsourcing de TI');
  assert.equal(linkedinKw.input.includeDetails, false);
});

test('buildJobs builds the official Meta scraper input when configured', () => {
  const config = { ...CONFIG, actors: { ...CONFIG.actors, meta: 'apify~facebook-ads-scraper' } };
  const jobs = buildJobs({
    config,
    runId: 'r',
    competitors: [{ ...COMPETITOR, linkedin_slug: null, domain: null }],
    keywords: [{ keyword: 'NOC 24x7', platforms: ['meta'] }],
    now: NOW,
  });
  assert.deepEqual(jobs[0].input.startUrls, [{ url: 'https://facebook.com/alfatitecnologia' }]);
  assert.match(jobs[1].input.startUrls[0].url, /country=BR/);
  assert.match(jobs[1].input.startUrls[0].url, /q=%22NOC\+24x7%22/);
});

const JOB = (platform, extra = {}) => ({
  run_id: 'run-1',
  platform,
  competitor_id: 'c1',
  source: 'competitor',
  source_query: 'x',
  limit: 30,
  ...extra,
});
const ok = (items) => ({ statusCode: 201, body: JSON.stringify(items) });

test('normalizes the jmlp Meta scraper output (snake_case)', () => {
  const payload = normalizeJobResult(JOB('meta'), ok(fixture('meta-jmlp.json')), NOW);
  assert.equal(payload.p_ok, true);
  assert.equal(payload.p_incomplete, false);
  const [ad] = payload.p_ads;
  assert.equal(ad.external_id, '1546096983313990');
  assert.equal(ad.advertiser_name, 'LISEC');
  assert.equal(ad.format, 'video');
  assert.equal(ad.cta, 'Visit profile');
  assert.match(ad.body, /^LiSEC, with over six decades/);
  assert.ok(ad.video_url.startsWith('https://video'));
  assert.ok(ad.image_url, 'video preview image is used as image');
  assert.equal(ad.library_url, 'https://www.facebook.com/ads/library/?id=1546096983313990');
  assert.equal(ad.platform_started_at, '2026-01-14T08:00:00.000Z');
  assert.equal(ad.is_active, true);
  assert.equal(ad.platform_last_shown_at, NOW.toISOString());
});

test('normalizes the official Meta scraper output and skips template text', () => {
  const payload = normalizeJobResult(JOB('meta'), ok(fixture('meta-official.json')), NOW);
  assert.equal(payload.p_ads.length, 2);
  const ad = payload.p_ads[0];
  assert.equal(ad.external_id, '1229350099285014');
  assert.equal(ad.advertiser_name, 'Sephora');
  assert.equal(ad.format, 'dco');
  assert.equal(ad.body, 'Major beauty benefits are waiting for you on the app 💞', 'template body falls back to card');
  assert.equal(ad.headline, 'Our App = Your Beauty BFF');
  assert.equal(ad.variations, 1);
  assert.deepEqual(ad.publisher_platforms, ['FACEBOOK', 'INSTAGRAM']);
});

test('inactive Meta ad keeps its end date', () => {
  const [item] = fixture('meta-jmlp.json');
  const ad = normalizeMeta({ ...item, is_active: false }, NOW);
  assert.equal(ad.is_active, false);
  assert.equal(ad.platform_last_shown_at, new Date(item.end_date * 1000).toISOString());
});

test('normalizes LinkedIn output, with and without details', () => {
  const payload = normalizeJobResult(JOB('linkedin'), ok(fixture('linkedin.json')), NOW);
  const [plain, detailed] = payload.p_ads;
  assert.equal(plain.external_id, '1525076296');
  assert.equal(plain.headline, 'Securing the AI Era, Together');
  assert.match(plain.body, /Open Secure AI Alliance/);
  assert.ok(plain.image_url.startsWith('https://media.licdn.com'));
  assert.equal(plain.platform_started_at, null);
  assert.equal(detailed.platform_started_at, '2026-04-23T00:00:00.000Z');
  assert.equal(detailed.is_active, false);
  assert.match(detailed.video_url, /720p/);
});

test('LinkedIn job ads are dropped', () => {
  const items = [{ ad_id: '1', format: 'Job Ad', headline: 'Vaga' }, { ad_id: '2', format: 'Single Image Ad', headline: 'Ok' }];
  const payload = normalizeJobResult(JOB('linkedin'), ok(items), NOW);
  assert.deepEqual(payload.p_ads.map((a) => a.external_id), ['2']);
});

test('normalizes Google output and derives activity from lastShown', () => {
  const payload = normalizeJobResult(JOB('google'), ok(fixture('google.json')), NOW);
  const [imageAd, textAd] = payload.p_ads;
  assert.equal(imageAd.external_id, 'CR09405416287280037889');
  assert.equal(imageAd.format, 'image');
  assert.equal(imageAd.is_active, false, 'last shown in June is not active in November');
  assert.ok(imageAd.image_url.startsWith('https://tpc.googlesyndication.com'));
  assert.equal(textAd.format, 'text');
  assert.equal(textAd.headline, 'HubSpot AI Sales Prospecting - Automate Lead Research - Leading LLM Technology');
  assert.match(textAd.body, /closing deals/);
  assert.equal(textAd.is_active, true);
});

test('Apify errors become a failed job that never closes ads', () => {
  const failed = normalizeJobResult(
    JOB('meta'),
    { statusCode: 400, body: JSON.stringify({ error: { type: 'run-failed', message: 'Actor run failed' } }) },
    NOW,
  );
  assert.equal(failed.p_ok, false);
  assert.equal(failed.p_incomplete, true);
  assert.match(failed.p_error, /HTTP 400: Actor run failed/);

  const timeout = normalizeJobResult(JOB('google'), { statusCode: 408, body: '{"error":{"type":"run-timeout-exceeded"}}' }, NOW);
  assert.equal(timeout.p_ok, false);

  const garbage = normalizeJobResult(JOB('google'), { statusCode: 201, body: '<html>' }, NOW);
  assert.equal(garbage.p_ok, false);

  const onlyErrors = normalizeJobResult(JOB('meta'), ok([{ error: { message: 'Page not found' } }]), NOW);
  assert.equal(onlyErrors.p_ok, false);
  assert.match(onlyErrors.p_error, /Page not found/);
});

test('reaching the limit or partial errors marks the listing incomplete', () => {
  const items = Array.from({ length: 3 }, (_, i) => ({ creativeId: `CR${i}`, lastShown: NOW.toISOString() }));
  assert.equal(normalizeJobResult(JOB('google', { limit: 3 }), ok(items), NOW).p_incomplete, true);
  assert.equal(normalizeJobResult(JOB('google', { limit: 30 }), ok(items), NOW).p_incomplete, false);
  const partial = normalizeJobResult(JOB('google'), ok([...items, { error: 'boom' }]), NOW);
  assert.equal(partial.p_ok, true);
  assert.equal(partial.p_incomplete, true);
  const empty = normalizeJobResult(JOB('google'), ok([]), NOW);
  assert.equal(empty.p_ok, true);
  assert.deepEqual(empty.p_ads, []);
});

test('duplicate ids in one dataset are saved once', () => {
  const items = [{ creativeId: 'CR1' }, { creativeId: 'CR1' }];
  assert.equal(normalizeJobResult(JOB('google'), ok(items), NOW).p_ads.length, 1);
});

test('summarizeRun computes status and totals', () => {
  const okRes = (platform, ads, inserted) => ({
    statusCode: 200,
    body: { platform, source_query: 'q', ok: true, ads, inserted, updated: ads - inserted, closed: 1 },
  });
  const failedJob = { statusCode: 200, body: { platform: 'google', source_query: 'x.com', ok: false, ads: 0, inserted: 0, updated: 0, closed: 0 } };
  const ingestDown = { statusCode: 401, body: { message: 'Invalid API key' } };

  const all = summarizeRun([okRes('meta', 5, 2), okRes('linkedin', 3, 3)], NOW);
  assert.equal(all.status, 'success');
  assert.equal(all.stats.ads_new, 5);
  assert.equal(all.stats.ads_closed, 2);
  assert.equal(all.stats.by_platform.meta.ads, 5);

  const partial = summarizeRun([okRes('meta', 5, 2), failedJob, ingestDown], NOW);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.stats.jobs_failed, 2);
  assert.equal(partial.stats.ingest_failures, 1);
  assert.match(partial.stats.errors.join(' '), /Invalid API key/);

  assert.equal(summarizeRun([failedJob], NOW).status, 'failed');
});

test('collect Code nodes run end to end with fake n8n globals', () => {
  const jobsOut = runNodeCode('collect/build-jobs.js', {
    nodes: {
      Config: [CONFIG],
      'Abrir execução': [{ id: 'run-9' }],
      'Buscar concorrentes': [{ body: JSON.stringify([COMPETITOR]) }],
      'Buscar palavras-chave': [{ body: '[]' }],
    },
  });
  assert.equal(jobsOut.length, 3);

  const normalized = runNodeCode('collect/normalize.js', {
    nodes: { 'Montar coletas': [jobsOut[2].json] },
    json: ok(fixture('google.json')),
  });
  assert.equal(normalized.json.p_run_id, 'run-9');
  assert.equal(normalized.json.p_platform, 'google');

  const summary = runNodeCode('collect/summarize-run.js', {
    nodes: { 'Abrir execução': [{ id: 'run-9' }] },
    input: [{ statusCode: 200, body: { platform: 'google', ok: true, ads: 2, inserted: 2, updated: 0, closed: 0 } }],
  });
  assert.equal(summary[0].json.run_id, 'run-9');
  assert.equal(summary[0].json.patch.status, 'success');

  assert.throws(
    () =>
      runNodeCode('collect/build-jobs.js', {
        nodes: {
          Config: [CONFIG],
          'Abrir execução': [{ id: 'run-9' }],
          'Buscar concorrentes': [{ body: '[]' }],
          'Buscar palavras-chave': [{ body: '[]' }],
        },
      }),
    /No jobs to run/,
  );
});
