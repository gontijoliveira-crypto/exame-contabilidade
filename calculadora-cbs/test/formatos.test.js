import assert from "node:assert/strict";
import { test } from "node:test";
import { lerPercentual, lerValor, porcento, reais } from "../public/formatos.js";
import { validarPedido } from "../src/calculo.js";

const semEspacoEspecial = (t) => t.replace(/ /g, " ");

test("valores digitados no formato brasileiro são lidos sem perder centavos", () => {
  for (const [digitado, lido] of [
    ["1000", "1000.00"], ["1.000", "1000.00"], ["1.000,00", "1000.00"], ["1.000,5", "1000.50"], ["1000,50", "1000.50"], ["1000.50", "1000.50"],
    ["10.50", "10.50"], ["1.5", "1.50"], ["0,01", "0.01"], ["R$ 2.500,00", "2500.00"], [" 12 345,67 ", "12345.67"], ["1.234.567,89", "1234567.89"],
    ["007", "7.00"], ["0", "0.00"], ["9999999999999,99", "9999999999999.99"],
  ]) assert.equal(lerValor(digitado), lido, digitado);
});

test("o que não é um valor em reais é recusado", () => {
  for (const digitado of ["", "abc", "-10", "1,234", "1.00.000", "1,000.50", "1.000.00", "10,5,0", "1e3", "12345678901234", "1.000,", ",50", "１２３"]) assert.equal(lerValor(digitado), "", digitado);
});

test("tudo o que a página lê é aceito pelo servidor", () => {
  const pedido = { data: "2027-06-01", uf: "GO", municipio: "5201108", cst: "000", cClassTrib: "000001" };
  for (const digitado of ["1", "0,01", "1.000,5", "9999999999999,99"]) {
    for (const aliquota of ["0", "8,8", "0,05", "100", "17,7%", "0.0001"]) {
      const a = lerPercentual(aliquota);
      assert.doesNotThrow(() => validarPedido({ ...pedido, valor: lerValor(digitado), aliquotas: { cbs: a, ibsEstadual: a, ibsMunicipal: a } }), `${digitado} / ${aliquota}`);
    }
  }
});

test("percentuais digitados com vírgula ou ponto", () => {
  for (const [digitado, lido] of [["8,8", "8.8"], ["8.8", "8.8"], ["0,05", "0.05"], ["17,7 %", "17.7"], ["100", "100"], ["0", "0"], ["08,80", "8.80"], ["0,0001", "0.0001"]]) assert.equal(lerPercentual(digitado), lido, digitado);
  for (const digitado of ["", "abc", "-1", "100,01", "101", "1,23456", "8,8,1", "%"]) assert.equal(lerPercentual(digitado), "", digitado);
});

test("formatação para a tela", () => {
  assert.equal(semEspacoEspecial(reais("1234.5")), "R$ 1.234,50");
  assert.equal(semEspacoEspecial(reais("0.00")), "R$ 0,00");
  assert.equal(porcento("0.9"), "0,90%");
  assert.equal(porcento("0.0001"), "0,0001%");
  assert.equal(porcento("100"), "100,00%");
});
