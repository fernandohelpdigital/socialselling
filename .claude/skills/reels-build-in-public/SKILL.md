---
name: reels-build-in-public
description: Produz Reels e animações 9:16 do projeto Buscando 1 Milhão com huashu-motion (HTML + GSAP renderizado quadro a quadro, com trilha e efeitos). Use quando pedirem vídeo, Reel, animação, teaser, abertura ou qualquer conteúdo em movimento do build in public deste repositório.
---

# Reels do Buscando 1 Milhão

Aprendizado do primeiro Reel (2026-11-22). O método geral de direção está em `.claude/skills/huashu-motion/`. Este arquivo guarda o que vale só para este projeto e os erros que já custaram tempo.

## Onde fica cada coisa

- `video/` é um pacote npm com `huashu-motion@0.6.0` fixado. O comando é `npx om` rodado dentro de `video/`.
- `video/reel/index.html` é o Reel v1 e serve de base para os próximos. Leia `treatment.md` e `materials.md` ao lado dele.
- `video/entregas/` guarda os MP4 finais versionados. `reel/out/`, `reel/.om/` e `reel/assets/sound.wav` são gerados e ficam fora do git.
- Antes de um filme novo, leia `huashu-motion/SKILL.md`, depois `references/director.md` e `references/rhythm.md`.

## Fluxo que funcionou

1. Material real primeiro. O produto ainda é o `PROMPT.md` e o `README.md`, então todo texto na tela sai deles. Registre a origem de cada frase em `materials.md`.
2. Trilha antes dos cortes. `npx om music build` baixa a biblioteca e `npx om beats <arquivo>` mostra compassos, seções e subidas. Monte a folha de ritmo em cima disso.
3. Escreva `treatment.md` (folha de ritmo e cadeia de continuidade) antes do filme completo.
4. Construa, depois rode `npx om sound reel` e `npx om check reel` até zerar erros.
5. Olhe os quadros. `npx om still reel --at 0,1,2.5,...` e uma folha de contato com `ffmpeg -pattern_type glob -i 'index-*.png' -vf "scale=360:640,tile=7x2" -frames:v 1 sheet.png`.
6. Faça as notas que um diretor exigente faria e corrija. Na v1 foram quatro (veja `treatment.md`).
7. `npx om render reel --blur` para a versão final (uns 4 min nesta máquina de 4 núcleos, 40 s sem blur) e `npx om qa reel --sheet`.
8. Copie o MP4 para `video/entregas/` com nome e versão.

## Armadilhas já pagas

- Com `start: 52.24` o mapa de batidas começa em 0,5 s, então `OM.beat(0)` já é a segunda batida. Use `const B = (n) => Math.max(0, OM.beat(n - 1))` para contar batidas a partir do zero.
- Um still aberto direto em t mostra o estado do CSS para tweens que ainda não começaram. Todo elemento que entra depois recebe o estado inicial com `gsap.set` antes da timeline. `tl.set(..., 0)` não resolve o quadro 0.
- `arrange: 'auto'` ignora `start` e usa a abertura da própria faixa. No Forward Drive isso dá 6 s de introdução quase muda e mata o gancho. Para começar forte use corte reto com `start`.
- `stop` (a pausa da música antes da rajada) só funciona no modo `arrange`.
- `marker-end` de SVG aparece antes de a linha ser desenhada. Use uma ponta separada que acende no fim do traço.
- Um container de legenda visível com filhos transparentes conta como texto cobrindo outro para o `om check`. Esconda o container inteiro.
- Em cima de trilha real, no máximo um efeito por corte. A v1 ficou com 19 efeitos em 19 s e a rajada leva um `hit` por regra.
- `om sound` acusa energia plana no Forward Drive porque a faixa inteira varia só 4 dB. Para ter contraste de verdade, teste outra faixa (veja a energia por seção no `om beats`) antes de mexer na imagem.

## Identidade visual

- Fundo #0D1117, painel #1f2937, âmbar #FFB000 (status e espinha do filme), verde #00C853 (meta e aprendizado), rosa #E1306C (Instagram), verde WhatsApp #25D366, roxo #412991 (OpenAI). Todas vêm dos selos e do mermaid do README.
- Inter (800 e 900 nos títulos) e JetBrains Mono para código, chaves e endereços. As duas estão em `video/reel/assets/fonts`.
- O ponto âmbar é a espinha. Ele nasce dos placeholders, percorre o fluxo, marca as regras e vira o "1" de "Buscando 1 Milhão".
- Áreas seguras do Reel em 1080×1920 são 220 px no topo, 520 px embaixo e a borda direita livre para os botões do Instagram.

## Texto na tela

- Só aparece o que está no README, no PROMPT.md ou em `VERIFIED_CLAIMS`. Nunca métrica, depoimento ou resultado inventado. A meta de R$ 1.000.000 aparece como meta.
- Regras de escrita do autor, que valem para legenda, título e post. Nada de antecipação ("e é aqui que o jogo muda"), dois-pontos de revelação ("a lição é direta: use IA"), antítese "não é X, mas Y", parataxe rítmica de frases curtas em série, travessão, ênclise ou mesóclise.

## Licenças dos repositórios do post de referência

| repositório | situação |
|---|---|
| huashu-motion (MIT) | instalado em `.claude/skills/huashu-motion` e como dependência de `video/` |
| músicas do `om music` | uso livre inclusive comercial. Não registrar em Content ID |
| Hallmark (MIT), Taste Skill (MIT), Impeccable (Apache-2.0) | plugins habilitados em `.claude/settings.json`, voltados a páginas web |
| Remotion | licença própria, empresas acima de certo porte pagam. Confira remotion.dev/docs/license antes de usar |
| HyperFrames (Apache-2.0) | não instalado. A CLI manda telemetria de uso e depende de conta HeyGen para parte da mídia |
| onetake | fora. PolyForm Noncommercial |
| anything2explainer | fora. Uso comercial pede autorização do autor |
| Lemo-Opuscar | fora. A skill e os estilos são CC BY-NC |
| ComfyUI, Blender MCP, OpenScreen, EffectCraft, Open Design | ferramentas de desktop ou GPU. Rodam na máquina do autor, não no container |

O filme leva a assinatura "Made with huashu-motion" no último 1,2 s. Ela sai com `data-om-signature="off"` no `<html>`.
