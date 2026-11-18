import assert from "node:assert/strict";
import { test } from "node:test";
import { ErroBloqueio, ErroDaReceita, ErroIndisponivel, ErroOcupado, criarReceita, nomeProprio } from "../src/receita.js";

const silencioso = { warn() {}, error() {} };
const json = (corpo, status = 200, cabecalhos = {}) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", ...cabecalhos } });

/** Receita de mentira: `respostas` é a fila do que cada chamada devolve (uma Response, um Error ou uma função). */
function montar(respostas, opcoes = {}) {
  const chamadas = [];
  const esperas = [];
  let relogio = 1_000_000;
  const receita = criarReceita({
    base: "https://receita.test/api",
    buscar: async (url, init) => {
      chamadas.push({ url, init });
      const proxima = respostas.shift();
      if (proxima === undefined) throw new Error("chamada não esperada");
      const valor = typeof proxima === "function" ? await proxima() : proxima;
      if (valor instanceof Error) throw valor;
      return valor;
    },
    agora: () => relogio,
    esperar: async (ms) => { esperas.push(ms); },
    log: silencioso,
    ...opcoes,
  });
  return { receita, chamadas, esperas, avancar: (ms) => { relogio += ms; } };
}

const UFS = [{ codigo: 52, nome: "GOIÁS", sigla: "GO" }, { codigo: 99, nome: "EXTERIOR", sigla: "EX" }, { codigo: 50, nome: "MATO GROSSO DO SUL", sigla: "MS" }, { codigo: 11, nome: "RONDÔNIA", sigla: "RO" }, { nome: "", sigla: "XX" }, null];

test("nomes em maiúsculas viram nomes próprios", () => {
  assert.equal(nomeProprio("MATO GROSSO DO SUL"), "Mato Grosso do Sul");
  assert.equal(nomeProprio("RIO GRANDE DO NORTE"), "Rio Grande do Norte");
  assert.equal(nomeProprio("  são  PAULO "), "São Paulo");
  assert.equal(nomeProprio("ESPÍRITO SANTO"), "Espírito Santo");
});

test("UFs: sem 'Exterior', com nome próprio e em ordem de sigla", async () => {
  const { receita, chamadas } = montar([json(UFS)]);
  assert.deepEqual(await receita.ufs(), [{ sigla: "GO", nome: "Goiás" }, { sigla: "MS", nome: "Mato Grosso do Sul" }, { sigla: "RO", nome: "Rondônia" }]);
  assert.equal(chamadas[0].url, "https://receita.test/api/calculadora/dados-abertos/ufs");
  assert.equal(chamadas[0].init.method, "GET");
  assert.equal(chamadas[0].init.redirect, "error");
});

test("municípios e situações são convertidos e ordenados", async () => {
  const { receita, chamadas } = montar([
    json([{ codigo: 5208707, nome: "Goiânia" }, { codigo: 5201108, nome: "Anápolis" }, { codigo: "x", nome: "Ruim" }]),
    json([
      { id: 2, codigo: "200", descricao: "Alíquota reduzida", classificacoesTributarias: [{ codigo: "200003", descricao: "Cesta básica" }, { codigo: "ruim" }] },
      { id: 1, codigo: "000", descricao: "Tributação integral", classificacoesTributarias: [{ codigo: "000001", descricao: "Integral" }] },
      { id: 3, codigo: "999", descricao: "Sem classificações", classificacoesTributarias: [] },
    ]),
  ]);
  assert.deepEqual(await receita.municipios("GO"), [{ codigo: 5201108, nome: "Anápolis" }, { codigo: 5208707, nome: "Goiânia" }]);
  assert.match(chamadas[0].url, /ufs\/municipios\?siglaUf=GO$/);
  assert.deepEqual(await receita.situacoes("2026-11-18"), [
    { codigo: "000", descricao: "Tributação integral", classificacoes: [{ codigo: "000001", descricao: "Integral" }] },
    { codigo: "200", descricao: "Alíquota reduzida", classificacoes: [{ codigo: "200003", descricao: "Cesta básica" }] },
  ]);
  assert.match(chamadas[1].url, /situacoes-tributarias\/cbs-ibs\?data=2026-11-18$/);
});

test("versão: só o número, sem o sufixo técnico", async () => {
  const { receita } = montar([json({ versaoApp: "1.7.0-753903df", versaoDb: "V0073", dataVersaoDb: "2026-11-09" })]);
  assert.deepEqual(await receita.versao(), { app: "1.7.0", base: "V0073", dataBase: "2026-11-09" });
});

test("falha passageira é tentada de novo, com espera crescente", async () => {
  const { receita, chamadas, esperas } = montar([new Error("ECONNRESET"), json({}, 503), json(UFS)]);
  assert.equal((await receita.ufs()).length, 3);
  assert.equal(chamadas.length, 3);
  assert.deepEqual(esperas, [300, 900]);
});

test("depois das tentativas, a falha vira 'indisponível'", async () => {
  const { receita, chamadas } = montar([json({}, 500), json({}, 502), new Error("tempo esgotado")]);
  await assert.rejects(receita.ufs(), ErroIndisponivel);
  assert.equal(chamadas.length, 3);
});

test("resposta que não é JSON ou não é lista não é aceita", async () => {
  const html = () => new Response("<html>manutenção</html>", { status: 200 });
  await assert.rejects(montar([html(), html(), html()]).receita.ufs(), ErroIndisponivel);
  await assert.rejects(montar([json({ erro: "x" })]).receita.ufs(), ErroIndisponivel);
});

test("recusa da Receita (4xx) não é tentada de novo e traz o motivo", async () => {
  const problema = { title: "NCM completo não informado", detail: "NCM completo não informado", type: "https://x/errors/ncm-completo-nao-informado", status: 422 };
  const { receita, chamadas } = montar([json(problema, 422)]);
  await assert.rejects(receita.calcular({ id: "1" }), (erro) => erro instanceof ErroDaReceita && erro.status === 422 && erro.problema.title === problema.title);
  assert.equal(chamadas.length, 1);
});

test("cálculo: envia a operação em JSON e devolve o código de aviso", async () => {
  const { receita, chamadas } = montar([json({ objetos: [] }, 200, { "x-warning-dados-simulados": "6" }), json({ objetos: [] })]);
  const operacao = { id: "abc", itens: [{ numero: 1 }] };
  assert.deepEqual(await receita.calcular(operacao), { corpo: { objetos: [] }, aviso: "6" });
  assert.equal(chamadas[0].url, "https://receita.test/api/calculadora/regime-geral");
  assert.equal(chamadas[0].init.method, "POST");
  assert.equal(chamadas[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(chamadas[0].init.body), operacao);
  assert.equal((await receita.calcular(operacao)).aviso, null);
});

test("listas ficam guardadas e só são buscadas de novo depois da validade", async () => {
  const { receita, chamadas, avancar } = montar([json(UFS), json(UFS)]);
  await receita.ufs();
  await receita.ufs();
  assert.equal(chamadas.length, 1);
  avancar(25 * 3_600_000);
  await receita.ufs();
  assert.equal(chamadas.length, 2);
});

test("pedidos iguais ao mesmo tempo fazem uma só chamada", async () => {
  let liberar;
  const porta = new Promise((ok) => { liberar = ok; });
  const { receita, chamadas } = montar([async () => { await porta; return json(UFS); }]);
  const pedidos = [receita.ufs(), receita.ufs(), receita.ufs()];
  liberar();
  const [a, b, c] = await Promise.all(pedidos);
  assert.equal(chamadas.length, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test("com a Receita fora do ar, a lista guardada (mesmo vencida) continua sendo usada", async () => {
  const { receita, avancar } = montar([json(UFS), new Error("fora"), new Error("fora"), new Error("fora"), json(UFS)]);
  const primeira = await receita.ufs();
  avancar(25 * 3_600_000);
  assert.deepEqual(await receita.ufs(), primeira); // falhou 3 vezes, usou a cópia
  assert.deepEqual(await receita.ufs(), primeira); // tenta de novo na próxima vez
});

test("sem cópia guardada, a falha chega a quem pediu e não fica guardada", async () => {
  const { receita } = montar([new Error("fora"), new Error("fora"), new Error("fora"), json(UFS)]);
  await assert.rejects(receita.ufs(), ErroIndisponivel);
  assert.equal((await receita.ufs()).length, 3);
});

test("a memória das listas tem tamanho limitado", async () => {
  const respostas = [];
  for (let i = 0; i < 100; i++) respostas.push(json([{ codigo: "000", descricao: "x", classificacoesTributarias: [{ codigo: "000001", descricao: "y" }] }]));
  const { receita, chamadas } = montar(respostas);
  for (let dia = 1; dia <= 90; dia++) await receita.situacoes(`2026-${String(Math.ceil(dia / 30)).padStart(2, "0")}-${String(((dia - 1) % 30) + 1).padStart(2, "0")}`);
  assert.equal(chamadas.length, 90);
  await receita.situacoes("2026-03-30"); // a mais recente continua guardada
  assert.equal(chamadas.length, 90);
  await receita.situacoes("2026-01-01"); // a mais antiga saiu para dar lugar
  assert.equal(chamadas.length, 91);
});

test("há um teto de chamadas simultâneas à Receita", async () => {
  let liberar;
  const porta = new Promise((ok) => { liberar = ok; });
  const lenta = async () => { await porta; return json({ objetos: [] }); };
  const { receita } = montar([lenta, lenta], { maxSimultaneas: 2 });
  const a = receita.calcular({});
  const b = receita.calcular({});
  await assert.rejects(receita.calcular({}), ErroOcupado);
  liberar();
  await Promise.all([a, b]);
});

test("bloqueio do firewall da Receita: não repete a chamada e é identificado", async () => {
  const bloqueio = () => new Response("<html><head><title>Request Rejected</title></head><body>The requested URL was rejected.</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  const { receita, chamadas } = montar([bloqueio()]);
  await assert.rejects(receita.calcular({ id: "1" }), (erro) => erro instanceof ErroBloqueio && erro instanceof ErroIndisponivel);
  assert.equal(chamadas.length, 1);
  // Com uma lista já guardada, o bloqueio não derruba a página: a cópia guardada continua valendo.
  const lista = montar([json(UFS), bloqueio()]);
  const primeira = await lista.receita.ufs();
  lista.avancar(25 * 3_600_000);
  assert.deepEqual(await lista.receita.ufs(), primeira);
});

test("o tempo limite vale também para a leitura do corpo (resposta que trava no meio)", async () => {
  const travada = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } }), { status: 200 });
  const receita = criarReceita({ base: "https://receita.test/api", buscar: async (url, init) => {
    const r = travada();
    // simula o fetch real: o corpo para de chegar quando o sinal é abortado
    init.signal.addEventListener("abort", () => r.body.cancel().catch(() => {}));
    return { status: 200, ok: true, headers: new Headers(), text: () => new Promise((_, falha) => init.signal.addEventListener("abort", () => falha(init.signal.reason))) };
  }, tentativas: 1, tempoLimiteMs: 50, maxSimultaneas: 1, log: silencioso });
  await assert.rejects(receita.calcular({}), (erro) => erro instanceof ErroIndisponivel && !(erro instanceof ErroOcupado));
  await assert.rejects(receita.calcular({}), (erro) => !(erro instanceof ErroOcupado), "a vaga foi devolvida");
});

test("HTTP 429 não é repetido e pausa as consultas por um tempo", async () => {
  const { receita, chamadas, avancar } = montar([json({}, 429), json({ objetos: [] })]);
  await assert.rejects(receita.calcular({}), ErroBloqueio);
  assert.equal(chamadas.length, 1);
  await assert.rejects(receita.calcular({}), ErroBloqueio); // durante a pausa, nem chama
  assert.equal(chamadas.length, 1);
  avancar(121_000);
  assert.deepEqual((await receita.calcular({})).corpo, { objetos: [] });
});

test("muitas datas diferentes não apagam as listas de UFs e municípios", async () => {
  const sit = () => json([{ codigo: "000", descricao: "x", classificacoesTributarias: [{ codigo: "000001", descricao: "y" }] }]);
  const respostas = [json(UFS)];
  for (let i = 0; i < 70; i++) respostas.push(sit());
  const { receita, chamadas } = montar(respostas);
  await receita.ufs();
  for (let i = 1; i <= 70; i++) await receita.situacoes(`2026-${String(Math.ceil(i / 28)).padStart(2, "0")}-${String(((i - 1) % 28) + 1).padStart(2, "0")}`);
  const antes = chamadas.length;
  await receita.ufs();
  assert.equal(chamadas.length, antes, "UFs continuam guardadas");
});

test("na falha, a cópia vencida passa a valer mais 5 minutos sem novas esperas", async () => {
  const { receita, chamadas, avancar } = montar([json(UFS), new Error("fora"), new Error("fora"), new Error("fora"), json(UFS)]);
  await receita.ufs();
  avancar(25 * 3_600_000);
  await receita.ufs(); // 3 tentativas, usa a cópia
  assert.equal(chamadas.length, 4);
  await receita.ufs(); // dentro da sobrevida: nenhuma chamada
  assert.equal(chamadas.length, 4);
  avancar(6 * 60_000);
  await receita.ufs();
  assert.equal(chamadas.length, 5);
});

test("situacoesGuardadas indica se a data já está na memória", async () => {
  const { receita, avancar } = montar([json([{ codigo: "000", descricao: "x", classificacoesTributarias: [{ codigo: "000001", descricao: "y" }] }])]);
  assert.equal(receita.situacoesGuardadas("2026-11-18"), false);
  await receita.situacoes("2026-11-18");
  assert.equal(receita.situacoesGuardadas("2026-11-18"), true);
  avancar(7 * 3_600_000);
  assert.equal(receita.situacoesGuardadas("2026-11-18"), false);
});
