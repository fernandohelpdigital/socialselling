// Builds one Apify job per (competitor x platform) and per (keyword x platform).

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(now, days) {
  return isoDate(new Date(now.getTime() - days * DAY_MS));
}

function parseJsonList(text) {
  if (Array.isArray(text)) return text;
  if (typeof text !== 'string' || text.trim() === '') return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`Expected a JSON array from Supabase, got: ${text.slice(0, 200)}`);
  return parsed;
}

function normalizeFacebookUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/facebook\.com/i.test(trimmed)) return `https://${trimmed.replace(/^\/+/, '')}`;
  return `https://www.facebook.com/${trimmed.replace(/^[@/]+/, '')}`;
}

function normalizeLinkedinSlug(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const match = trimmed.match(/linkedin\.com\/(?:company|showcase)\/([^/?#]+)/i);
  const slug = match ? match[1] : trimmed.replace(/^\/+|\/+$/g, '');
  return slug === '' ? null : slug;
}

function normalizeDomain(value) {
  if (!value) return null;
  const domain = String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];
  return domain === '' ? null : domain;
}

function metaKeywordUrl(keyword, country) {
  const params = new URLSearchParams({
    active_status: 'active',
    ad_type: 'all',
    country,
    is_targeted_country: 'false',
    media_type: 'all',
    q: `"${keyword}"`,
    search_type: 'keyword_exact_phrase',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

// Two Meta scrapers are supported. The default (jmlp) costs about $0.15 per 1,000 ads;
// Apify's official one costs about $5.80 per 1,000 on the free plan.
function metaInput(config, { url, keyword, limit }) {
  if (config.actors.meta.startsWith('apify~facebook-ads-scraper')) {
    return {
      startUrls: [{ url: url || metaKeywordUrl(keyword, config.country) }],
      resultsLimit: limit,
      activeStatus: 'active',
      isDetailsPerAd: false,
      onlyTotal: false,
      includeAboutPage: false,
    };
  }
  const target = url ? { adLibraryUrls: [url] } : { keyword, searchType: 'keyword_exact_phrase' };
  return {
    ...target,
    activeStatus: 'active',
    country: config.country,
    sortBy: 'impressions',
    maxAds: limit,
    maxAdsPerTarget: limit,
    keywordFallback: false,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
  };
}

function makeJob(base, fields) {
  return {
    run_id: base.runId,
    timeout_secs: base.config.apify_timeout_secs,
    max_charge_usd: base.config.max_charge_usd_per_job,
    competitor_id: null,
    competitor_name: null,
    ...fields,
  };
}

function buildJobs({ config, runId, competitors, keywords, now }) {
  const base = { config, runId };
  const start = daysAgo(now, config.lookback_days);
  const end = daysAgo(now, 1);
  const jobs = [];

  for (const competitor of competitors) {
    const owner = { competitor_id: competitor.id, competitor_name: competitor.name, source: 'competitor' };

    const facebookUrl = normalizeFacebookUrl(competitor.facebook_url);
    if (facebookUrl) {
      jobs.push(
        makeJob(base, {
          ...owner,
          platform: 'meta',
          source_query: facebookUrl,
          actor: config.actors.meta,
          limit: config.meta_results_limit,
          input: metaInput(config, { url: facebookUrl, limit: config.meta_results_limit }),
        }),
      );
    }

    const linkedinSlug = normalizeLinkedinSlug(competitor.linkedin_slug);
    if (linkedinSlug) {
      jobs.push(
        makeJob(base, {
          ...owner,
          platform: 'linkedin',
          source_query: linkedinSlug,
          actor: config.actors.linkedin,
          limit: config.linkedin_results_limit,
          input: {
            advertisers: [linkedinSlug],
            countries: [config.country],
            startDate: start,
            endDate: end,
            includeDetails: config.linkedin_include_details,
            maxAdsPerQuery: config.linkedin_results_limit,
            proxyConfiguration: { useApifyProxy: true },
          },
        }),
      );
    }

    const domain = normalizeDomain(competitor.domain);
    if (domain) {
      jobs.push(
        makeJob(base, {
          ...owner,
          platform: 'google',
          source_query: domain,
          actor: config.actors.google,
          limit: config.google_results_limit,
          input: {
            domains: [domain],
            resultType: 'ads',
            region: config.country,
            startDate: start,
            maxAdsPerSearch: config.google_results_limit,
            includeAdText: true,
            includeDetails: false,
            proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
          },
        }),
      );
    }
  }

  for (const row of keywords) {
    const keyword = String(row.keyword || '').trim();
    if (keyword === '') continue;
    const platforms = Array.isArray(row.platforms) ? row.platforms : ['meta', 'linkedin'];

    if (platforms.includes('meta')) {
      jobs.push(
        makeJob(base, {
          platform: 'meta',
          source: 'keyword',
          source_query: keyword,
          actor: config.actors.meta,
          limit: config.keyword_results_limit,
          input: metaInput(config, { keyword, limit: config.keyword_results_limit }),
        }),
      );
    }

    if (platforms.includes('linkedin')) {
      jobs.push(
        makeJob(base, {
          platform: 'linkedin',
          source: 'keyword',
          source_query: keyword,
          actor: config.actors.linkedin,
          limit: config.keyword_results_limit,
          input: {
            keyword,
            countries: [config.country],
            startDate: start,
            endDate: end,
            includeDetails: false,
            maxAdsPerQuery: config.keyword_results_limit,
            proxyConfiguration: { useApifyProxy: true },
          },
        }),
      );
    }
  }

  return jobs;
}

// @n8n-entry
const config = $('Config').first().json;
const runId = $('Abrir execução').first().json.id;
const competitors = parseJsonList($('Buscar concorrentes').first().json.body);
const keywords = parseJsonList($('Buscar palavras-chave').first().json.body);

if (!runId) throw new Error('Supabase did not return the run id. Check the spy_runs table and the Supabase credential.');

const jobs = buildJobs({ config, runId, competitors, keywords, now: new Date() });
if (jobs.length === 0) {
  throw new Error('No jobs to run. Add competitors (spy_competitors) or keywords (spy_keywords) in Supabase.');
}
return jobs.map((job) => ({ json: job }));
