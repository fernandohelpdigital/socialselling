# Vídeos do build in public

Reels e animações do Buscando 1 Milhão, escritos em HTML + GSAP e renderizados quadro a quadro pelo [huashu-motion](https://github.com/alchaincyf/huashu-motion) (MIT).

| arquivo | o que é |
|---|---|
| `reel/index.html` | o Reel v1 (9:16, 19,4 s). Textos e cores são variáveis no topo do arquivo |
| `reel/treatment.md` | folha de ritmo, cadeia de continuidade e notas de direção |
| `reel/materials.md` | de onde veio cada frase e as licenças de terceiros |
| `entregas/` | os MP4 finais |

## Rodar

Precisa de Node 22+, FFmpeg e Chrome instalados.

```bash
cd video
npm install
npx om doctor               # confere Node, FFmpeg e Chrome
npx om studio reel          # prévia ao vivo, com comentários direto no quadro
npx om render reel --blur   # gera reel/out/reel-vN.mp4
npx om qa reel --sheet      # confere ritmo, quadros parados e folhas de contato
```

Para trocar um texto sem abrir o código, use `npx om set cta="Seu texto" reel` ou edite no studio.

O passo a passo completo e as armadilhas que já apareceram estão na skill `.claude/skills/reels-build-in-public/SKILL.md`.
