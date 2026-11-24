// Builds one OpenAI request per ad that still has no analysis.

const WRITING_RULES = [
  'Escreva em português do Brasil, direto e concreto.',
  'Não use travessão nem meia-risca. Use vírgula, ponto ou parênteses.',
  'Não use dois-pontos para criar efeito ou suspense.',
  'Não use a construção "não é X, é Y" nem "não X, mas Y".',
  'Não use frases de antecipação do tipo "e é aqui que tudo muda".',
  'Não empilhe frases curtas em sequência rítmica.',
  'Não use ênclise nem mesóclise. Prefira próclise ou reescreva a frase.',
].join('\n');

const PAINS = [
  'cyber_security', 'lgpd_compliance', 'it_cost', 'downtime_productivity', 'lack_of_it_team',
  'cloud_migration', 'microsoft_365', 'backup_recovery', 'helpdesk_support', 'network_infrastructure',
  'growth_scale', 'ai_automation', 'digital_transformation', 'none', 'other',
];
const OFFERS = [
  'free_assessment', 'lead_magnet', 'webinar_event', 'demo', 'quote_contact', 'free_trial',
  'price_promo', 'brand_awareness', 'recruiting', 'other',
];
const PROOFS = [
  'numbers_results', 'client_cases', 'testimonial', 'certifications_partners', 'years_in_market',
  'awards', 'client_logos', 'none',
];

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_relevant', 'summary', 'creative_format', 'visual_style', 'image_text', 'pain', 'angle', 'offer',
    'funnel_stage', 'hook', 'cta', 'destination', 'proof', 'target_audience', 'tone',
    'inspiration_score', 'idea_for_us',
  ],
  properties: {
    is_relevant: {
      type: 'boolean',
      description: 'true quando o anúncio vende serviços de TI ou tecnologia para empresas (B2B). false para vaga de emprego, venda ao consumidor final ou assunto fora do nicho.',
    },
    summary: { type: 'string', description: 'Uma frase dizendo o que o anúncio vende e para quem.' },
    creative_format: {
      type: 'string',
      enum: ['static_image', 'carousel', 'video', 'text_only', 'document', 'message', 'other'],
    },
    visual_style: {
      type: 'string',
      description: 'Descrição curta do visual (ex.: foto de pessoa com texto grande, print de dashboard, ilustração 3D). Use "sem imagem" quando não houver.',
    },
    image_text: { type: ['string', 'null'], description: 'Texto escrito dentro da imagem, quando houver.' },
    pain: { type: 'string', enum: PAINS, description: 'Dor principal que o anúncio ataca.' },
    angle: { type: 'string', description: 'Como o anúncio ataca a dor, em uma frase.' },
    offer: { type: 'string', enum: OFFERS, description: 'O que o anúncio oferece em troca do clique.' },
    funnel_stage: { type: 'string', enum: ['top', 'middle', 'bottom'] },
    hook: { type: 'string', description: 'A primeira frase ou ideia que prende a atenção.' },
    cta: { type: ['string', 'null'], description: 'Chamada para ação, como aparece no anúncio.' },
    destination: {
      type: 'string',
      enum: ['landing_page', 'native_form', 'whatsapp', 'website', 'event_page', 'unknown'],
    },
    proof: { type: 'array', items: { type: 'string', enum: PROOFS } },
    target_audience: { type: 'string', description: 'Quem parece ser o alvo (porte, cargo, setor).' },
    tone: {
      type: 'string',
      enum: ['technical', 'consultative', 'fear_based', 'aspirational', 'humorous', 'institutional'],
    },
    inspiration_score: {
      type: 'integer',
      enum: [1, 2, 3, 4, 5],
      description: '1 a 5. Quanto esse anúncio serve de referência para nós (clareza da oferta, força do gancho, tempo no ar).',
    },
    idea_for_us: {
      type: 'string',
      description: 'Uma ideia prática de anúncio inspirada neste, adaptada à nossa empresa, sem copiar o texto.',
    },
  },
};

function supportsReasoningEffort(model) {
  return /^(gpt-5|o\d)/.test(model);
}

function describeAd(ad) {
  const lines = [
    `Plataforma: ${ad.platform}`,
    `Anunciante: ${ad.competitor_name || ad.advertiser_name || 'desconhecido'}`,
    `Formato informado pela plataforma: ${ad.format || 'desconhecido'}`,
    `Dias no ar até agora: ${ad.days_running ?? 'desconhecido'}`,
    `Variações do anúncio: ${ad.variations ?? 'desconhecido'}`,
    `Título: ${ad.headline || '(sem título)'}`,
    `Texto: ${ad.body || '(sem texto)'}`,
    `CTA: ${ad.cta || '(sem CTA)'}`,
    `Link de destino: ${ad.link_url || '(desconhecido)'}`,
  ];
  if (ad.video_url) lines.push('O anúncio é um vídeo. A imagem anexada, quando existe, é a capa do vídeo.');
  return lines.join('\n');
}

function buildAnalysisRequest(ad, config) {
  const useImage = Boolean(ad.image_url) && (ad.analysis_attempts || 0) === 0;
  const content = [{ type: 'text', text: describeAd(ad) }];
  if (useImage) content.push({ type: 'image_url', image_url: { url: ad.image_url, detail: 'low' } });

  const body = {
    model: config.openai_model_analysis,
    messages: [
      {
        role: 'system',
        content: [
          'Você é analista de mídia paga especializado em empresas de serviços de TI no Brasil (MSPs, outsourcing de TI, cloud, segurança).',
          'Analise o anúncio de um concorrente e classifique cada campo do schema.',
          'Use só o que está no anúncio. Quando faltar informação, escolha "unknown", "other" ou null.',
          'Anúncio com muitos dias no ar provavelmente está dando resultado. Leve isso em conta na nota de inspiração.',
          '',
          'Contexto da nossa empresa, para o campo idea_for_us:',
          config.company_context,
          '',
          'Regras de escrita para os campos de texto:',
          WRITING_RULES,
        ].join('\n'),
      },
      { role: 'user', content },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'ad_analysis', strict: true, schema: ANALYSIS_SCHEMA },
    },
  };
  if (supportsReasoningEffort(config.openai_model_analysis)) body.reasoning_effort = 'low';

  return {
    ad_id: ad.id,
    attempts: ad.analysis_attempts || 0,
    used_image: useImage,
    model: config.openai_model_analysis,
    openai_body: body,
  };
}

function parseJsonList(text) {
  if (Array.isArray(text)) return text;
  if (typeof text !== 'string' || text.trim() === '') return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`Expected a JSON array from Supabase, got: ${text.slice(0, 200)}`);
  return parsed;
}

// @n8n-entry
const config = $('Config').first().json;
const ads = parseJsonList($('Buscar anúncios pendentes').first().json.body);
return ads.map((ad) => ({ json: buildAnalysisRequest(ad, config) }));
