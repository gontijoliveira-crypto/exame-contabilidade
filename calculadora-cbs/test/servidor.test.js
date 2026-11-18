import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { ErroBloqueio, ErroDaReceita, ErroIndisponivel, ErroOcupado } from "../src/receita.js";
import { criarLimitador, criarServidor, ipDoCliente } from "../src/servidor.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casos = JSON.parse(fs.readFileSync(new URL("./fixtures/receita.json", import.meta.url), "utf8"));
const silencioso = { warn() {}, error() {} };
const MARCA = { nome: "Expo Contabilidade e Consultoria", subtitulo: null, logo: "marca/logo-expo.png", icone: "marca/icone-expo.png", compartilhar: null, cores: { primaria: "#011433", primariaClara: "#1F4FA8", destaque: "#D9911C" } };
const PEDIDO = { valor: "1000.00", data: "2026-11-18", uf: "GO", municipio: "5201108", cst: "000", cClassTrib: "000001" };

const abertos = [];
after(() => Promise.all(abertos.map((s) => new Promise((ok) => s.close(ok)))));

/** Sobe o servidor em uma porta livre, com uma Receita de mentira. */
async function subir({ receita = {}, ...opcoes } = {}) {
  const chamadas = [];
  const falsa = {
    ufs: async () => [{ sigla: "GO", nome: "Goiás" }, { sigla: "MG", nome: "Minas Gerais" }],
    municipios: async (uf) => { chamadas.push(["municipios", uf]); return [{ codigo: 5201108, nome: "Anápolis" }]; },
    situacoes: async (data) => { chamadas.push(["situacoes", data]); return [{ codigo: "000", descricao: "Tributação integral", classificacoes: [{ codigo: "000001", descricao: "Integral" }] }]; },
    versao: async () => ({ app: "1.7.0", base: "V0073", dataBase: "2026-11-09" }),
    calcular: async (operacao) => { chamadas.push(["calcular", operacao]); return { corpo: casos.integral.resposta.corpo, aviso: null }; },
    ...receita,
  };
  const servidor = http.createServer(criarServidor({ marca: MARCA, receita: falsa, raiz, log: silencioso, ...opcoes }));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  abertos.push(servidor);
  const origem = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = (caminho, init) => fetch(origem + caminho, init);
  const calcular = (corpo = PEDIDO, cabecalhos = {}) =>
    pedir("/api/calcular", { method: "POST", headers: { "Content-Type": "application/json", ...cabecalhos }, body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
  /** Pedido com o caminho exatamente como escrito (o fetch normaliza "..", e aqui queremos testar isso). */
  const cru = (caminho, metodo = "GET", cabecalhos = {}) =>
    new Promise((ok, falha) => {
      const req = http.request({ host: "127.0.0.1", port: servidor.address().port, path: caminho, method: metodo, headers: cabecalhos }, (res) => {
        const partes = [];
        res.on("data", (p) => partes.push(p));
        res.on("end", () => ok({ status: res.statusCode, cabecalhos: res.headers, corpo: Buffer.concat(partes) }));
      });
      req.on("error", falha);
      req.end();
    });
  return { pedir, calcular, cru, chamadas };
}

test("a página sai com a marca, sem código embutido e com os cabeçalhos de segurança", async () => {
  const simulacao = [{ de: "2027-01-01", ate: "2027-12-31", preencher: { ibsEstadual: "0.05" }, exemplo: { cbs: "11.2" }, nota: `Nota com "aspas" & <b>marcação</b>` }];
  const { pedir } = await subir({ simulacao });
  const resposta = await pedir("/");
  const html = await resposta.text();
  assert.equal(resposta.status, 200);
  assert.match(resposta.headers.get("content-type"), /^text\/html/);
  assert.match(html, /<title>Calculadora CBS e IBS · Expo Contabilidade e Consultoria<\/title>/);
  assert.match(html, /<img class="logo" src="\/marca\/logo-expo\.png" alt="Expo Contabilidade e Consultoria" width="940" height="409">/);
  assert.match(html, /<link rel="icon" href="\/marca\/icone-expo\.png">/);
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, "não pode haver script embutido (a política de segurança bloquearia)");
  assert.doesNotMatch(html, /<style|\sstyle=|\son\w+=/, "não pode haver estilo ou evento embutido");
  assert.doesNotMatch(html, /og:url|og:image|rel="canonical"/, "sem endereço público configurado, não inventa um");
  const periodos = /data-periodos="([^"]*)"/.exec(html)[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  assert.deepEqual(JSON.parse(periodos), simulacao, "os períodos da simulação chegam à página, escapados");
  assert.doesNotMatch(html, /<b>marcação<\/b>/);

  const csp = resposta.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(resposta.headers.get("x-content-type-options"), "nosniff");
  assert.equal(resposta.headers.get("x-frame-options"), "DENY");
  assert.equal(resposta.headers.get("referrer-policy"), "no-referrer");
});

test("com endereço público, a prévia do link aponta para ele", async () => {
  const { pedir } = await subir({ urlPublica: "https://calc.exemplo.com.br" });
  const html = await (await pedir("/")).text();
  assert.match(html, /<link rel="canonical" href="https:\/\/calc\.exemplo\.com\.br\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/calc\.exemplo\.com\.br\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/calc\.exemplo\.com\.br\/marca\/icone-expo\.png">/);
});

test("o nome do escritório é escapado na página", async () => {
  const { pedir } = await subir({ marca: { ...MARCA, nome: `Silva & "Filhos" <script>alert(1)</script>`, logo: null, icone: null } });
  const html = await (await pedir("/")).text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Silva &amp; &quot;Filhos&quot; &lt;script&gt;/);
  assert.match(html, /<span class="logo-texto">Silva &amp;/);
  assert.match(html, /<link rel="icon" href="\/icone\.svg">/);
  const icone = await pedir("/icone.svg");
  assert.equal(icone.headers.get("content-type"), "image/svg+xml");
  assert.match(await icone.text(), />S<\/text>/);
});

test("arquivos da página: tipo certo, compactação e validação por ETag", async () => {
  const { pedir, cru } = await subir();
  for (const [caminho, tipo] of [["/estilo.css", "text/css"], ["/app.js", "text/javascript"], ["/formatos.js", "text/javascript"], ["/marca.css", "text/css"], ["/marca/logo-expo.png", "image/png"], ["/robots.txt", "text/plain"]]) {
    const r = await pedir(caminho);
    assert.equal(r.status, 200, caminho);
    assert.ok(r.headers.get("content-type").startsWith(tipo), caminho);
    assert.equal(r.headers.get("cache-control"), "no-cache", caminho);
    assert.ok(r.headers.get("etag"), caminho);
    await r.arrayBuffer();
  }
  const css = await cru("/estilo.css");
  assert.equal(css.cabecalhos["content-encoding"], undefined);
  assert.equal(Number(css.cabecalhos["content-length"]), css.corpo.length);
  assert.deepEqual(css.corpo, fs.readFileSync(path.join(raiz, "public", "estilo.css")));

  const compactado = await pedir("/estilo.css", { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(compactado.headers.get("content-encoding"), "gzip");
  assert.equal(compactado.headers.get("vary"), "Accept-Encoding");

  const igual = await pedir("/estilo.css", { headers: { "If-None-Match": css.cabecalhos.etag } });
  assert.equal(igual.status, 304);
  assert.equal((await igual.arrayBuffer()).byteLength, 0);

  const logo = await cru("/marca/logo-expo.png");
  assert.deepEqual(logo.corpo, fs.readFileSync(path.join(raiz, "public", "marca", "logo-expo.png")));
});

test("HEAD devolve só os cabeçalhos", async () => {
  const { cru } = await subir();
  const r = await cru("/", "HEAD");
  assert.equal(r.status, 200);
  assert.ok(Number(r.cabecalhos["content-length"]) > 1000);
  assert.equal(r.corpo.length, 0);
});

test("só o que está em public/ é servido", async () => {
  const { cru } = await subir();
  for (const caminho of ["/../package.json", "/%2e%2e/package.json", "/marca/../../package.json", "/marca/..%2f..%2fpackage.json", "//etc/passwd", "/src/servidor.js", "/config/marca.json", "/package.json", "/.env", "/marca", "/marca/"]) {
    const r = await cru(caminho);
    assert.equal(r.status, 404, caminho);
    assert.doesNotMatch(r.corpo.toString("utf8"), /calculadora-cbs|primaria/, caminho);
  }
  const r = await cru("/nao-existe");
  assert.match(r.corpo.toString("utf8"), /Página não encontrada/);
  assert.equal(r.cabecalhos["cache-control"], "no-store");
});

test("métodos não previstos são recusados", async () => {
  const { pedir } = await subir();
  for (const [caminho, metodo, permitido] of [["/", "POST", "GET, HEAD"], ["/estilo.css", "DELETE", "GET, HEAD"], ["/api/ufs", "POST", "GET, HEAD"], ["/api/calcular", "GET", "POST"], ["/api/calcular", "PUT", "POST"]]) {
    const r = await pedir(caminho, { method: metodo });
    assert.equal(r.status, 405, `${metodo} ${caminho}`);
    assert.equal(r.headers.get("allow"), permitido, `${metodo} ${caminho}`);
    await r.arrayBuffer();
  }
});

test("verificação de saúde da hospedagem", async () => {
  const { pedir } = await subir();
  const r = await pedir("/saude");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("listas da API", async () => {
  const { pedir, chamadas } = await subir();
  const ufs = await pedir("/api/ufs");
  assert.equal(ufs.headers.get("cache-control"), "public, max-age=300");
  assert.deepEqual(await ufs.json(), [{ sigla: "GO", nome: "Goiás" }, { sigla: "MG", nome: "Minas Gerais" }]);
  assert.deepEqual(await (await pedir("/api/municipios?uf=GO")).json(), [{ codigo: 5201108, nome: "Anápolis" }]);
  assert.equal((await (await pedir("/api/situacoes?data=2026-11-18")).json())[0].codigo, "000");
  assert.deepEqual(await (await pedir("/api/versao")).json(), { app: "1.7.0", base: "V0073", dataBase: "2026-11-09" });
  assert.deepEqual(chamadas, [["municipios", "GO"], ["situacoes", "2026-11-18"]]);
});

test("listas da API: parâmetros inválidos não chegam à Receita", async () => {
  const { pedir, chamadas } = await subir();
  for (const caminho of ["/api/municipios", "/api/municipios?uf=XX", "/api/municipios?uf=go", "/api/municipios?uf=GO%26x%3D1", "/api/situacoes", "/api/situacoes?data=2026-02-30", "/api/situacoes?data=2040-01-01", "/api/situacoes?data=2026-11-18%26siglaDfe%3DNFE"]) {
    const r = await pedir(caminho);
    assert.equal(r.status, 400, caminho);
    assert.ok((await r.json()).erro, caminho);
  }
  assert.equal((await pedir("/api/outra")).status, 404);
  assert.equal((await pedir("/api/")).status, 404);
  assert.deepEqual(chamadas, []);
});

test("cálculo: o pedido da página vira a operação da Receita e a resposta vem resumida", async () => {
  const { calcular, chamadas } = await subir();
  const r = await calcular();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const dados = await r.json();
  assert.equal(dados.total, "10.00");
  assert.equal(dados.cbs.valor, "9.00");
  const [, operacao] = chamadas[0];
  assert.match(operacao.id, /^[0-9a-f]{32}$/);
  assert.deepEqual({ ...operacao, id: "fixture" }, casos.integral.pedido);
});

test("cálculo: pedidos malformados são recusados antes de chegar à Receita", async () => {
  const { calcular, pedir, chamadas } = await subir();
  assert.equal((await calcular("{não é json")).status, 400);
  assert.equal((await calcular("[]")).status, 400);
  assert.equal((await calcular(PEDIDO, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await pedir("/api/calcular", { method: "POST", body: JSON.stringify(PEDIDO) })).status, 415); // sem tipo de conteúdo JSON
  const semValor = await calcular({ ...PEDIDO, valor: "" });
  assert.equal(semValor.status, 400);
  assert.deepEqual(await semValor.json(), { erro: "Informe o valor da operação, maior que zero.", detalhe: null, campo: "valor" });
  const grande = await calcular({ ...PEDIDO, extra: "x".repeat(5000) }).catch(() => ({ status: 413 })); // a conexão pode ser cortada
  assert.equal(grande.status, 413);
  assert.deepEqual(chamadas, []);
});

test("cálculo: a recusa da Receita vira mensagem com o campo a corrigir", async () => {
  const { calcular } = await subir({ receita: { calcular: async () => { throw new ErroDaReceita(422, casos.erroNcm.resposta.corpo); } } });
  const r = await calcular();
  assert.equal(r.status, 422);
  assert.deepEqual(await r.json(), { erro: "NCM completo não informado", detalhe: "Esta classificação exige o NCM completo da mercadoria (8 dígitos).", campo: "ncm" });
});

test("cálculo: Receita fora do ar, formato inesperado e erro interno não vazam detalhes", async () => {
  const fora = await subir({ receita: { calcular: async () => { throw new ErroIndisponivel("ECONNRESET 10.0.0.1"); } } });
  let r = await fora.calcular();
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("retry-after"), "10");
  assert.doesNotMatch(JSON.stringify(await r.json()), /ECONNRESET|10\.0\.0\.1/);

  const estranho = await subir({ receita: { calcular: async () => ({ corpo: { objetos: [] }, aviso: null }) } });
  r = await estranho.calcular();
  assert.equal(r.status, 502);
  assert.match((await r.json()).erro, /formato inesperado/);

  const quebrado = await subir({ receita: { calcular: async () => { throw new TypeError("segredo interno"); } } });
  r = await quebrado.calcular();
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { erro: "Erro interno.", detalhe: null, campo: null });
});

test("listas: Receita fora do ar vira 503", async () => {
  const { pedir } = await subir({ receita: { ufs: async () => { throw new ErroIndisponivel("fora"); } } });
  assert.equal((await pedir("/api/ufs")).status, 503);
  assert.equal((await pedir("/api/municipios?uf=GO")).status, 503);
});

test("há limite de cálculos e de consultas por visitante", async () => {
  let relogio = 0;
  const { calcular, pedir } = await subir({ limites: { calculosPorMinuto: 2, consultasPorMinuto: 3 }, agora: () => relogio });
  assert.equal((await calcular()).status, 200);
  assert.equal((await calcular()).status, 200);
  const barrado = await calcular();
  assert.equal(barrado.status, 429);
  assert.equal(barrado.headers.get("retry-after"), "60");
  assert.match((await barrado.json()).erro, /Muitos cálculos/);
  for (let i = 0; i < 3; i++) assert.equal((await pedir("/api/ufs")).status, 200); // limite separado
  assert.equal((await pedir("/api/ufs")).status, 429);
  assert.equal((await pedir("/")).status, 200); // a página em si não entra no limite
  relogio += 60_000;
  assert.equal((await calcular()).status, 200);
  assert.equal((await pedir("/api/ufs")).status, 200);
});

test("atrás de um proxy, o limite vale por visitante (X-Forwarded-For)", async () => {
  const { calcular } = await subir({ limites: { calculosPorMinuto: 1 }, origemDoIp: { proxies: 1 } });
  assert.equal((await calcular(PEDIDO, { "X-Forwarded-For": "203.0.113.1" })).status, 200);
  assert.equal((await calcular(PEDIDO, { "X-Forwarded-For": "203.0.113.2" })).status, 200);
  assert.equal((await calcular(PEDIDO, { "X-Forwarded-For": "203.0.113.1" })).status, 429);
  // Trocar o início da lista (que o visitante controla) não dá um novo limite.
  assert.equal((await calcular(PEDIDO, { "X-Forwarded-For": "198.51.100.77, 203.0.113.1" })).status, 429);
});

test("no Railway, o limite usa o X-Real-IP gravado pela hospedagem", async () => {
  const { calcular } = await subir({ limites: { calculosPorMinuto: 1 }, origemDoIp: { cabecalhoIp: "x-real-ip", proxies: 1 } });
  assert.equal((await calcular(PEDIDO, { "X-Real-IP": "203.0.113.1", "X-Forwarded-For": "10.0.0.1" })).status, 200);
  assert.equal((await calcular(PEDIDO, { "X-Real-IP": "203.0.113.2", "X-Forwarded-For": "10.0.0.1" })).status, 200);
  assert.equal((await calcular(PEDIDO, { "X-Real-IP": "203.0.113.1", "X-Forwarded-For": "10.9.9.9" })).status, 429);
});

test("ipDoCliente: conexão direta, cabeçalho da hospedagem ou X-Forwarded-For contado a partir do fim", () => {
  const req = (cabecalhos = {}, remoto = "10.0.0.9") => ({ socket: { remoteAddress: remoto }, headers: cabecalhos });
  const xff = (valor) => req({ "x-forwarded-for": valor });
  assert.equal(ipDoCliente(xff("1.1.1.1")), "10.0.0.9"); // sem proxy configurado, o cabeçalho é ignorado
  assert.equal(ipDoCliente(req({ "x-real-ip": "1.1.1.1" })), "10.0.0.9");
  assert.equal(ipDoCliente(xff("1.1.1.1, 2.2.2.2"), { proxies: 1 }), "2.2.2.2");
  assert.equal(ipDoCliente(xff("1.1.1.1, 2.2.2.2, 3.3.3.3"), { proxies: 2 }), "2.2.2.2");
  assert.equal(ipDoCliente(xff("1.1.1.1"), { proxies: 2 }), "1.1.1.1"); // menos saltos do que o esperado
  assert.equal(ipDoCliente(req(), { proxies: 1 }), "10.0.0.9");
  assert.equal(ipDoCliente(xff(" , "), { proxies: 1 }), "10.0.0.9");
  const railway = { cabecalhoIp: "x-real-ip", proxies: 1 };
  assert.equal(ipDoCliente(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "9.9.9.9" }), railway), "203.0.113.7");
  assert.equal(ipDoCliente(req({ "x-real-ip": " 2001:db8::1 " }), railway), "2001:db8::1");
  assert.equal(ipDoCliente(req({ "x-forwarded-for": "9.9.9.9" }), railway), "9.9.9.9"); // sem o cabeçalho, cai no X-Forwarded-For
  assert.equal(ipDoCliente(req({ "x-real-ip": "não é um ip", "x-forwarded-for": "9.9.9.9" }), railway), "9.9.9.9");
  assert.equal(ipDoCliente(req({ "x-real-ip": "x".repeat(500) }), { cabecalhoIp: "x-real-ip" }), "10.0.0.9");
});

test("criarLimitador: janela fixa por chave, sem crescer sem limite", () => {
  let relogio = 0;
  const dentro = criarLimitador(2, 1000, () => relogio);
  assert.deepEqual([dentro("a"), dentro("a"), dentro("a"), dentro("b")], [true, true, false, true]);
  relogio = 999;
  assert.equal(dentro("a"), false);
  relogio = 1000;
  assert.equal(dentro("a"), true);
  for (let i = 0; i < 25_000; i++) dentro(`ip-${i}`); // muitas chaves diferentes não derrubam o servidor
  assert.equal(dentro("nova"), true);
});

test("respostas JSON grandes são compactadas quando o navegador aceita", async () => {
  const muitos = Array.from({ length: 300 }, (_, i) => ({ codigo: 5200000 + i, nome: `Município ${i}` }));
  const { cru } = await subir({ receita: { municipios: async () => muitos } });
  const simples = await cru("/api/municipios?uf=GO");
  assert.equal(simples.cabecalhos["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(simples.corpo.toString("utf8")), muitos);
  const compactada = await cru("/api/municipios?uf=GO", "GET", { "Accept-Encoding": "gzip, br" });
  assert.equal(compactada.cabecalhos["content-encoding"], "gzip");
  assert.ok(compactada.corpo.length < simples.corpo.length / 2);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(compactada.corpo).toString("utf8")), muitos);
});

test("crédito com transportador autônomo: uma só chamada à Receita e o crédito na resposta", async () => {
  const { calcular, chamadas } = await subir({ receita: { calcular: async (op) => { chamadas.push(["calcular", op]); return { corpo: casos.simulado2027.resposta.corpo, aviso: "6" }; } } });
  const pedido = { ...PEDIDO, data: "2027-03-18", aliquotas: { cbs: "8.8", ibsEstadual: "0.05", ibsMunicipal: "0.05" }, credito: { tipo: "autonomo", valor: "7000.00", cbs: "3", ibs: "0.05" } };
  const r = await calcular(pedido);
  assert.equal(r.status, 200);
  const dados = await r.json();
  assert.equal(chamadas.length, 1);
  assert.deepEqual(dados.credito.cbs, { percentual: "3", valor: "203.88" });
  assert.equal(dados.credito.saldo.total, "-118.38");
});

test("crédito com transportadora do regime regular: o frete dela também é calculado pela Receita", async () => {
  const { calcular, chamadas } = await subir({ receita: { calcular: async (op) => { chamadas.push(["calcular", op]); return { corpo: casos.simulado2027.resposta.corpo, aviso: "6" }; } } });
  const pedido = { ...PEDIDO, data: "2027-03-18", aliquotas: { cbs: "8.8", ibsEstadual: "0.05", ibsMunicipal: "0.05" }, credito: { tipo: "empresa", valor: "1000.00" } };
  const dados = await (await calcular(pedido)).json();
  assert.equal(chamadas.length, 2);
  const sub = chamadas.map(([, op]) => op).find((op) => op.itens[0].baseCalculo === 1000 && op !== chamadas[0][1]);
  assert.deepEqual(sub.itens[0], { numero: 1, cst: "000", cClassTrib: "000001", baseCalculo: 1000, aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 } });
  assert.notEqual(chamadas[0][1].id, chamadas[1][1].id);
  assert.equal(dados.credito.total, "89.00");
  assert.deepEqual(dados.credito.saldo, { cbs: "0.00", ibs: "0.00", total: "0.00" });
});

test("crédito em 2026 é recusado antes de chegar à Receita", async () => {
  const { calcular, chamadas } = await subir();
  const r = await calcular({ ...PEDIDO, credito: { tipo: "autonomo", valor: "100", cbs: "1", ibs: "1" } });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).campo, "creditoTipo");
  assert.deepEqual(chamadas, []);
});

test("bloqueio do firewall da Receita vira 503 com mensagem própria", async () => {
  const { calcular } = await subir({ receita: { calcular: async () => { throw new ErroBloqueio("Request Rejected"); } } });
  const r = await calcular();
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("retry-after"), "120");
  assert.match((await r.json()).erro, /recusando consultas/);
});

test("cada visitante tem no máximo duas consultas à Receita em andamento", async () => {
  let liberar;
  const porta = new Promise((ok) => { liberar = ok; });
  const { calcular, pedir } = await subir({ receita: { calcular: async () => { await porta; return { corpo: casos.integral.resposta.corpo, aviso: null }; } } });
  const a = calcular();
  const b = calcular();
  await new Promise((ok) => setTimeout(ok, 50));
  const terceira = await calcular();
  assert.equal(terceira.status, 429);
  assert.match((await terceira.json()).erro, /consulta anterior/);
  liberar();
  assert.deepEqual([(await a).status, (await b).status], [200, 200]);
  assert.equal((await pedir("/api/ufs")).status, 200); // vagas devolvidas
});

test("trocas de data têm limite próprio", async () => {
  const { pedir } = await subir({ limites: { datasPorMinuto: 2 } });
  assert.equal((await pedir("/api/situacoes?data=2026-01-01")).status, 200);
  assert.equal((await pedir("/api/situacoes?data=2026-01-02")).status, 200);
  const r = await pedir("/api/situacoes?data=2026-01-03");
  assert.equal(r.status, 429);
  assert.match((await r.json()).erro, /trocas de data/);
  assert.equal((await pedir("/api/ufs")).status, 200);
});

test("corpo grande demais recebe 413 de verdade", async () => {
  const { pedir } = await subir();
  const r = await pedir("/api/calcular", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...PEDIDO, extra: "x".repeat(20_000) }) });
  assert.equal(r.status, 413);
});

test("endereço malformado recebe 400, sem erro interno", async () => {
  const { cru } = await subir();
  for (const caminho of ["/%E0%A4%A", "/api/%zz", "/marca/%"]) {
    const r = await cru(caminho);
    assert.equal(r.status, 400, caminho);
  }
});

test("vagas locais esgotadas têm mensagem própria", async () => {
  const { calcular } = await subir({ receita: { calcular: async () => { throw new ErroOcupado("cheio"); } } });
  const r = await calcular();
  assert.equal(r.status, 503);
  assert.match((await r.json()).erro, /Muitas pessoas/);
});

test("datas já guardadas não contam no limite de trocas de data", async () => {
  const { pedir } = await subir({ limites: { datasPorMinuto: 1 }, receita: { situacoesGuardadas: (d) => d === "2026-11-18" } });
  for (let i = 0; i < 5; i++) assert.equal((await pedir("/api/situacoes?data=2026-11-18")).status, 200);
  assert.equal((await pedir("/api/situacoes?data=2026-01-01")).status, 200);
  assert.equal((await pedir("/api/situacoes?data=2026-01-02")).status, 429);
});
