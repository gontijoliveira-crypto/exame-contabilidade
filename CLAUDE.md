# Expo Contabilidade e Consultoria — memória do projeto

## Marca padrão (regra fixa)
- **Todo conteúdo, de qualquer assunto, é da marca Expo Contabilidade e Consultoria**, salvo quando o usuário avisar explicitamente que é outra marca.
- "Exame Contabilidade" é o nome antigo (ainda no `index.html` do `main` e no domínio `examecontabilidade.com.br`). Não usar a identidade antiga da Exame (azul `#0B2A6F`, amarelo `#FFCC1A`, logo "e✓ame").
- A transcrição por voz do usuário costuma trocar "Expo" por "esse por", "ESP", "Exp" etc.
- E-mails do escritório usam o domínio `@expocontabilidade.com.br`.

## Identidade visual (fonte: `config/marca.json` nos branches `claude/serene-dijkstra-9u3a4v` e `claude/eager-ramanujan-kn0fle`)
- Cores:
  - Primária (azul-marinho): `#011433`
  - Primária clara (azul): `#1F4FA8`
  - Destaque (dourado): `#D9911C` · dourado para texto sobre branco: `#8A5A00`
  - Texto escuro: `#0B1F4D` · texto secundário: `#4A5677` · bordas: `#D7DCEA` / `#D8DEEA`
  - Fundo de aviso (creme): `#FFF6D1` · fundo: `#FFFFFF` (ou `#F4F6FA`)
- Fontes: **Lexend** (títulos) e **Nunito Sans** (texto) — Google Fonts.
- Logo: `marca/logo-expo.png` (940×409, dourado em degradê, fundo transparente — "€xpo" com arco e "Contabilidade e Consultoria" embaixo). Funciona sobre branco e sobre o azul-marinho.
- Ícone: `marca/icone-expo.png` (256×256, arco dourado sobre quadrado azul-marinho arredondado).
- Cópias do logo e do ícone em `posts/plp-299/marca/`.

## Posts
- Modelo pronto: `posts/plp-299/carrossel.html` (carrossel Instagram 1080×1350, layout antes/depois/impacto, logo Expo em todos os slides, rodapé com fonte, CTA "Fale com a gente"). Reutilizar como base para novos posts.
- Renderização: abrir o HTML no Playwright e tirar screenshot de cada `.slide`.
- Vídeo: Reels 1080×1920 com os slides centralizados sobre o azul-marinho, 6 s por slide, transição `slideleft` (ffmpeg `xfade`, processado em RGB para evitar borda colorida).
- Narração: **sempre a mesma voz dos outros vídeos** — gTTS, feminina, português do Brasil (`gtts-cli -l pt --tld com.br`, com `REQUESTS_CA_BUNDLE=/root/.ccr/ca-bundle.crt`), acelerada com `atempo=1.22`. Um trecho de áudio por slide; cada slide dura a sua fala + 0,9 s; `loudnorm` no final. Reels até 3 min. Requer `translate.google.com.br` liberado no ambiente (já liberado). Rodar `ffmpeg` com `-nostdin` dentro de loops. Roteiro em `narracao.txt` (uma linha por slide, números por extenso).
- O usuário ainda **não usa o Typefully**; entregar as imagens diretamente na conversa.
- Idioma: português do Brasil. Citar fontes oficiais (Agência Senado, Consultoria do Senado, Receita etc.).

## Histórico
- 19/11/2026: resumo da votação do PLP 299/2026 (ajuste fiscal) no Senado e carrossel "o que muda se a Câmara aprovar" em `posts/plp-299/` (refeito na marca Expo).
- 24/11/2026: Câmara aprovou o PLP 299 em 23/11 (353 × 128), sem mudanças; vai à sanção. Novo carrossel de 12 slides e vídeo vertical para Reels (`video-reels.mp4`, gerado com ffmpeg a partir dos slides) em `posts/plp-299-aprovado/` (versão narrada: `video-reels-narrado.mp4`, 2 min 27 s), incluindo o cálculo do teto da restrição à compensação (art. 6º-F) e o crédito para investimentos (art. 12).
