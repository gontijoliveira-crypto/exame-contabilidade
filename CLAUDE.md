# Exame Contabilidade e Consultoria — site

Site institucional em `examecontabilidade.com.br`, publicado pelo GitHub Pages a partir do branch `main` (arquivo `CNAME`). Hoje é uma página "em construção" com a política de privacidade.

## Estrutura (não precisa explorar)
- `index.html` — o site inteiro: HTML, CSS e JS num arquivo só, sem build e sem dependências.
  - `#view-inicio` (linhas ~66–77): capa com a logo e o aviso "Site em construção".
  - `#view-privacidade` (linhas ~79–142): política de privacidade (LGPD), aberta por `#privacidade`.
  - O script no fim do arquivo alterna as duas telas pelo hash da URL.
- `.claude/`, `.mcp.json`, `graft/` — configuração do Claude Code e do graft. Não fazem parte do site.

## Marca
- Cores: azul-marinho `#0B2A6F`, amarelo `#FFCC1A`, texto `#0B1F4D`, destaque `#1F56C3` (variáveis em `:root`).
- Fontes: Lexend (títulos) e Nunito Sans (texto), pelo Google Fonts.
- Logo: o "x" de "exame" é um SVG com a marca de visto amarela.

## Regras
- Todo o texto do site é em português do Brasil, com tom profissional e acessível.
- Mantenha tudo em `index.html`, sem frameworks nem etapa de build, salvo pedido explícito.
- O site precisa funcionar bem no celular.
- Não invente dados da empresa (CNPJ, endereço, telefone, CRC, nomes). Use um marcador entre colchetes, como `[Nome do encarregado]`, e avise.
- Pendências conhecidas: `[Nome do encarregado]` na seção 9 da política.
- Não envie nada para `main` sem aprovação; trabalhe no branch da sessão.

## Como trabalhar com economia
- Para mudanças pequenas, leia só o trecho necessário de `index.html` (use as linhas acima), não o arquivo inteiro.
- Respostas curtas e em português; sem repetir o que já foi dito.
