// Turns one Apify response into the payload of the spy_ingest RPC.

const DAY_MS = 24 * 60 * 60 * 1000;
const GOOGLE_ACTIVE_WINDOW_DAYS = 7;
const MAX_RAW_CHARS = 20000;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text.includes('{{')) return null;
  return text;
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseLinkedinDate(value) {
  const match = typeof value === 'string' && value.trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!match || MONTHS[match[1]] === undefined) return null;
  return new Date(Date.UTC(Number(match[3]), MONTHS[match[1]], Number(match[2]))).toISOString();
}

function compactRaw(raw) {
  const text = JSON.stringify(raw);
  return text.length > MAX_RAW_CHARS ? { truncated: true, preview: text.slice(0, 2000) } : raw;
}

// Reads a field in either naming style: Apify's official scraper uses camelCase
// (adArchiveID, snapshot.ctaText), the default jmlp scraper uses snake_case (ad_archive_id, snapshot.cta_text).
function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function metaMedia(node) {
  return {
    image: firstText(
      pick(node, 'originalImageUrl', 'original_image_url'),
      pick(node, 'resizedImageUrl', 'resized_image_url'),
    ),
    preview: firstText(pick(node, 'videoPreviewImageUrl', 'video_preview_image_url')),
    video: firstText(pick(node, 'videoHdUrl', 'video_hd_url'), pick(node, 'videoSdUrl', 'video_sd_url')),
  };
}

function metaAdId(item) {
  return pick(item, 'adArchiveID', 'adArchiveId', 'ad_archive_id');
}

function normalizeMeta(item, now) {
  const id = metaAdId(item);
  if (!id) return null;
  const snap = item.snapshot || {};
  const cards = Array.isArray(snap.cards) ? snap.cards : [];
  const card = cards[0] || {};
  const image = metaMedia((Array.isArray(snap.images) && snap.images[0]) || {});
  const video = metaMedia((Array.isArray(snap.videos) && snap.videos[0]) || {});
  const cardMedia = metaMedia(card);
  const isActive = pick(item, 'isActive', 'is_active') !== false;
  const format = String(pick(snap, 'displayFormat', 'display_format') || '').toLowerCase() || null;
  const collation = pick(item, 'collationCount', 'collation_count');
  const platforms = pick(item, 'publisherPlatform', 'publisher_platform');
  const body = pick(snap, 'body');

  return {
    external_id: String(id),
    advertiser_name: firstText(pick(item, 'pageName', 'page_name'), pick(snap, 'pageName', 'page_name')),
    format,
    headline: firstText(
      snap.title,
      card.title,
      pick(snap, 'linkDescription', 'link_description'),
      pick(card, 'linkDescription', 'link_description'),
    ),
    body: firstText(body && body.text, typeof body === 'string' ? body : null, card.body),
    cta: firstText(pick(snap, 'ctaText', 'cta_text'), pick(card, 'ctaText', 'cta_text')),
    link_url: firstText(pick(snap, 'linkUrl', 'link_url'), pick(card, 'linkUrl', 'link_url')),
    image_url: firstText(image.image, cardMedia.image, video.preview, cardMedia.preview),
    video_url: firstText(video.video, cardMedia.video),
    library_url: `https://www.facebook.com/ads/library/?id=${id}`,
    publisher_platforms: Array.isArray(platforms) ? platforms : null,
    variations: Number.isInteger(collation) ? collation : null,
    platform_started_at: toIso(pick(item, 'startDateFormatted', 'start_date_formatted', 'startDate', 'start_date')),
    platform_last_shown_at: isActive
      ? now.toISOString()
      : toIso(pick(item, 'endDateFormatted', 'end_date_formatted', 'endDate', 'end_date')),
    is_active: isActive,
    raw: compactRaw({
      page_id: pick(item, 'pageID', 'pageId', 'page_id') || null,
      page_profile_uri: pick(snap, 'pageProfileUri', 'page_profile_uri') || null,
      page_categories: pick(snap, 'pageCategories', 'page_categories') || null,
      page_like_count: pick(snap, 'pageLikeCount', 'page_like_count') || null,
      display_format: pick(snap, 'displayFormat', 'display_format') || null,
      collation_id: pick(item, 'collationId', 'collation_id') || null,
      categories: item.categories || null,
      input: item.input || item.inputUrl || null,
      cards: cards.slice(0, 10).map((c) => ({
        title: cleanText(c.title),
        body: cleanText(c.body),
        cta: cleanText(pick(c, 'ctaText', 'cta_text')),
        link: cleanText(pick(c, 'linkUrl', 'link_url')),
        image: firstText(metaMedia(c).image, metaMedia(c).preview),
      })),
      extra_texts: pick(snap, 'extraTexts', 'extra_texts') || null,
    }),
  };
}

function normalizeLinkedin(item) {
  if (!item.ad_id) return null;
  if (/job/i.test(item.format || '')) return null; // job posts are recruiting, not marketing
  const carousel = Array.isArray(item.carousel_images) ? item.carousel_images : [];
  const images = Array.isArray(item.image_urls) ? item.image_urls : [];
  const videos = Array.isArray(item.video_urls) ? item.video_urls : [];

  return {
    external_id: String(item.ad_id),
    advertiser_name: firstText(item.advertiser, item.promoted_by),
    format: firstText(item.format, item.creative_type),
    headline: firstText(item.headline),
    body: firstText(item.body, item.body_preview),
    cta: firstText(item.cta, Array.isArray(item.message_buttons) ? item.message_buttons[0] : null),
    link_url: null,
    image_url: firstText(images[0], carousel[0] && carousel[0].image_url),
    video_url: firstText(videos[videos.length - 1]),
    library_url: firstText(item.detail_url) || `https://www.linkedin.com/ad-library/detail/${item.ad_id}`,
    publisher_platforms: ['linkedin'],
    variations: carousel.length > 0 ? carousel.length : null,
    platform_started_at: parseLinkedinDate(item.ran_from),
    platform_last_shown_at: parseLinkedinDate(item.ran_to),
    is_active: item.is_active === false ? false : true,
    raw: compactRaw({
      advertiser_url: item.advertiser_url || null,
      payer: item.payer || null,
      promoted_by: item.promoted_by || null,
      creative_type: item.creative_type || null,
      carousel: carousel.slice(0, 10),
      message_sender: item.message_sender || null,
      query: item.query || null,
      has_details: item.has_details === true,
    }),
  };
}

function normalizeGoogle(item, now) {
  if (!item.creativeId) return null;
  const lastShown = toIso(item.lastShown);
  const activeSince = now.getTime() - GOOGLE_ACTIVE_WINDOW_DAYS * DAY_MS;
  const isActive = lastShown ? new Date(lastShown).getTime() >= activeSince : true;
  const lines = Array.isArray(item.adTextLines) ? item.adTextLines.filter((l) => typeof l === 'string') : [];

  return {
    external_id: String(item.creativeId),
    advertiser_name: firstText(item.advertiserName, item.advertiserLegalName),
    format: (item.format || '').toLowerCase() || null,
    headline: firstText(item.adHeadline),
    body: firstText(item.adDescription, lines.length > 0 ? lines.join(' | ') : null),
    cta: null,
    link_url: firstText(item.adDisplayUrl, item.domain),
    image_url: firstText(item.imageUrl),
    video_url: null,
    library_url: firstText(item.adUrl),
    publisher_platforms: Array.isArray(item.platforms) ? item.platforms : null,
    variations: Number.isInteger(item.variationCount) ? item.variationCount : null,
    platform_started_at: toIso(item.firstShown),
    platform_last_shown_at: lastShown,
    is_active: isActive,
    raw: compactRaw({
      advertiserId: item.advertiserId || null,
      advertiserCountry: item.advertiserCountry || null,
      advertiserVerified: item.advertiserVerified ?? null,
      domain: item.domain || null,
      previewUrl: item.previewUrl || null,
      shownForDays: item.shownForDays ?? null,
      adTextKind: item.adTextKind || null,
      googleCustomerId: item.googleCustomerId || null,
      adGroupId: item.adGroupId || null,
    }),
  };
}

const NORMALIZERS = { meta: normalizeMeta, linkedin: normalizeLinkedin, google: normalizeGoogle };

function readApifyResponse(response) {
  const status = Number(response.statusCode) || 0;
  let data = response.body ?? response.data ?? null;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return { status, items: null, error: `Invalid JSON from Apify (HTTP ${status}): ${data.slice(0, 300)}` };
    }
  }
  if (status < 200 || status >= 300) {
    const message = (data && data.error && (data.error.message || data.error.type)) || JSON.stringify(data).slice(0, 300);
    return { status, items: null, error: `Apify HTTP ${status}: ${message}` };
  }
  if (!Array.isArray(data)) {
    return { status, items: null, error: `Apify returned no dataset array (HTTP ${status})` };
  }
  return { status, items: data, error: null };
}

function normalizeJobResult(job, response, now) {
  const base = {
    p_run_id: job.run_id,
    p_platform: job.platform,
    p_competitor_id: job.competitor_id,
    p_source: job.source,
    p_source_query: job.source_query,
  };
  const { items, error } = readApifyResponse(response);
  if (!items) {
    return { ...base, p_ok: false, p_error: error, p_incomplete: true, p_ads: [] };
  }

  const normalize = NORMALIZERS[job.platform];
  const hasAdId = (item) => Boolean(item && (metaAdId(item) || item.ad_id || item.creativeId));
  const adItems = items.filter(hasAdId);
  const errorItems = items.filter((item) => item && item.error && !hasAdId(item));
  const byId = new Map();
  for (const item of adItems) {
    const ad = normalize(item, now);
    if (ad && !byId.has(ad.external_id)) byId.set(ad.external_id, ad);
  }
  const ads = [...byId.values()];

  if (ads.length === 0 && errorItems.length > 0) {
    const message = String(errorItems[0].error.message || errorItems[0].error).slice(0, 500);
    return { ...base, p_ok: false, p_error: `Scraper error: ${message}`, p_incomplete: true, p_ads: [] };
  }

  const limitReached = job.limit > 0 && adItems.length >= job.limit;
  return {
    ...base,
    p_ok: true,
    p_error: errorItems.length > 0 ? `${errorItems.length} item(s) with errors in the dataset` : null,
    p_incomplete: limitReached || errorItems.length > 0,
    p_ads: ads,
  };
}

// @n8n-entry
const job = $('Montar coletas').item.json;
return { json: normalizeJobResult(job, $json, new Date()) };
