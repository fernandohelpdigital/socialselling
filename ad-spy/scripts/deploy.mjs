// Publishes the two workflows to an n8n instance through its public API.
//
//   N8N_API_KEY=... node scripts/deploy.mjs [--config config.local.json] [--create-credentials]
//
// - Reads private values (URLs, numbers, company context) from config.local.json (gitignored).
// - Finds credentials by name. With --create-credentials, creates the missing ones with
//   placeholder secrets, locked to their API domain, for you to paste the real keys in n8n.
// - Creates or updates the workflows by name. It never activates them.

import { readFileSync } from 'node:fs';
import { buildWorkflows, WORKFLOW_NAMES, DEFAULT_CREDENTIALS } from './build.mjs';

const args = process.argv.slice(2);
const configPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : new URL('../config.local.json', import.meta.url);
const local = JSON.parse(readFileSync(configPath, 'utf8'));
const baseUrl = (process.env.N8N_URL || local.n8n_url || '').replace(/\/+$/, '');
if (!baseUrl) throw new Error('Set n8n_url in config.local.json or N8N_URL in the environment.');

async function api(method, path, body) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (process.env.N8N_API_KEY) headers['X-N8N-API-KEY'] = process.env.N8N_API_KEY;
  const res = await fetch(`${baseUrl}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function listAll(path) {
  const items = [];
  let cursor;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const page = await api('GET', `${path}${sep}limit=250${cursor ? `&cursor=${cursor}` : ''}`);
    items.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

function hostOf(url) {
  return new URL(url).host;
}

function placeholderCredential(key, name) {
  const supabaseHost = hostOf(local.collect.supabase_url);
  const specs = {
    supabase: {
      type: 'httpCustomAuth',
      data: {
        json: JSON.stringify({ headers: { apikey: 'COLE_AQUI_A_SECRET_KEY_DO_SUPABASE' } }, null, 2),
        allowedHttpRequestDomains: 'domains',
        allowedDomains: supabaseHost,
      },
    },
    apify: {
      type: 'httpHeaderAuth',
      data: {
        name: 'Authorization',
        value: 'Bearer COLE_AQUI_O_TOKEN_DO_APIFY',
        allowedHttpRequestDomains: 'domains',
        allowedDomains: 'api.apify.com',
      },
    },
    openai: {
      type: 'openAiApi',
      data: {
        apiKey: 'COLE_AQUI_A_CHAVE_DA_OPENAI',
        header: false,
        allowedHttpRequestDomains: 'domains',
        allowedDomains: 'api.openai.com',
      },
    },
  };
  return specs[key] ? { name, ...specs[key] } : null;
}

async function resolveCredentials() {
  const existing = await listAll('/credentials');
  const names = { ...Object.fromEntries(Object.entries(DEFAULT_CREDENTIALS).map(([k, v]) => [k, v.name])), ...(local.credentials || {}) };
  const resolved = {};
  for (const [key, name] of Object.entries(names)) {
    let found = existing.find((c) => c.name === name);
    if (!found && args.includes('--create-credentials')) {
      const spec = placeholderCredential(key, name);
      if (spec) {
        found = await api('POST', '/credentials', spec);
        console.log(`Created credential "${name}" (${spec.type}) with a placeholder secret.`);
      }
    }
    if (!found) throw new Error(`Credential "${name}" not found in n8n. Create it or run with --create-credentials.`);
    resolved[key] = { id: found.id, name: found.name };
  }
  return resolved;
}

async function upsertWorkflow(workflow) {
  const all = await listAll('/workflows');
  const current = all.find((w) => w.name === workflow.name);
  if (current) {
    await api('PUT', `/workflows/${current.id}`, workflow);
    return { id: current.id, action: 'updated', active: current.active };
  }
  const created = await api('POST', '/workflows', workflow);
  return { id: created.id, action: 'created', active: false };
}

const credentials = await resolveCredentials();
const workflows = buildWorkflows({ credentials, collect: local.collect || {}, digest: local.digest || {} });
for (const key of ['collect', 'digest']) {
  const result = await upsertWorkflow(workflows[key]);
  console.log(`${result.action}: ${WORKFLOW_NAMES[key]} -> ${baseUrl}/workflow/${result.id} (active: ${result.active})`);
}
