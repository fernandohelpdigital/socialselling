-- Example seed. Copy to 002_seed.local.sql (gitignored), put your real competitors there
-- and run it in the Supabase SQL Editor after 001_schema.sql.

insert into public.spy_competitors (name, segment, city, state, domain, facebook_url, linkedin_slug, notes) values
  ('Concorrente Exemplo', 'msp', 'São Paulo', 'SP', 'exemplo.com.br', 'https://www.facebook.com/exemplo', 'exemplo', 'MSP para PMEs'),
  ('Outro Exemplo Cloud', 'cloud_m365', 'Curitiba', 'PR', 'outroexemplo.com.br', null, 'outro-exemplo', 'Parceiro Microsoft')
on conflict ((lower(name))) do nothing;

insert into public.spy_keywords (keyword, active) values
  ('outsourcing de TI', true),
  ('suporte de TI para empresas', true),
  ('serviços gerenciados de TI', true),
  ('NOC 24x7', false)
on conflict (keyword) do nothing;
