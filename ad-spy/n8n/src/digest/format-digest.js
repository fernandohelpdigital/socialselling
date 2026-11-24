// Extracts the digest text from OpenAI. Falls back to a plain summary if the model fails,
// so the weekly message always goes out.

const MAX_CHARS = 4000;

function fallbackMessage(title, report, error) {
  const totals = report.totals || {};
  const byPlatform = Object.entries(totals.active_by_platform || {})
    .map(([platform, count]) => `${platform} ${count}`)
    .join(', ');
  const lines = [
    `*${title}*`,
    `Anúncios ativos ${totals.active_ads ?? 0} (${byPlatform || 'sem dados'}). Novos ${totals.new_ads ?? 0}. Pausados ${totals.stopped_ads ?? 0}.`,
    '',
    `A IA não conseguiu escrever o resumo desta semana (${error}). Os dados estão salvos no Supabase, na tabela spy_digests.`,
  ];
  return lines.join('\n');
}

function extractDigest(request, response) {
  const status = Number(response.statusCode) || 0;
  let body = response.body ?? response.data ?? null;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const content = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  if (status >= 200 && status < 300 && typeof content === 'string' && content.trim() !== '') {
    const text = content.trim().replace(/\s*[—–]\s*/g, ', ');
    return { message: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text, ai_ok: true };
  }
  const error = body && body.error ? body.error.message || body.error.type : `HTTP ${status}`;
  return { message: fallbackMessage(request.title, request.report, String(error).slice(0, 200)), ai_ok: false };
}

// @n8n-entry
const request = $('Preparar resumo').first().json;
const config = $('Config').first().json;
const { message, ai_ok } = extractDigest(request, $input.first().json);
return [
  {
    json: {
      message,
      ai_ok,
      digest_row: {
        period_start: request.report.period && request.report.period.from,
        period_end: request.report.period && request.report.period.to,
        report: request.report,
        message,
        model: ai_ok ? config.openai_model_digest : null,
      },
    },
  },
];
