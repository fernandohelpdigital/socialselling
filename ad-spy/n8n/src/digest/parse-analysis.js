// Reads the OpenAI answer for one ad and builds the PATCH for spy_ads.

function readOpenAiResponse(response) {
  const status = Number(response.statusCode) || 0;
  let body = response.body ?? response.data ?? null;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { ok: false, error: `Invalid JSON from OpenAI (HTTP ${status})` };
    }
  }
  if (status < 200 || status >= 300) {
    const message = body && body.error ? body.error.message || body.error.type : `HTTP ${status}`;
    return { ok: false, error: `OpenAI HTTP ${status}: ${String(message).slice(0, 400)}` };
  }
  const message = body && body.choices && body.choices[0] && body.choices[0].message;
  if (!message) return { ok: false, error: 'OpenAI returned no message' };
  if (message.refusal) return { ok: false, error: `OpenAI refused: ${String(message.refusal).slice(0, 300)}` };
  try {
    return { ok: true, analysis: JSON.parse(message.content), usage: body.usage || null };
  } catch {
    return { ok: false, error: 'OpenAI content is not valid JSON' };
  }
}

function buildAnalysisPatch(request, response, now) {
  const result = readOpenAiResponse(response);
  if (!result.ok) {
    return {
      ad_id: request.ad_id,
      patch: { analysis_attempts: request.attempts + 1, analysis_error: result.error },
    };
  }
  return {
    ad_id: request.ad_id,
    patch: {
      analysis: {
        ...result.analysis,
        model: request.model,
        used_image: request.used_image,
        tokens: result.usage ? result.usage.total_tokens : null,
      },
      analyzed_at: now.toISOString(),
      analysis_attempts: request.attempts + 1,
      analysis_error: null,
    },
  };
}

// @n8n-entry
const request = $('Preparar análises').item.json;
return { json: buildAnalysisPatch(request, $json, new Date()) };
