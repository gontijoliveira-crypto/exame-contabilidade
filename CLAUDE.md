# Exame Contabilidade e Consultoria — memória do projeto

## Marca padrão (regra fixa)
- **Todo conteúdo, de qualquer assunto, é da marca Exame Contabilidade e Consultoria**, salvo quando o usuário avisar explicitamente que é outra marca.
- Quando o usuário falar "Expo", "Exp", "esse por" ou algo parecido referindo-se à contabilidade, ele quer dizer **Exame** (erro de transcrição por voz).
- Site: examecontabilidade.com.br (repositório: `index.html`).

## Identidade visual
- Cores:
  - Azul-marinho (principal): `#0B2A6F`
  - Amarelo (destaque): `#FFCC1A`
  - Azul de apoio: `#1F56C3`
  - Texto escuro: `#0B1F4D` · texto secundário: `#4A5677`
  - Linhas/bordas: `#D7DCEA` · creme (fundo de destaque): `#FFF6D1` · dourado escuro (rótulos sobre creme): `#8A6400`
  - Fundo: `#FFFFFF`
- Fontes: **Lexend** (títulos) e **Nunito Sans** (texto) — Google Fonts.
- Logo: palavra "e✓ame" — "e" + quadrado arredondado azul-marinho com traço branco e check amarelo (formando o "x") + "ame", em Lexend 600 azul-marinho; abaixo, "CONTABILIDADE E CONSULTORIA" em caixa alta espaçada. O SVG do símbolo está em `index.html`. Em fundo escuro: palavra em branco, quadrado branco com traço azul-marinho e check amarelo.

## Posts
- Modelo pronto: `posts/plp-299/carrossel.html` (carrossel Instagram 1080×1350, layout antes/depois/impacto, logo em todos os slides, rodapé com fonte e `examecontabilidade.com.br`, CTA "Fale com a gente"). Reutilizar como base para novos posts.
- Renderização: abrir o HTML no Playwright e tirar screenshot de cada `.slide`.
- O usuário ainda **não usa o Typefully**; entregar as imagens diretamente na conversa.
- Idioma: português do Brasil. Citar fontes oficiais (Agência Senado, Consultoria do Senado, Receita etc.).

## Histórico
- 19/11/2026: resumo da votação do PLP 299/2026 (ajuste fiscal) no Senado e carrossel "o que muda se a Câmara aprovar" em `posts/plp-299/`.
