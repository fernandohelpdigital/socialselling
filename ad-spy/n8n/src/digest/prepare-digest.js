// Builds the OpenAI request that writes the weekly WhatsApp digest.

const WRITING_RULES = [
  'Não use travessão nem meia-risca. Use vírgula, ponto ou parênteses.',
  'Não use dois-pontos. Para rótulos, quebre a linha.',
  'Não use a construção "não é X, é Y" nem "não X, mas Y".',
  'Não use frases de antecipação do tipo "e é aqui que tudo muda".',
  'Não empilhe frases curtas em sequência rítmica.',
  'Não use ênclise nem mesóclise. Prefira próclise ou reescreva a frase.',
].join('\n');

const LABELS = [
  'Rótulos usados nos dados (traduza ao escrever):',
  'pain: cyber_security=segurança/ataques, lgpd_compliance=LGPD, it_cost=custo de TI, downtime_productivity=parada e produtividade, lack_of_it_team=falta de equipe de TI, cloud_migration=migração para nuvem, microsoft_365=Microsoft 365, backup_recovery=backup, helpdesk_support=suporte/helpdesk, network_infrastructure=rede e infraestrutura, growth_scale=crescimento, ai_automation=IA e automação, digital_transformation=transformação digital',
  'offer: free_assessment=diagnóstico gratuito, lead_magnet=material rico, webinar_event=webinar/evento, demo=demonstração, quote_contact=orçamento/contato, free_trial=teste grátis, price_promo=preço/promoção, brand_awareness=marca, recruiting=vagas',
  'funnel_stage: top=topo, middle=meio, bottom=fundo',
].join('\n');

function formatDate(iso) {
  const date = new Date(iso);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function supportsReasoningEffort(model) {
  return /^(gpt-5|o\d)/.test(model);
}

function buildDigestRequest(report, config) {
  const period = report.period || {};
  const title = `Espião de anúncios · ${formatDate(period.from)} a ${formatDate(period.to)}`;
  const instructions = [
    'Você escreve o resumo semanal de inteligência de anúncios de concorrentes para o dono de uma empresa de serviços de TI.',
    'O resumo vai pelo WhatsApp. Use *negrito* do WhatsApp, listas com "•" e linhas em branco entre seções. Nada de títulos markdown, tabelas ou links encurtados.',
    'Máximo de 3.500 caracteres.',
    '',
    'Estrutura, nesta ordem, pulando a seção que não tiver dados:',
    `1. Primeira linha *${title}*. Na linha seguinte, os números da semana (anúncios ativos, novos, pausados e a divisão por plataforma).`,
    '2. *Movimentos dos concorrentes*. Até 6 concorrentes com o que mudou na semana.',
    '3. *Anúncios que estão durando*. Até 4 anúncios ativos há mais tempo, que provavelmente dão resultado. Para cada um, a dor, a oferta, o gancho e o link da biblioteca.',
    '4. *Padrões*. As dores, ofertas e formatos que mais aparecem nos anúncios ativos.',
    '5. *Ideias para nós*. De 3 a 5 ideias concretas de anúncio (formato, gancho, oferta e CTA) adaptadas ao contexto da nossa empresa. Inspire-se nos padrões e nos anúncios que duram, sem copiar texto de concorrente.',
    '6. *Anunciantes novos no radar*. Até 5 anunciantes achados pelas palavras-chave que ainda não monitoramos.',
    '7. Se collection_health tiver falhas, uma linha final avisando quais coletas falharam.',
    '',
    'Se houver poucos dados (por exemplo, na primeira semana), diga isso em uma frase e trabalhe com o que existe. Nunca invente número, anúncio ou concorrente que não esteja nos dados.',
    '',
    'Regras de escrita:',
    WRITING_RULES,
    '',
    LABELS,
  ].join('\n');

  const body = {
    model: config.openai_model_digest,
    messages: [
      { role: 'system', content: instructions },
      {
        role: 'user',
        content: [
          'Contexto da nossa empresa:',
          config.company_context,
          '',
          'Dados da semana (JSON):',
          JSON.stringify(report),
        ].join('\n'),
      },
    ],
  };
  if (supportsReasoningEffort(config.openai_model_digest)) body.reasoning_effort = 'medium';
  return { title, report, openai_body: body };
}

// @n8n-entry
const config = $('Config').first().json;
let report = $input.first().json;
if (typeof report.body === 'string') report = JSON.parse(report.body);
return [{ json: buildDigestRequest(report, config) }];
