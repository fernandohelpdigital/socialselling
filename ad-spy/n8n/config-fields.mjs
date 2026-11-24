// Fields of the "Config" node of each workflow. The build renders them as editable
// JavaScript inside n8n, with the Portuguese comment above each value.
// Real values (URLs, numbers, company context) come from config.local.json, which is gitignored.

export const COLLECT_FIELDS = [
  { key: 'supabase_url', comment: 'Projeto do Supabase onde você rodou o 001_schema.sql', value: 'https://SEU-PROJETO.supabase.co' },
  { key: 'country', comment: 'País dos anúncios (Meta por palavra-chave, LinkedIn e Google)', value: 'BR' },
  { key: 'lookback_days', comment: 'Janela de busca em dias no LinkedIn e no Google (a Meta traz só os ativos)', value: 14 },
  { key: 'meta_results_limit', comment: 'Máximo de anúncios por concorrente na Meta', value: 30 },
  { key: 'linkedin_results_limit', comment: 'Máximo de anúncios por concorrente no LinkedIn', value: 30 },
  { key: 'google_results_limit', comment: 'Máximo de anúncios por concorrente no Google', value: 20 },
  { key: 'keyword_results_limit', comment: 'Máximo de anúncios por palavra-chave (descoberta de anunciantes novos)', value: 30 },
  { key: 'linkedin_include_details', comment: 'LinkedIn com detalhes traz o texto completo e o CTA (custa o dobro por anúncio)', value: true },
  { key: 'max_charge_usd_per_job', comment: 'Teto de gasto no Apify por coleta individual, em dólar', value: 0.5 },
  { key: 'apify_timeout_secs', comment: 'Tempo máximo de cada coleta no Apify, em segundos (o limite do Apify é 300)', value: 280 },
  {
    key: 'actors',
    comment: 'Coletores do Apify usados em cada plataforma',
    value: {
      meta: 'jmlp~meta-ad-library-scraper', // alternativa oficial e mais cara: 'apify~facebook-ads-scraper'
      linkedin: 'alexmorain~linkedin-ad-library-scraper',
      google: 'scrapesage~google-ads-transparency-scraper',
    },
  },
];

export const DIGEST_FIELDS = [
  { key: 'supabase_url', comment: 'Projeto do Supabase onde você rodou o 001_schema.sql', value: 'https://SEU-PROJETO.supabase.co' },
  { key: 'openai_model_analysis', comment: 'Modelo da OpenAI que classifica cada anúncio (mais barato)', value: 'gpt-5-mini' },
  { key: 'openai_model_digest', comment: 'Modelo da OpenAI que escreve o resumo da semana', value: 'gpt-5' },
  { key: 'analysis_limit', comment: 'Máximo de anúncios novos analisados por execução (controle de custo)', value: 150 },
  { key: 'report_days', comment: 'Período coberto pelo resumo, em dias', value: 7 },
  { key: 'uazapi_url', comment: 'Instância da uazapi que envia o resumo no WhatsApp', value: 'https://SUA-INSTANCIA.uazapi.com' },
  { key: 'digest_numbers', comment: "Números que recebem o resumo, com DDI e DDD. Exemplo ['5511999999999']", value: [] },
  {
    key: 'company_context',
    comment: 'Quem somos. A IA usa isso para adaptar as ideias. Quanto mais específico, melhor.',
    value: [
      'Empresa: [NOME DA EMPRESA]',
      'O que vendemos: [ex.: serviços gerenciados de TI, outsourcing de TI, suporte e infraestrutura]',
      'Para quem: [ex.: empresas de 20 a 300 funcionários, setores, região]',
      'Diferenciais: [PREENCHER]',
      'Ticket e modelo de contrato: [PREENCHER]',
      'Canais de aquisição hoje: [ex.: Instagram, LinkedIn, indicação]',
    ].join('\n'),
  },
];

function renderValue(value) {
  if (typeof value === 'string' && value.includes('\n')) {
    return `\`\n${value.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\n\`.trim()`;
  }
  return JSON.stringify(value, null, 2).replace(/\n/g, '\n  ');
}

export function renderConfigCode(title, fields, overrides = {}) {
  const lines = [
    `// ${title}`,
    '// Edite só os valores abaixo. As chaves ficam nas credenciais do n8n, nunca aqui.',
    'const config = {',
  ];
  for (const field of fields) {
    const value = Object.hasOwn(overrides, field.key) ? overrides[field.key] : field.value;
    lines.push(`  // ${field.comment}`);
    lines.push(`  ${field.key}: ${renderValue(value)},`);
    lines.push('');
  }
  lines.pop();
  lines.push('};', '', 'return [{ json: config }];', '');
  return lines.join('\n');
}
