# Tratamento · Reel "Buscando 1 Milhão" v1

**Formato.** Reel 9:16 (1080×1920, 30 fps), 19,4 s, música sem narração, legível com o som desligado.

**O que o filme deixa.** Um único prompt monta um agente que prospecta no Instagram sozinho, e o prompt inteiro está aberto no GitHub.

**Personalidade.** Técnico, enérgico, novo e acessível. A referência é um changelog de ferramenta de desenvolvedor com uma rajada de cortes no meio.

**Rota.** Híbrida. Uma espinha contínua (o ponto âmbar) aberta por uma rajada de regras na subida da música.

**Trilha.** Forward Drive (biblioteca do huashu-motion, 120 bpm, confiança 0,66), corte reto a partir de 52,24 s. O trecho tem parte principal em 0 a 2 s, breakdown em 2 a 8 s, subida em 8 s e parte principal até o fim, com fade de 18,0 a 19,4 s.

## Folha de ritmo

| trecho | tempo | energia | o que acontece | som |
|---|---|---|---|---|
| gancho | 0 a 2 s | 7 | close no `{{SEU_NOME}}` do PROMPT.md, recuo forte, o título entra uma linha por batida | whoosh no recuo |
| reunir | 1,9 a 2,5 s | 6 | os placeholders acendem e voam até virar o ponto âmbar | whoosh, pop |
| fluxo | 2,5 a 6,3 s | 4 a 5 | o ponto desce pelos 8 nós do fluxo do README, um por batida, com punch-in em 1ª DM e WhatsApp | tick em 1ª DM e WhatsApp |
| ciclo | 6,3 a 8 s | 5 | a câmera recua, a linha verde volta de Métricas para Descoberta, entra "e aprende com o que converteu" | draw, ding, reverse até 8 s |
| rajada | 8 a 12 s | 8 a 9 | seis regras do README, uma por batida e acelerando (2 · 1,5 · 1,5 · 1 · 1 · 1 batidas) | whip, hit em cada corte |
| marca | 12 s | 9 | o ponto vira o "1" de "Buscando 1 Milhão" | impact, subdrop |
| selos | 13 a 14 s | 6 | status em construção, meta R$ 1.000.000, build in public | pop |
| chamada | 15 a 19,4 s | 4 | "O prompt inteiro está aberto no GitHub", o endereço digitado e sublinhado | chime |

## Cadeia de continuidade

placeholders âmbar → ponto âmbar → ponto percorre o fluxo → chicote para cima → ponto vira marcador das regras → ponto vira o "1" da marca.

## Notas de diretor aplicadas na v1

1. O quadro 0 mostrava o painel inteiro sem o close. Os estados iniciais foram para `gsap.set` antes da timeline.
2. O fluxo repetia o mesmo plano oito vezes. Entrou punch-in de 1,2× em 1ª DM e WhatsApp.
3. A rajada tinha pouco movimento por segundo. Cada regra agora entra batendo da direita com escala 1,22.
4. O cartão final ficava parado por 4 s. Entrou um empurrão de câmera de 8% e um sublinhado que fecha o endereço.

## O que ficou em aberto

`om sound` acusa energia plana (todos os trechos dentro de 3 dB) porque o Forward Drive varia pouco. A pausa antes da rajada (`stop`) só existe no modo `arrange`, e esse modo troca o começo forte pela introdução silenciosa da faixa. Fica para uma v2 testar outra faixa ou outro trecho.
