import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflows } from '../scripts/build.mjs';
import { COLLECT_FIELDS, DIGEST_FIELDS, renderConfigCode } from '../n8n/config-fields.mjs';

const workflows = buildWorkflows();

test('config code renders defaults and overrides as runnable JavaScript', () => {
  const code = renderConfigCode('t', DIGEST_FIELDS, {
    supabase_url: 'https://abc.supabase.co',
    company_context: 'Linha 1\nLinha com `crase` e ${x}',
    digest_numbers: ['5511999990000'],
  });
  // eslint-disable-next-line no-new-func
  const [{ json }] = new Function(code)();
  assert.equal(json.supabase_url, 'https://abc.supabase.co');
  assert.equal(json.company_context, 'Linha 1\nLinha com `crase` e ${x}');
  assert.deepEqual(json.digest_numbers, ['5511999990000']);
  assert.equal(json.report_days, 7);

  const collect = new Function(renderConfigCode('t', COLLECT_FIELDS))()[0].json; // eslint-disable-line no-new-func
  assert.equal(collect.actors.meta, 'jmlp~meta-ad-library-scraper');
});

for (const [key, workflow] of Object.entries(workflows)) {
  test(`${key}: connections and node references point to existing nodes`, () => {
    const names = new Set(workflow.nodes.map((n) => n.name));
    assert.equal(names.size, workflow.nodes.length, 'node names are unique');
    for (const [from, { main }] of Object.entries(workflow.connections)) {
      assert.ok(names.has(from), `connection source ${from}`);
      for (const output of main) for (const c of output) assert.ok(names.has(c.node), `connection target ${c.node}`);
    }
    const text = JSON.stringify(workflow.nodes);
    for (const match of text.matchAll(/\$\('([^']+)'\)/g)) assert.ok(names.has(match[1]), `referenced node ${match[1]}`);
  });

  test(`${key}: every Code node is valid JavaScript`, () => {
    for (const node of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
      assert.doesNotThrow(() => new Function('$', '$input', '$json', node.parameters.jsCode), node.name); // eslint-disable-line no-new-func
    }
  });

  test(`${key}: every HTTP node has a credential and no secret in parameters`, () => {
    for (const node of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest')) {
      assert.equal(Object.keys(node.credentials).length, 1, node.name);
      assert.doesNotMatch(JSON.stringify(node.parameters), /apify_api_|sk-|sb_secret_|eyJhbGci/, node.name);
    }
  });

  test(`${key}: public template only carries placeholder URLs`, () => {
    const text = JSON.stringify(workflow);
    for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = match[1].toLowerCase();
      const allowed =
        host === 'seu-projeto.supabase.co' ||
        host === 'sua-instancia.uazapi.com' ||
        /(^|\.)(apify\.com|openai\.com|facebook\.com|linkedin\.com)$/.test(host);
      assert.ok(allowed, `unexpected host in public template: ${host}`);
    }
  });
}
