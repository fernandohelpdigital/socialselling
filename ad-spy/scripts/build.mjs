// Builds the two n8n workflows from n8n/src/**/*.js and n8n/config-fields.mjs.
// `node scripts/build.mjs` writes the public templates to n8n/workflows/.
// deploy.mjs calls buildWorkflows() with the private values from config.local.json.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { COLLECT_FIELDS, DIGEST_FIELDS, renderConfigCode } from '../n8n/config-fields.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'n8n', 'src');

export const WORKFLOW_NAMES = {
  collect: 'Espião de Anúncios · 1. Coleta semanal',
  digest: 'Espião de Anúncios · 2. Análise e resumo',
};

export const DEFAULT_CREDENTIALS = {
  supabase: { id: '', name: 'Espião · Supabase' },
  apify: { id: '', name: 'Espião · Apify' },
  openai: { id: '', name: 'Espião · OpenAI' },
  uazapi: { id: '', name: 'Espião · uazapi' },
};

const SETTINGS = {
  executionOrder: 'v1',
  timezone: 'America/Sao_Paulo',
  saveDataErrorExecution: 'all',
  saveDataSuccessExecution: 'all',
  saveManualExecutions: true,
};

const CFG = "$('Config').first().json";

function src(path) {
  return readFileSync(join(SRC, path), 'utf8');
}

function node(name, type, typeVersion, position, parameters, extra = {}) {
  return { id: randomUUID(), name, type, typeVersion, position, parameters, ...extra };
}

function code(name, position, file, { perItem = false, ...extra } = {}) {
  const parameters = { jsCode: file ? src(file) : '' };
  if (perItem) parameters.mode = 'runOnceForEachItem';
  return node(name, 'n8n-nodes-base.code', 2, position, parameters, extra);
}

function responseOptions({ format = 'json', full = false, neverError = false } = {}) {
  const response = { responseFormat: format };
  if (full) response.fullResponse = true;
  if (neverError) response.neverError = true;
  if (format === 'text') response.outputPropertyName = 'body';
  return { response: { response } };
}

function http(name, position, opts, extra = {}) {
  const { method = 'GET', url, body, headers = [], auth, timeout = 30000, batch, response } = opts;
  const parameters = { method, url };
  const credentials = {};

  if (auth.kind === 'generic') {
    parameters.authentication = 'genericCredentialType';
    parameters.genericAuthType = auth.type;
    credentials[auth.type] = auth.credential;
  } else {
    parameters.authentication = 'predefinedCredentialType';
    parameters.nodeCredentialType = auth.type;
    credentials[auth.type] = auth.credential;
  }

  if (headers.length > 0) {
    parameters.sendHeaders = true;
    parameters.headerParameters = { parameters: headers.map(([n, v]) => ({ name: n, value: v })) };
  }
  if (body !== undefined) {
    parameters.sendBody = true;
    parameters.specifyBody = 'json';
    parameters.jsonBody = body;
  }
  parameters.options = { timeout, ...responseOptions(response) };
  if (batch) parameters.options.batching = { batch };

  return node(name, 'n8n-nodes-base.httpRequest', 4.4, position, parameters, { credentials, ...extra });
}

function sticky(name, position, content, width, height, color = 7) {
  return node(name, 'n8n-nodes-base.stickyNote', 1, position, { content, width, height, color });
}

function connect(pairs) {
  const connections = {};
  for (const [from, to, outputIndex = 0] of pairs) {
    connections[from] ||= { main: [] };
    const outputs = connections[from].main;
    while (outputs.length <= outputIndex) outputs.push([]);
    outputs[outputIndex].push({ node: to, type: 'main', index: 0 });
  }
  return connections;
}

function auths(credentials) {
  return {
    supabase: { kind: 'generic', type: 'httpCustomAuth', credential: credentials.supabase },
    apify: { kind: 'generic', type: 'httpHeaderAuth', credential: credentials.apify },
    openai: { kind: 'predefined', type: 'openAiApi', credential: credentials.openai },
    uazapi: { kind: 'generic', type: 'httpHeaderAuth', credential: credentials.uazapi },
  };
}

const COLLECT_NOTE = [
  '## Espião de Anúncios · coleta',
  'Toda segunda às 5h busca os anúncios ativos dos concorrentes (tabela spy_competitors) na Meta, no LinkedIn e no Google, e procura anunciantes novos pelas palavras-chave (spy_keywords).',
  '',
  'Cada anúncio é gravado uma vez em spy_ads. Os que sumiram da biblioteca são marcados como pausados.',
  '',
  'Para testar, clique em **Executar workflow**. Uma coleta completa leva de 15 a 40 minutos, conforme o número de concorrentes.',
  '',
  'Concorrentes e palavras-chave se editam direto no Supabase (Table Editor).',
].join('\n');

const DIGEST_NOTE = [
  '## Espião de Anúncios · análise e resumo',
  'Toda segunda às 8h a IA classifica os anúncios novos (formato, dor, oferta, gancho, CTA, funil) e escreve o resumo da semana, que chega no WhatsApp dos números configurados no nó Config.',
  '',
  'Pode rodar a qualquer momento. Só analisa o que ainda não foi analisado, então não gasta duas vezes.',
  '',
  'Antes do primeiro uso, preencha `company_context` e `digest_numbers` no nó Config.',
].join('\n');

function buildCollect(credentials, overrides) {
  const a = auths(credentials);
  const supabaseJson = { auth: a.supabase, response: { format: 'json' } };
  const nodes = [
    sticky('Sobre este workflow', [-60, -340], COLLECT_NOTE, 520, 300),
    node('Toda segunda às 5h', 'n8n-nodes-base.scheduleTrigger', 1.3, [0, 0], {
      rule: { interval: [{ field: 'cronExpression', expression: '0 5 * * 1' }] },
    }),
    node('Executar manualmente', 'n8n-nodes-base.manualTrigger', 1, [0, 180], {}),
    code('Config', [220, 80], null, {}),
    http('Abrir execução', [440, 80], {
      method: 'POST',
      url: `={{ ${CFG}.supabase_url }}/rest/v1/spy_runs`,
      headers: [['Prefer', 'return=representation']],
      body: '={{ JSON.stringify({ status: "running" }) }}',
      ...supabaseJson,
    }),
    http('Buscar concorrentes', [660, 80], {
      url: `={{ ${CFG}.supabase_url }}/rest/v1/spy_competitors?active=eq.true&select=id,name,domain,facebook_url,linkedin_slug&order=name`,
      auth: a.supabase,
      response: { format: 'text' },
    }, { executeOnce: true }),
    http('Buscar palavras-chave', [880, 80], {
      url: `={{ ${CFG}.supabase_url }}/rest/v1/spy_keywords?active=eq.true&select=keyword,platforms&order=keyword`,
      auth: a.supabase,
      response: { format: 'text' },
    }, { executeOnce: true }),
    code('Montar coletas', [1100, 80], 'collect/build-jobs.js'),
    http('Coletar no Apify', [1320, 80], {
      method: 'POST',
      url: '=https://api.apify.com/v2/acts/{{ $json.actor }}/run-sync-get-dataset-items?timeout={{ $json.timeout_secs }}&maxTotalChargeUsd={{ $json.max_charge_usd }}&clean=1',
      body: '={{ JSON.stringify($json.input) }}',
      auth: a.apify,
      timeout: 330000,
      batch: { batchSize: 2, batchInterval: 1000 },
      response: { format: 'text', full: true, neverError: true },
    }),
    code('Normalizar resultados', [1540, 80], 'collect/normalize.js', { perItem: true }),
    http('Gravar no Supabase', [1760, 80], {
      method: 'POST',
      url: `={{ ${CFG}.supabase_url }}/rest/v1/rpc/spy_ingest`,
      body: '={{ JSON.stringify($json) }}',
      auth: a.supabase,
      timeout: 60000,
      response: { format: 'json', full: true, neverError: true },
    }),
    code('Resumir execução', [1980, 80], 'collect/summarize-run.js'),
    http('Fechar execução', [2200, 80], {
      method: 'PATCH',
      url: `={{ ${CFG}.supabase_url }}/rest/v1/spy_runs?id=eq.{{ $json.run_id }}`,
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json.patch) }}',
      ...supabaseJson,
    }),
  ];
  nodes.find((n) => n.name === 'Config').parameters = {
    jsCode: renderConfigCode('Configuração da coleta do Espião de Anúncios.', COLLECT_FIELDS, overrides),
  };

  const connections = connect([
    ['Toda segunda às 5h', 'Config'],
    ['Executar manualmente', 'Config'],
    ['Config', 'Abrir execução'],
    ['Abrir execução', 'Buscar concorrentes'],
    ['Buscar concorrentes', 'Buscar palavras-chave'],
    ['Buscar palavras-chave', 'Montar coletas'],
    ['Montar coletas', 'Coletar no Apify'],
    ['Coletar no Apify', 'Normalizar resultados'],
    ['Normalizar resultados', 'Gravar no Supabase'],
    ['Gravar no Supabase', 'Resumir execução'],
    ['Resumir execução', 'Fechar execução'],
  ]);
  return { name: WORKFLOW_NAMES.collect, nodes, connections, settings: SETTINGS };
}

function buildDigest(credentials, overrides) {
  const a = auths(credentials);
  const nodes = [
    sticky('Sobre este workflow', [-60, -340], DIGEST_NOTE, 520, 300),
    node('Toda segunda às 8h', 'n8n-nodes-base.scheduleTrigger', 1.3, [0, 0], {
      rule: { interval: [{ field: 'cronExpression', expression: '0 8 * * 1' }] },
    }),
    node('Executar manualmente', 'n8n-nodes-base.manualTrigger', 1, [0, 180], {}),
    code('Config', [220, 80], null, {}),
    http('Buscar anúncios pendentes', [440, 80], {
      url:
        `={{ ${CFG}.supabase_url }}/rest/v1/spy_ads_view?select=id,platform,advertiser_name,competitor_name,format,headline,body,cta,link_url,image_url,video_url,variations,days_running,analysis_attempts` +
        `&analyzed_at=is.null&analysis_attempts=lt.3&order=first_seen_at.desc&limit={{ ${CFG}.analysis_limit }}`,
      auth: a.supabase,
      response: { format: 'text' },
    }, { executeOnce: true }),
    code('Preparar análises', [660, 80], 'digest/prepare-analysis.js', { alwaysOutputData: true }),
    node('Tem anúncio para analisar?', 'n8n-nodes-base.if', 2.3, [880, 80], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [
          {
            id: randomUUID(),
            leftValue: '={{ $json.ad_id }}',
            rightValue: '',
            operator: { type: 'number', operation: 'exists', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    }),
    http('Analisar com IA', [1100, 0], {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      body: '={{ JSON.stringify($json.openai_body) }}',
      auth: a.openai,
      timeout: 180000,
      batch: { batchSize: 4, batchInterval: 500 },
      response: { format: 'json', full: true, neverError: true },
    }),
    code('Interpretar análise', [1320, 0], 'digest/parse-analysis.js', { perItem: true }),
    http('Salvar análise', [1540, 0], {
      method: 'PATCH',
      url: `={{ ${CFG}.supabase_url }}/rest/v1/spy_ads?id=eq.{{ $json.ad_id }}`,
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json.patch) }}',
      auth: a.supabase,
      response: { format: 'json', full: true, neverError: true },
    }),
    http('Gerar relatório', [1760, 80], {
      method: 'POST',
      url: `={{ ${CFG}.supabase_url }}/rest/v1/rpc/spy_weekly_report`,
      body: `={{ JSON.stringify({ p_days: ${CFG}.report_days }) }}`,
      auth: a.supabase,
      timeout: 60000,
      response: { format: 'json' },
    }, { executeOnce: true }),
    code('Preparar resumo', [1980, 80], 'digest/prepare-digest.js'),
    http('Escrever resumo', [2200, 80], {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      body: '={{ JSON.stringify($json.openai_body) }}',
      auth: a.openai,
      timeout: 300000,
      response: { format: 'json', full: true, neverError: true },
    }),
    code('Montar mensagem', [2420, 80], 'digest/format-digest.js'),
    http('Salvar resumo', [2640, 80], {
      method: 'POST',
      url: `={{ ${CFG}.supabase_url }}/rest/v1/spy_digests`,
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json.digest_row) }}',
      auth: a.supabase,
      response: { format: 'json', full: true, neverError: true },
    }),
    code('Separar destinatários', [2860, 80], 'digest/split-recipients.js'),
    http('Enviar no WhatsApp', [3080, 80], {
      method: 'POST',
      url: `={{ ${CFG}.uazapi_url }}/send/text`,
      body: '={{ JSON.stringify({ number: $json.number, text: $json.text }) }}',
      auth: a.uazapi,
      timeout: 30000,
      response: { format: 'json' },
    }),
  ];
  nodes.find((n) => n.name === 'Config').parameters = {
    jsCode: renderConfigCode('Configuração da análise e do resumo do Espião de Anúncios.', DIGEST_FIELDS, overrides),
  };

  const connections = connect([
    ['Toda segunda às 8h', 'Config'],
    ['Executar manualmente', 'Config'],
    ['Config', 'Buscar anúncios pendentes'],
    ['Buscar anúncios pendentes', 'Preparar análises'],
    ['Preparar análises', 'Tem anúncio para analisar?'],
    ['Tem anúncio para analisar?', 'Analisar com IA', 0],
    ['Tem anúncio para analisar?', 'Gerar relatório', 1],
    ['Analisar com IA', 'Interpretar análise'],
    ['Interpretar análise', 'Salvar análise'],
    ['Salvar análise', 'Gerar relatório'],
    ['Gerar relatório', 'Preparar resumo'],
    ['Preparar resumo', 'Escrever resumo'],
    ['Escrever resumo', 'Montar mensagem'],
    ['Montar mensagem', 'Salvar resumo'],
    ['Salvar resumo', 'Separar destinatários'],
    ['Separar destinatários', 'Enviar no WhatsApp'],
  ]);
  return { name: WORKFLOW_NAMES.digest, nodes, connections, settings: SETTINGS };
}

export function buildWorkflows({ credentials = DEFAULT_CREDENTIALS, collect = {}, digest = {} } = {}) {
  return {
    collect: buildCollect(credentials, collect),
    digest: buildDigest(credentials, digest),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = join(ROOT, 'n8n', 'workflows');
  mkdirSync(out, { recursive: true });
  const workflows = buildWorkflows();
  writeFileSync(join(out, 'collect.json'), `${JSON.stringify(workflows.collect, null, 2)}\n`);
  writeFileSync(join(out, 'digest.json'), `${JSON.stringify(workflows.digest, null, 2)}\n`);
  console.log(`Wrote ${out}/collect.json and ${out}/digest.json`);
}
