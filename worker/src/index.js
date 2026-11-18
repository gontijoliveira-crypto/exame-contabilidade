// Intermediário entre a página /calculadora-cbs/ e a API da Calculadora da CBS/IBS da Receita Federal.
// A API oficial não envia cabeçalhos CORS, então o navegador não consegue chamá-la direto de outro domínio.
// Este Worker repassa apenas as rotas usadas pela página e só responde às origens permitidas.

const UPSTREAM = 'https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api';
const DEFAULT_ORIGINS = ['https://examecontabilidade.com.br', 'https://www.examecontabilidade.com.br'];
const MAX_BODY_BYTES = 20_000;
const LOOKUP_CACHE_SECONDS = 3600;

const ROUTES = [
  { method: 'GET', test: (p) => p.startsWith('/calculadora/dados-abertos/') },
  { method: 'POST', test: (p) => p === '/calculadora/regime-geral' },
];

function allowedOrigins(env) {
  const extra = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS : '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}

function problem(status, title, detail, cors) {
  return new Response(JSON.stringify({ status, title, detail }), {
    status,
    headers: { 'content-type': 'application/problem+json; charset=utf-8', ...cors },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (!origin || !allowedOrigins(env).includes(origin)) {
      return problem(403, 'Origem não permitida', 'Este serviço atende apenas ao site da Exame Contabilidade.', {});
    }
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-expose-headers': 'x-warning-dados-simulados',
      vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '86400',
        },
      });
    }

    const path = url.pathname.replace(/\/+$/, '');
    if (path.includes('..') || !ROUTES.some((r) => r.method === request.method && r.test(path))) {
      return problem(404, 'Rota não disponível', 'Esta rota não é repassada à API da Receita Federal.', cors);
    }

    const init = { method: request.method, headers: { accept: 'application/json' } };
    if (request.method === 'POST') {
      const body = await request.text();
      if (body.length > MAX_BODY_BYTES) return problem(413, 'Requisição grande demais', 'Reduza o número de itens.', cors);
      init.body = body;
      init.headers['content-type'] = 'application/json';
    } else {
      init.cf = { cacheTtl: LOOKUP_CACHE_SECONDS, cacheEverything: true };
    }

    let upstream;
    try {
      upstream = await fetch(UPSTREAM + path + url.search, init);
    } catch (err) {
      return problem(502, 'API da Receita Federal indisponível', 'Não foi possível conectar à Calculadora da CBS. Tente novamente em instantes.', cors);
    }

    const headers = { ...cors, 'content-type': upstream.headers.get('content-type') || 'application/json' };
    const warning = upstream.headers.get('x-warning-dados-simulados');
    if (warning) headers['x-warning-dados-simulados'] = warning;
    headers['cache-control'] = request.method === 'GET' && upstream.ok ? `public, max-age=${LOOKUP_CACHE_SECONDS}` : 'no-store';
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
