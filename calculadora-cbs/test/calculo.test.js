import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { ErroFormato, ErroPedido, conferirData, montarOperacao, resumirCalculo, traduzirErro, validarPedido } from "../src/calculo.js";

// Pedidos e respostas reais da Calculadora da Receita Federal, capturados em 18/11/2026.
const casos = JSON.parse(fs.readFileSync(new URL("./fixtures/receita.json", import.meta.url), "utf8"));

const base = { valor: "1000.00", data: "2026-11-18", uf: "GO", municipio: "5201108", cst: "000", cClassTrib: "000001" };
const aliquotas = { cbs: "8.8", ibsEstadual: "0.05", ibsMunicipal: "0.05" };
const resumir = (nome, pedido = base) => resumirCalculo(casos[nome].resposta.corpo, { aviso: casos[nome].resposta.cabecalhos["x-warning-dados-simulados"] ?? null, pedido: validarPedido(pedido) });
const recusa = (pedido, campo) =>
  assert.throws(() => validarPedido(pedido), (erro) => erro instanceof ErroPedido && erro.campo === campo, `esperava recusa no campo "${campo}"`);

test("pedido válido é limpo e convertido", () => {
  assert.deepEqual(validarPedido({ ...base, valor: " 1000 " }), {
    valor: "1000", data: "2026-11-18", uf: "GO", municipio: 5201108, cst: "000", cClassTrib: "000001", ncm: null, nbs: null, aliquotas: null,
  });
  assert.equal(validarPedido({ ...base, valor: 1234.5 }).valor, "1234.5");
  assert.equal(validarPedido({ ...base, ncm: "10063021" }).ncm, "10063021");
  assert.equal(validarPedido({ ...base, nbs: "109052100" }).nbs, "109052100");
});

test("cada campo inválido é recusado com a indicação de onde corrigir", () => {
  for (const corpo of [null, [], "x", 5]) assert.throws(() => validarPedido(corpo), ErroPedido);
  for (const valor of ["", "0", "0.00", "-5", "1,50", "1.000,00", "1e3", "abc", "1.234", "12345678901234", null, {}, Infinity]) recusa({ ...base, valor }, "valor");
  for (const data of ["", "18/11/2026", "2026-02-30", "2026-13-01", "2025-12-31", "2034-01-01", "2026-1-1", null]) recusa({ ...base, data }, "data");
  for (const uf of ["", "go", "GOI", "G", 52]) recusa({ ...base, uf }, "uf");
  for (const municipio of ["", "520110", "52011080", "abcdefg", null]) recusa({ ...base, municipio }, "municipio");
  for (const cst of ["", "0", "0000", "abc"]) recusa({ ...base, cst }, "cst");
  for (const cClassTrib of ["", "1", "0000010", "abcdef"]) recusa({ ...base, cClassTrib }, "cClassTrib");
  for (const ncm of ["1006302", "100630210", "1006.30.21", "abcdefgh"]) recusa({ ...base, ncm }, "ncm");
  for (const nbs of ["10905210", "1090521000", "1.0905.21.00"]) recusa({ ...base, nbs }, "nbs");
  recusa({ ...base, ncm: "10063021", nbs: "109052100" }, "nbs");
});

test("a data precisa existir e estar entre 2026 e 2033", () => {
  assert.equal(conferirData("2026-01-01"), "2026-01-01");
  assert.equal(conferirData("2028-02-29"), "2028-02-29"); // 2028 é bissexto
  assert.equal(conferirData("2033-12-31"), "2033-12-31");
  for (const data of ["2027-02-29", "2025-12-31", "2034-01-01", undefined, 20261118]) assert.throws(() => conferirData(data), ErroPedido);
});

test("a partir de 2027 as três alíquotas da simulação são obrigatórias", () => {
  const em2027 = { ...base, data: "2027-01-01" };
  recusa(em2027, "aliquotaCbs");
  recusa({ ...em2027, aliquotas: { cbs: "8.8" } }, "aliquotaIbsUf");
  recusa({ ...em2027, aliquotas: { cbs: "8.8", ibsEstadual: "0.05" } }, "aliquotaIbsMun");
  for (const cbs of ["", "100.01", "101", "-1", "8,8", "1.23456", "abc"]) recusa({ ...em2027, aliquotas: { ...aliquotas, cbs } }, "aliquotaCbs");
  assert.deepEqual(validarPedido({ ...em2027, aliquotas }).aliquotas, aliquotas);
  assert.deepEqual(validarPedido({ ...em2027, aliquotas: { cbs: 0, ibsEstadual: 100, ibsMunicipal: "0.0001" } }).aliquotas, { cbs: "0", ibsEstadual: "100", ibsMunicipal: "0.0001" });
});

test("em 2026 as alíquotas informadas são ignoradas (a Receita usa as vigentes)", () => {
  assert.equal(validarPedido({ ...base, data: "2026-12-31", aliquotas }).aliquotas, null);
  assert.equal(montarOperacao(validarPedido({ ...base, aliquotas }), "x").itens[0].aliquotasNominais, undefined);
});

test("a operação enviada é igual à que foi testada ao vivo na Receita", () => {
  assert.deepEqual(montarOperacao(validarPedido({ ...base, valor: "1000" }), "fixture"), casos.integral.pedido);
  assert.deepEqual(montarOperacao(validarPedido({ ...base, cst: "200", cClassTrib: "200003", ncm: "10063021" }), "fixture"), casos.aliquotaZero.pedido);
  assert.deepEqual(montarOperacao(validarPedido({ ...base, data: "2027-03-18", aliquotas }), "fixture"), casos.simulado2027.pedido);
});

test("valores com centavos chegam exatos à Receita", () => {
  assert.equal(montarOperacao(validarPedido({ ...base, valor: "0.01" }), "x").itens[0].baseCalculo, 0.01);
  assert.equal(JSON.stringify(montarOperacao(validarPedido({ ...base, valor: "9999999999999.99" }), "x").itens[0].baseCalculo), "9999999999999.99");
});

test("tributação integral: CBS 0,9% e IBS 0,1% em 2026", () => {
  const r = resumir("integral");
  assert.equal(r.total, "10.00");
  assert.equal(r.base, "1000.00");
  assert.equal(r.valorInformado, "1000.00");
  assert.deepEqual(r.cbs, { aliquota: "0.90", reducao: null, efetiva: null, valor: "9.00", diferido: "0.00", devolvido: "0.00" });
  assert.deepEqual(r.ibsUf, { aliquota: "0.10", reducao: null, efetiva: null, valor: "1.00", diferido: "0.00", devolvido: "0.00" });
  assert.equal(r.ibsMun.valor, "0.00");
  assert.equal(r.semIncidencia, false);
  assert.equal(r.simulado, false);
  assert.equal(r.aviso, null);
  assert.match(r.memoria.cbs, /alíquota de 0,90%/);
  assert.match(r.memoria.ibsUf, /0,10%/);
});

test("alíquota reduzida: mostra a alíquota padrão, a redução e a efetiva", () => {
  const r = resumir("reducao60", { ...base, cst: "011", cClassTrib: "011001" });
  assert.equal(r.cbs.aliquota, "0.90");
  assert.equal(r.cbs.reducao, "60.00");
  assert.equal(r.cbs.efetiva, "0.36");
  assert.equal(r.cbs.valor, "3.60");
  assert.equal(r.ibsUf.valor, "0.40");
  assert.equal(r.total, "4.00");
});

test("alíquota zero (cesta básica): total zero com 100% de redução", () => {
  const r = resumir("aliquotaZero", { ...base, cst: "200", cClassTrib: "200003", ncm: "10063021" });
  assert.equal(r.total, "0.00");
  assert.equal(r.cbs.reducao, "100.00");
  assert.equal(r.cbs.efetiva, "0.00");
  assert.equal(r.semIncidencia, false);
});

test("isenção: a Receita não devolve alíquotas e o total é zero", () => {
  const r = resumir("semIncidencia", { ...base, cst: "400", cClassTrib: "400001" });
  assert.equal(r.semIncidencia, true);
  assert.equal(r.total, "0.00");
  assert.equal(r.cbs.aliquota, null);
  assert.equal(r.ibsUf.aliquota, null);
  assert.match(r.memoria.cbs, /Isenção/);
});

test("diferimento: nada a pagar na operação e o valor diferido aparece à parte", () => {
  const r = resumir("diferimento", { ...base, cst: "510", cClassTrib: "510001" });
  assert.equal(r.total, "0.00");
  assert.equal(r.cbs.diferido, "9.00");
  assert.equal(r.ibsUf.diferido, "1.00");
  assert.equal(r.diferido, "10.00");
});

test("redução de base de cálculo: a base usada difere do valor informado", () => {
  const r = resumir("baseReduzida", { ...base, cst: "222", cClassTrib: "222001" });
  assert.equal(r.valorInformado, "1000.00");
  assert.equal(r.base, "500.00");
  assert.equal(r.total, "5.00");
});

test("avisos de valores simulados da Receita viram texto", () => {
  const semLei = resumir("aliquotaNaoDefinida", { ...base, cst: "010", cClassTrib: "010002" });
  assert.equal(semLei.simulado, true);
  assert.match(semLei.aviso, /ainda não foi definida em lei/);

  const informadas = resumir("simulado2027", { ...base, data: "2027-03-18", aliquotas });
  assert.equal(informadas.simulado, true);
  assert.match(informadas.aviso, /alíquotas que você informou/);
  assert.equal(informadas.cbs.aliquota, "8.80");
  assert.equal(informadas.cbs.valor, "88.00");
  assert.equal(informadas.ibsUf.valor, "0.50");
  assert.equal(informadas.ibsMun.valor, "0.50");
  assert.equal(informadas.total, "89.00");
});

test("somas são feitas em centavos, sem erro de ponto flutuante", () => {
  const corpo = structuredClone(casos.integral.resposta.corpo);
  const totais = corpo.total.tribCalc.IBSCBSTot;
  totais.gCBS.vCBS = "0.10";
  totais.gIBS.gIBSUF.vIBSUF = "0.20";
  totais.gIBS.gIBSMun.vIBSMun = 0.3; // também aceita número
  assert.equal(resumirCalculo(corpo, { pedido: validarPedido(base) }).total, "0.60");
  totais.gCBS.vCBS = "8888888888888.88";
  totais.gIBS.gIBSUF.vIBSUF = "1111111111111.11";
  totais.gIBS.gIBSMun.vIBSMun = "0.01";
  assert.equal(resumirCalculo(corpo, { pedido: validarPedido(base) }).total, "10000000000000.00");
});

test("resposta fora do formato é recusada, nunca mostrada como zero", () => {
  const pedido = validarPedido(base);
  const alterar = (mudanca) => {
    const corpo = structuredClone(casos.integral.resposta.corpo);
    mudanca(corpo);
    return () => resumirCalculo(corpo, { pedido });
  };
  for (const corpo of [null, {}, { objetos: [] }, { objetos: [{}], total: {} }, "texto"]) assert.throws(() => resumirCalculo(corpo, { pedido }), ErroFormato);
  assert.throws(alterar((c) => delete c.total), ErroFormato);
  assert.throws(alterar((c) => delete c.total.tribCalc.IBSCBSTot.gCBS.vCBS), ErroFormato);
  assert.throws(alterar((c) => (c.total.tribCalc.IBSCBSTot.gCBS.vCBS = "9.000")), ErroFormato);
  assert.throws(alterar((c) => (c.total.tribCalc.IBSCBSTot.gCBS.vCBS = "nove")), ErroFormato);
  assert.throws(alterar((c) => (c.total.tribCalc.IBSCBSTot.gIBS.gIBSUF.vDif = "x")), ErroFormato);
  assert.throws(alterar((c) => (c.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.pCBS = "0,90")), ErroFormato);
  assert.throws(alterar((c) => delete c.total.tribCalc.IBSCBSTot.vBCIBSCBS && delete c.objetos[0].tribCalc.IBSCBS.gIBSCBS.vBC), ErroFormato);
  assert.doesNotThrow(alterar((c) => delete c.objetos[0].tribCalc.IBSCBS.memoriaCalculo));
  assert.doesNotThrow(alterar((c) => delete c.total.tribCalc.IBSCBSTot.gCBS.vDif));
});

test("código de aviso desconhecido não vira texto nem quebra o cálculo", () => {
  const r = resumirCalculo(casos.integral.resposta.corpo, { aviso: "9", pedido: validarPedido(base) });
  assert.equal(r.aviso, null);
  assert.equal(r.simulado, false);
});

test("recusas da Receita viram mensagens com o campo a corrigir", () => {
  const erro = (nome) => traduzirErro(casos[nome].resposta.corpo);
  assert.deepEqual(erro("erroNcm"), { erro: "NCM completo não informado", detalhe: "Esta classificação exige o NCM completo da mercadoria (8 dígitos).", campo: "ncm" });
  assert.equal(erro("erroNbs").campo, "nbs");
  assert.match(erro("erroNbs").detalhe, /NBS completo do serviço/);
  assert.equal(erro("erroTributacaoRegular").campo, "cClassTrib");
  assert.match(erro("erroTributacaoRegular").detalhe, /tributação regular/);
  assert.equal(erro("erroImpostoSeletivo").campo, "ncm");
  assert.match(erro("erroImpostoSeletivo").detalhe, /Imposto Seletivo/);
  assert.equal(erro("erroMunicipioUf").campo, "municipio");
  assert.match(erro("erroMunicipioUf").detalhe, /não pertence à UF/);
  assert.equal(erro("erroNaoEncontrada").campo, "cClassTrib");
  assert.equal(erro("erroAliquotasAusentes").campo, "aliquotaCbs");
  assert.equal(erro("erroEmDesenvolvimento").campo, null);
  assert.match(erro("erroEmDesenvolvimento").detalhe, /ainda não possui tratamento/);
});

test("recusa sem explicação recebe uma mensagem padrão", () => {
  for (const problema of [null, undefined, {}, "x", { type: "https://x/errors/../../etc" }]) {
    assert.deepEqual(traduzirErro(problema), { erro: "A Receita Federal não conseguiu calcular esta operação.", detalhe: null, campo: null });
  }
  assert.deepEqual(traduzirErro({ title: "Igual", detail: "Igual" }), { erro: "Igual", detalhe: null, campo: null });
  assert.equal(traduzirErro({ title: "t".repeat(500) }).erro.length, 200);
});
