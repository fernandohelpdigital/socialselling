import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadNodeCode, runNodeCode } from './load-node-code.mjs';

const { buildAnalysisRequest, ANALYSIS_SCHEMA } = loadNodeCode('digest/prepare-analysis.js', [
  'buildAnalysisRequest',
  'ANALYSIS_SCHEMA',
]);
const { buildAnalysisPatch } = loadNodeCode('digest/parse-analysis.js', ['buildAnalysisPatch']);
const { buildDigestRequest } = loadNodeCode('digest/prepare-digest.js', ['buildDigestRequest']);
const { extractDigest } = loadNodeCode('digest/format-digest.js', ['extractDigest']);
const { buildRecipients } = loadNodeCode('digest/split-recipients.js', ['buildRecipients']);

const NOW = new Date('2026-11-23T11:00:00Z');
const CONFIG = {
  openai_model_analysis: 'gpt-5-mini',
  openai_model_digest: 'gpt-5',
  company_context: 'Empresa: Teste TI',
  digest_numbers: ['55 (11) 99999-0000', '123'],
};
const AD = {
  id: 42,
  platform: 'meta',
  advertiser_name: 'Alfa TI',
  competitor_name: 'Alfa TI',
  format: 'image',
  headline: 'Sua TI parou de novo?',
  body: 'Diagnóstico gratuito da sua infraestrutura.',
  cta: 'Saiba mais',
  link_url: 'https://alfati.com.br/diagnostico',
  image_url: 'https://scontent.xx.fbcdn.net/img.jpg',
  video_url: null,
  days_running: 45,
  variations: 3,
  analysis_attempts: 0,
};

const ANALYSIS = {
  is_relevant: true,
  summary: 'Oferece diagnóstico gratuito de TI para PMEs.',
  creative_format: 'static_image',
  visual_style: 'foto de servidor com texto grande',
  image_text: 'Sua TI parou?',
  pain: 'downtime_productivity',
  angle: 'Mostra o custo da parada.',
  offer: 'free_assessment',
  funnel_stage: 'middle',
  hook: 'Sua TI parou de novo?',
  cta: 'Saiba mais',
  destination: 'landing_page',
  proof: ['none'],
  target_audience: 'Donos de PMEs',
  tone: 'consultative',
  inspiration_score: 4,
  idea_for_us: 'Testar um diagnóstico de 15 minutos com gancho sobre parada.',
};

function checkStrictSchema(schema, path = 'root') {
  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) {
    assert.equal(schema.additionalProperties, false, `${path} must set additionalProperties false`);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path} must require every property`);
    for (const [key, value] of Object.entries(schema.properties)) checkStrictSchema(value, `${path}.${key}`);
  }
  if (schema.items) checkStrictSchema(schema.items, `${path}[]`);
}

test('analysis schema follows OpenAI strict structured output rules', () => {
  checkStrictSchema(ANALYSIS_SCHEMA);
});

test('analysis request sends the image on the first attempt only', () => {
  const first = buildAnalysisRequest(AD, CONFIG);
  assert.equal(first.ad_id, 42);
  assert.equal(first.used_image, true);
  assert.equal(first.openai_body.reasoning_effort, 'low');
  assert.equal(first.openai_body.response_format.json_schema.strict, true);
  const content = first.openai_body.messages[1].content;
  assert.equal(content[1].image_url.url, AD.image_url);
  assert.match(content[0].text, /Dias no ar até agora: 45/);
  assert.match(first.openai_body.messages[0].content, /Empresa: Teste TI/);

  const retry = buildAnalysisRequest({ ...AD, analysis_attempts: 1 }, CONFIG);
  assert.equal(retry.used_image, false);
  assert.equal(retry.openai_body.messages[1].content.length, 1);

  const otherModel = buildAnalysisRequest(AD, { ...CONFIG, openai_model_analysis: 'gpt-4.1-mini' });
  assert.equal(otherModel.openai_body.reasoning_effort, undefined);
});

test('analysis patch on success and on failure', () => {
  const request = { ad_id: 42, attempts: 0, used_image: true, model: 'gpt-5-mini' };
  const success = buildAnalysisPatch(
    request,
    {
      statusCode: 200,
      body: { choices: [{ message: { content: JSON.stringify(ANALYSIS) } }], usage: { total_tokens: 900 } },
    },
    NOW,
  );
  assert.equal(success.ad_id, 42);
  assert.equal(success.patch.analysis.pain, 'downtime_productivity');
  assert.equal(success.patch.analysis.tokens, 900);
  assert.equal(success.patch.analyzed_at, NOW.toISOString());
  assert.equal(success.patch.analysis_error, null);

  const imageError = buildAnalysisPatch(
    request,
    { statusCode: 400, body: { error: { message: 'Error while downloading https://scontent...' } } },
    NOW,
  );
  assert.equal(imageError.patch.analysis_attempts, 1);
  assert.match(imageError.patch.analysis_error, /downloading/);
  assert.equal(imageError.patch.analyzed_at, undefined);

  const refusal = buildAnalysisPatch(request, { statusCode: 200, body: { choices: [{ message: { refusal: 'no' } }] } }, NOW);
  assert.match(refusal.patch.analysis_error, /refused/);
});

const REPORT = {
  period: { from: '2026-11-16T11:00:00Z', to: '2026-11-23T11:00:00Z', days: 7 },
  totals: { active_ads: 12, new_ads: 4, stopped_ads: 1, active_by_platform: { meta: 8, linkedin: 4 } },
  new_ads: [],
};

test('digest request carries the report, the context and the writing rules', () => {
  const request = buildDigestRequest(REPORT, CONFIG);
  assert.equal(request.title, 'Espião de anúncios · 16/11 a 23/11');
  const [system, user] = request.openai_body.messages;
  assert.match(system.content, /Não use travessão/);
  assert.match(system.content, /3\.500 caracteres/);
  assert.match(user.content, /Empresa: Teste TI/);
  assert.match(user.content, /"active_ads":12/);
  assert.equal(request.openai_body.reasoning_effort, 'medium');
  assert.doesNotMatch(system.content, /[—–]/, 'the prompt itself must not use dashes');
});

test('digest text is cleaned, and a fallback message goes out when OpenAI fails', () => {
  const request = buildDigestRequest(REPORT, CONFIG);
  const good = extractDigest(request, {
    statusCode: 200,
    body: { choices: [{ message: { content: '*Resumo*\nOmega — foco em segurança' } }] },
  });
  assert.equal(good.ai_ok, true);
  assert.equal(good.message, '*Resumo*\nOmega, foco em segurança');

  const bad = extractDigest(request, { statusCode: 429, body: { error: { message: 'Rate limit' } } });
  assert.equal(bad.ai_ok, false);
  assert.match(bad.message, /Anúncios ativos 12 \(meta 8, linkedin 4\)/);
  assert.match(bad.message, /Rate limit/);
});

test('recipients keep only valid numbers', () => {
  assert.deepEqual(buildRecipients(CONFIG.digest_numbers, 'oi'), [{ number: '5511999990000', text: 'oi' }]);
  assert.deepEqual(buildRecipients(undefined, 'oi'), []);
});

test('digest Code nodes run end to end with fake n8n globals', () => {
  const prepared = runNodeCode('digest/prepare-analysis.js', {
    nodes: { Config: [CONFIG], 'Buscar anúncios pendentes': [{ body: JSON.stringify([AD]) }] },
  });
  assert.equal(prepared.length, 1);
  const none = runNodeCode('digest/prepare-analysis.js', {
    nodes: { Config: [CONFIG], 'Buscar anúncios pendentes': [{ body: '[]' }] },
  });
  assert.deepEqual(none, []);

  const parsed = runNodeCode('digest/parse-analysis.js', {
    nodes: { 'Preparar análises': [prepared[0].json] },
    json: { statusCode: 200, body: { choices: [{ message: { content: JSON.stringify(ANALYSIS) } }] } },
  });
  assert.equal(parsed.json.ad_id, 42);

  const digestRequest = runNodeCode('digest/prepare-digest.js', { nodes: { Config: [CONFIG] }, input: [REPORT] });
  const message = runNodeCode('digest/format-digest.js', {
    nodes: { 'Preparar resumo': [digestRequest[0].json], Config: [CONFIG] },
    input: [{ statusCode: 200, body: { choices: [{ message: { content: 'Resumo ok' } }] } }],
  });
  assert.equal(message[0].json.digest_row.message, 'Resumo ok');
  assert.equal(message[0].json.digest_row.model, 'gpt-5');

  const recipients = runNodeCode('digest/split-recipients.js', {
    nodes: { Config: [CONFIG], 'Montar mensagem': [message[0].json] },
  });
  assert.deepEqual(recipients, [{ json: { number: '5511999990000', text: 'Resumo ok' } }]);
});
