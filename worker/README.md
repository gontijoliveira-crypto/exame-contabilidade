# Intermediário da Calculadora CBS e IBS

A página `/calculadora-cbs/` usa a API pública da Calculadora da Reforma Tributária do Consumo, da Receita Federal
(`https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api`, documentação em `/api-docs`).
Essa API não exige chave, mas não envia cabeçalhos CORS, então o navegador não consegue chamá-la a partir de
`examecontabilidade.com.br`. Este Cloudflare Worker faz a ponte.

Ele repassa somente `GET /calculadora/dados-abertos/*` e `POST /calculadora/regime-geral`, e só responde a pedidos
vindos de `https://examecontabilidade.com.br` (e `www`).

## Publicar

1. Crie uma conta gratuita em https://dash.cloudflare.com.
2. Nesta pasta, rode `npx wrangler deploy` (ele pede login no navegador na primeira vez).
   Alternativa sem terminal: no painel, Workers & Pages → Create → Worker, e cole o conteúdo de `src/index.js`.
3. Copie o endereço que aparecer (algo como `https://calculadora-cbs.SEU-USUARIO.workers.dev`) e cole em
   `calculadora-cbs/config.js`, na variável `window.CALCULADORA_CBS_API`.

Enquanto `config.js` estiver vazio, a página mostra o aviso "Calculadora em configuração".

## Testar no computador

Sirva o site em `http://localhost:8080` e abra `/calculadora-cbs/?api=http://localhost:8787` com `npx wrangler dev`
rodando nesta pasta e `ALLOWED_ORIGINS=http://localhost:8080` definido em `[vars]` no `wrangler.toml`.
O parâmetro `?api=` só é aceito em `localhost`.
