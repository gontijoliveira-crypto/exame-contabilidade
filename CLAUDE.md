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
- O usuário ainda **não usa o Typefully**; entregar as imagens diretamente na conversa.
- Idioma: português do Brasil. Citar fontes oficiais (Agência Senado, Consultoria do Senado, Receita etc.).

## Histórico
- 19/11/2026: resumo da votação do PLP 299/2026 (ajuste fiscal) no Senado e carrossel "o que muda se a Câmara aprovar" em `posts/plp-299/` (refeito na marca Expo).
