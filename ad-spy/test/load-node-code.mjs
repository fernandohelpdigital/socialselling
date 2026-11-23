// Loads the pure functions of an n8n Code node file (everything above `// @n8n-entry`).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = join(ROOT, 'n8n', 'src');
export const FIXTURES = join(ROOT, 'test', 'fixtures');

export function loadNodeCode(file, names) {
  const source = readFileSync(join(SRC, file), 'utf8');
  const [lib] = source.split('// @n8n-entry');
  // eslint-disable-next-line no-new-func
  return new Function(`${lib}\nreturn { ${names.join(', ')} };`)();
}

export function fixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

// Runs a whole Code node with fake n8n globals, to catch errors in the entry section.
export function runNodeCode(file, { nodes = {}, input = [], json } = {}) {
  const source = readFileSync(join(SRC, file), 'utf8');
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`Unknown node referenced: ${name}`);
    const items = nodes[name].map((j) => ({ json: j }));
    return { first: () => items[0], all: () => items, item: items[0] };
  };
  const $input = { all: () => input.map((j) => ({ json: j })), first: () => ({ json: input[0] }) };
  // eslint-disable-next-line no-new-func
  const fn = new Function('$', '$input', '$json', `return (() => {\n${source}\n})();`);
  return fn($, $input, json);
}
