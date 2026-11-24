// Aggregates every spy_ingest response into the final spy_runs row.

function readIngestResponse(response) {
  const status = Number(response.statusCode) || 0;
  let body = response.body ?? response.data ?? null;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (status >= 200 && status < 300 && body && typeof body === 'object' && 'ok' in body) {
    return { saved: true, result: body };
  }
  const detail = body && body.message ? body.message : `HTTP ${status}`;
  return { saved: false, error: `Supabase ingest failed: ${detail}` };
}

function summarizeRun(responses, now) {
  const stats = {
    jobs: responses.length,
    jobs_ok: 0,
    jobs_failed: 0,
    ingest_failures: 0,
    ads_seen: 0,
    ads_new: 0,
    ads_updated: 0,
    ads_closed: 0,
    by_platform: {},
    errors: [],
  };

  for (const response of responses) {
    const { saved, result, error } = readIngestResponse(response);
    if (!saved) {
      stats.ingest_failures += 1;
      stats.jobs_failed += 1;
      stats.errors.push(error);
      continue;
    }
    const platform = (stats.by_platform[result.platform] ||= { jobs: 0, failed: 0, ads: 0, new: 0 });
    platform.jobs += 1;
    if (!result.ok) {
      stats.jobs_failed += 1;
      platform.failed += 1;
      stats.errors.push(`${result.platform}: ${result.source_query}`);
      continue;
    }
    stats.jobs_ok += 1;
    stats.ads_seen += result.ads;
    stats.ads_new += result.inserted;
    stats.ads_updated += result.updated;
    stats.ads_closed += result.closed;
    platform.ads += result.ads;
    platform.new += result.inserted;
  }

  stats.errors = stats.errors.slice(0, 30);
  let status = 'success';
  if (stats.jobs_ok === 0) status = 'failed';
  else if (stats.jobs_failed > 0) status = 'partial';

  return { finished_at: now.toISOString(), status, stats };
}

// @n8n-entry
const runId = $('Abrir execução').first().json.id;
const responses = $input.all().map((item) => item.json);
return [{ json: { run_id: runId, patch: summarizeRun(responses, new Date()) } }];
