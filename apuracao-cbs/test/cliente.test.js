import assert from "node:assert/strict";
import { test } from "node:test";
import { COTA_DIARIA, ErroDaApi, ErroDeCota, criarCliente, hojeEmBrasilia } from "../src/cliente.js";
import { resumirRecolhimentos, textoDoResumo } from "../src/resumo.js";
import { ErroDeEntrada, cnpjBase, cnpjCompleto, cnpjValido, chaveDfe, periodo, valorEmReais } from "../src/validacao.js";

// Exemplos copiados da documentação oficial (docs.receitafederal.gov.br/apuracao-cbs, versões de 13/11/2026).
const RECOLHIMENTOS = {
  tiqueteSolicitacao: "48d88a3c-eff9-4489-8e3a-cde8d878d3f7.1E0CE7A4",
  ni: "12345678",
  niConsumidor: "12345678000114",
  geradoEm: "2026-08-27T19:03:44Z",
  apuracao: [
    {
      dataArrecadacao: "2026-08-27",
      pagamentos: [
        {
          numeroDARF: "20260827000000001",
          tipo: 1,
          composicao: [
            { sequencial: 1, pa: "08/2026", vencimento: "2026-09-20", niFornecedor: "98765432000199", chaveDFE: "35260898765432000199550010000001231234567890", principal: 100.0, multa: 10.0, juros: 5.0, total: 115.0 },
          ],
        },
      ],
    },
  ],
};
const DARF_OK = {
  cdRetorno: "DARF_GERADO",
  darf: { chavePIX: "1".repeat(44), codigoBarras: "85870000001512345678901234567890123456789012", linkDarfPDF: "https://api.receitafederal.gov.br/darf/x.pdf" },
  informacoesPagamento: { dataMaximaPagamento: "2026-08-13", valorDarfPrincipal: 115.55, valorDarfTotal: 115.55 },
};
const CNPJ = "63334737000160"; // Expo Contabilidade e Consultoria
const CHAVE = "35260912345678000123550010000000011000000010";

const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

/** Receita de mentira: `rotas` é uma lista de [método, regex da URL, resposta ou função]. */
function montar(rotas, opcoes = {}) {
  const chamadas = [];
  let relogio = Date.parse("2026-11-25T15:00:00Z");
  const cliente = criarCliente({
    clientId: "id-de-teste",
    clientSecret: "segredo-de-teste",
    buscar: async (url, init = {}) => {
      chamadas.push({ url, metodo: init.method || "GET", cabecalhos: init.headers || {}, corpo: init.body });
      const rota = rotas.find(([m, r]) => m === (init.method || "GET") && r.test(url));
      if (!rota) throw new Error(`rota não prevista: ${init.method || "GET"} ${url}`);
      const r = rota[2];
      return typeof r === "function" ? r(url, init) : r.clone();
    },
    agora: () => new Date(relogio),
    esperar: async (ms) => { relogio += ms; },
    ...opcoes,
  });
  return { cliente, chamadas, avancar: (ms) => { relogio += ms; } };
}

const TOKEN = ["POST", /\/token$/, json({ access_token: "tok-1", token_type: "Bearer", expires_in: 3600 })];

test("validação: CNPJ com dígito verificador, raiz, chave, valores e período", () => {
  assert.equal(cnpjValido(CNPJ), true);
  assert.equal(cnpjValido("63334737000161"), false);
  assert.equal(cnpjValido("11111111111111"), false);
  assert.equal(cnpjCompleto("63.334.737/0001-60"), CNPJ);
  assert.equal(cnpjBase("63.334.737/0001-60"), "63334737");
  assert.equal(cnpjBase("63334737"), "63334737");
  assert.throws(() => cnpjCompleto("63334737"), ErroDeEntrada);
  assert.equal(chaveDfe("3526 0912 3456 7800 0123 5500 1000 0000 0110 0000 0010"), CHAVE);
  assert.throws(() => chaveDfe("123"), ErroDeEntrada);
  assert.deepEqual(["1.500,75", "1500,75", "1500.75", 1500.75, "R$ 2.000,00", "1.500"].map(valorEmReais), [1500.75, 1500.75, 1500.75, 1500.75, 2000, 1500]);
  for (const ruim of ["0", "-1", "1,234", "abc", "", null]) assert.throws(() => valorEmReais(ruim), ErroDeEntrada, String(ruim));
  assert.equal(periodo("08/2026"), "08/2026");
  for (const ruim of ["8/2026", "13/2026", "08-2026", "2026-08"]) assert.throws(() => periodo(ruim), ErroDeEntrada);
});

test("sem credencial, o cliente não é criado", () => {
  assert.throws(() => criarCliente({ clientId: "", clientSecret: "x" }), /RECEITA_CLIENT_ID/);
});

test("token: client credentials com Basic, guardado e renovado só perto de vencer", async () => {
  let emitidos = 0;
  const { cliente, chamadas, avancar } = montar([
    ["POST", /\/token$/, () => json({ access_token: `tok-${++emitidos}`, expires_in: 3600 })],
    ["GET", /\/situacao\//, json({ situacao: "PENDENTE" })],
  ]);
  await cliente.situacao("abc123.XYZ");
  await cliente.situacao("abc123.XYZ");
  const pedidoToken = chamadas[0];
  assert.equal(pedidoToken.url, "https://api.receitafederal.gov.br/token");
  assert.equal(pedidoToken.cabecalhos.authorization, `Basic ${Buffer.from("id-de-teste:segredo-de-teste").toString("base64")}`);
  assert.equal(pedidoToken.corpo, "grant_type=client_credentials");
  assert.equal(chamadas.filter((c) => c.url.endsWith("/token")).length, 1);
  assert.equal(chamadas[1].cabecalhos.authorization, "Bearer tok-1");
  avancar(3550 * 1000); // a menos de 1 minuto do vencimento
  await cliente.situacao("abc123.XYZ");
  assert.equal(chamadas.at(-1).cabecalhos.authorization, "Bearer tok-2");
});

test("token recusado vira mensagem clara, sem expor o segredo", async () => {
  const { cliente } = montar([["POST", /\/token$/, json({ error: "invalid_client" }, 401)]]);
  await assert.rejects(cliente.situacao("abc123.XYZ"), (e) => e instanceof ErroDaApi && /credencial/.test(e.message) && !e.message.includes("segredo-de-teste"));
});

test("401 com token guardado: pede outro token uma vez e repete", async () => {
  let emitidos = 0;
  let tentativa = 0;
  const { cliente } = montar([
    ["POST", /\/token$/, () => json({ access_token: `tok-${++emitidos}`, expires_in: 3600 })],
    ["GET", /\/situacao\//, () => (++tentativa === 2 ? json({ codigoErro: "NAO_AUTORIZADO" }, 401) : json({ situacao: "CONCLUIDA" }))],
  ]);
  await cliente.situacao("abc123.XYZ");
  assert.deepEqual(await cliente.situacao("abc123.XYZ"), { situacao: "CONCLUIDA", codigoErro: null, mensagemErro: null });
  assert.equal(emitidos, 2);
});

test("consulta de recolhimentos (RAD): abre, acompanha, baixa pela URL assinada sem token", async () => {
  const etapas = [];
  let consultasDeSituacao = 0;
  const { cliente, chamadas } = montar([
    TOKEN,
    ["POST", /\/apuracao-cbs\/v2\/recolhimentos\/63334737$/, json({ tiqueteSolicitacao: "692b7b25-44cb-4415-8625-2b9522dd7933.B5E08D55", tEASegundos: 120 }, 201)],
    ["GET", /\/situacao\//, () => json({ situacao: ++consultasDeSituacao < 3 ? "EM_PROCESSAMENTO" : "CONCLUIDA" })],
    ["GET", /\/download\//, json({ urlAssinada: "https://storage.exemplo.gov.br/arquivo?X-Amz-Signature=abc", urlAssinadaExpiraEm: "2026-11-27T15:00:00Z" })],
    ["GET", /^https:\/\/storage\.exemplo\.gov\.br\//, json(RECOLHIMENTOS)],
  ]);
  const r = await cliente.consultar("recolhimentos", "63.334.737/0001-60", { aoMudar: (s) => etapas.push(s.situacao) });
  assert.deepEqual(r.arquivo, RECOLHIMENTOS);
  assert.deepEqual(etapas, ["ABERTA", "EM_PROCESSAMENTO", "CONCLUIDA"]);
  const abertura = chamadas.find((c) => c.metodo === "POST" && c.url.includes("/recolhimentos/"));
  assert.deepEqual(JSON.parse(abertura.corpo), { urlRetorno: "" });
  assert.equal(abertura.cabecalhos.authorization, "Bearer tok-1");
  const download = chamadas.find((c) => c.url.startsWith("https://storage."));
  assert.equal(download.cabecalhos.authorization, undefined, "a URL assinada é baixada sem token");
});

test("consulta que termina em erro ou demora demais", async () => {
  const comSituacao = (corpo) => montar([TOKEN, ["POST", /\/debitos\//, json({ tiqueteSolicitacao: "t-123456", tEASegundos: -1 }, 201)], ["GET", /\/situacao\//, json(corpo)]]).cliente;
  await assert.rejects(comSituacao({ situacao: "EXPIRADA", codigoErro: "EXPIRADA", mensagemErro: "Tempo limite de processamento excedido (240 minutos)." }).consultar("debitos", "63334737"), (e) => e.codigo === "EXPIRADA" && /240 minutos/.test(e.message));
  await assert.rejects(comSituacao({ situacao: "EM_PROCESSAMENTO" }).consultar("debitos", "63334737", { maxMinutos: 2 }), (e) => e.codigo === "AINDA_EM_PROCESSAMENTO" && e.dados.tiquete === "t-123456");
});

test("cota: no máximo 4 consultas por tipo e por dia, contadas antes de chamar a Receita", async () => {
  const { cliente, chamadas, avancar } = montar([TOKEN, ["POST", /\/v2\/(debitos|creditos)\//, json({ tiqueteSolicitacao: "t-123456", tEASegundos: 10 }, 201)]]);
  for (let i = 0; i < COTA_DIARIA; i++) await cliente.solicitar("debitos", CNPJ);
  await assert.rejects(cliente.solicitar("debitos", CNPJ), ErroDeCota);
  assert.equal(chamadas.filter((c) => c.url.includes("/debitos/")).length, COTA_DIARIA, "a 5ª nem chega à Receita");
  await cliente.solicitar("creditos", CNPJ); // cota separada por API
  assert.equal(cliente.cotaRestante().debitos, 0);
  assert.equal(cliente.cotaRestante().creditos, 3);
  avancar(24 * 3600 * 1000); // dia seguinte
  await cliente.solicitar("debitos", CNPJ);
  assert.equal(cliente.cotaRestante().debitos, 3);
});

test("a cota reinicia à meia-noite de Brasília, não de Greenwich", () => {
  assert.equal(hojeEmBrasilia(new Date("2026-11-26T02:30:00Z")), "2026-11-25"); // 23h30 em Brasília
  assert.equal(hojeEmBrasilia(new Date("2026-11-26T03:00:00Z")), "2026-11-26");
});

test("tipo de consulta e webhook inválidos são recusados antes de gastar cota", async () => {
  const { cliente } = montar([TOKEN]);
  await assert.rejects(cliente.solicitar("tudo", CNPJ), ErroDeEntrada);
  await assert.rejects(cliente.solicitar("debitos", CNPJ, { webhook: "http://inseguro.exemplo" }), /HTTPS/);
  assert.equal(cliente.cotaRestante().debitos, 4);
});

test("link de download vencido não é usado", async () => {
  const { cliente } = montar([TOKEN, ["GET", /\/download\//, json({ urlAssinada: "https://storage.exemplo.gov.br/a", urlAssinadaExpiraEm: "2026-11-24T00:00:00Z" })]]);
  await assert.rejects(cliente.baixar("t-123456"), (e) => e.codigo === "URL_EXPIRADA");
});

test("arquivo ainda indisponível: 404 com o código da Receita", async () => {
  const { cliente } = montar([TOKEN, ["GET", /\/download\//, json({ codigoErro: "ARQUIVO_INDISPONIVEL", mensagemErro: "Arquivo de retorno indisponível" }, 404)]]);
  await assert.rejects(cliente.baixar("t-123456"), (e) => e.status === 404 && e.codigo === "ARQUIVO_INDISPONIVEL");
});

test("DARF de RAD: total e parcial, no formato da documentação", async () => {
  const { cliente, chamadas } = montar([TOKEN, ["POST", /\/v2\/rad\/63334737000160$/, json(DARF_OK)]]);
  const [r] = await cliente.gerarDarfRad("63.334.737/0001-60", [{ chave: CHAVE, valorParcial: "1.500,75" }]);
  assert.equal(r.chave, CHAVE);
  assert.equal(r.pagamento.valorDarfTotal, 115.55);
  assert.equal(r.darf.linkDarfPDF, "https://api.receitafederal.gov.br/darf/x.pdf");
  assert.deepEqual(JSON.parse(chamadas.at(-1).corpo), [{ chaveDFE: CHAVE, opcaoPagamento: "PAGAMENTO_PARCIAL", valorDarfParcial: 1500.75 }]);
  await cliente.gerarDarfRad(CNPJ, [{ chave: CHAVE }]);
  assert.deepEqual(JSON.parse(chamadas.at(-1).corpo), [{ chaveDFE: CHAVE, opcaoPagamento: "PAGAMENTO_TOTAL" }]);
});

test("DARF de RAD: recusas da Receita viram mensagem por documento", async () => {
  const { cliente } = montar([TOKEN, ["POST", /\/v2\/rad\//, json({ cdRetorno: "CNPJ_NAO_ADQUIRENTE", mensagem: "CNPJ não é o adquirente da DF-e" }, 400)]]);
  const [r] = await cliente.gerarDarfRad(CNPJ, [{ chave: CHAVE }]);
  assert.equal(r.codigo, "CNPJ_NAO_ADQUIRENTE");
  assert.match(r.erro, /não é o adquirente/);
  await assert.rejects(cliente.gerarDarfRad(CNPJ, []), ErroDeEntrada);
  await assert.rejects(cliente.gerarDarfRad("63334737", [{ chave: CHAVE }]), ErroDeEntrada); // exige CNPJ completo
});

test("DARF de PCONT: período e pagamento parcial", async () => {
  const { cliente, chamadas } = montar([TOKEN, ["POST", /\/v2\/pcont\/63334737000160$/, json(DARF_OK)]]);
  const r = await cliente.gerarDarfPcont(CNPJ, { pa: "08/2026" });
  assert.equal(r.pagamento.dataMaximaPagamento, "2026-08-13");
  assert.deepEqual(JSON.parse(chamadas.at(-1).corpo), { pa: "08/2026", opcaoPagamento: "PAGAMENTO_TOTAL" });
  await cliente.gerarDarfPcont(CNPJ, { pa: "08/2026", valorParcial: "500" });
  assert.deepEqual(JSON.parse(chamadas.at(-1).corpo), { pa: "08/2026", opcaoPagamento: "PAGAMENTO_PARCIAL", valorDarfParcial: 500 });
  await assert.rejects(cliente.gerarDarfPcont(CNPJ, { pa: "2026-08" }), ErroDeEntrada);
});

test("resumo do RAD: total por fornecedor e período, em centavos", () => {
  const arquivo = structuredClone(RECOLHIMENTOS);
  arquivo.apuracao[0].pagamentos[0].composicao.push({ ...arquivo.apuracao[0].pagamentos[0].composicao[0], sequencial: 2, principal: 0.1, multa: 0, juros: 0.2, total: 0.3 });
  const r = resumirRecolhimentos(arquivo);
  assert.equal(r.itens, 2);
  assert.equal(r.total, 11530); // R$ 115,30
  assert.deepEqual(r.linhas[0], { fornecedor: "98765432000199", pa: "08/2026", documentos: 2, principal: 10010, multa: 1000, juros: 520, total: 11530 });
  assert.match(textoDoResumo(r), /98\.765\.432\/0001-99/);
  assert.match(textoDoResumo(resumirRecolhimentos({ apuracao: [] })), /Nenhum recolhimento/);
});
