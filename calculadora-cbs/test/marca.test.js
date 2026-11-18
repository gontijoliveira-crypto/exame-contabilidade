import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { carregarMarca, carregarSimulacao, lerConfig, lerOrigemDoIp, lerProxies, lerUrlPublica } from "../src/config.js";
import { conferirData } from "../src/calculo.js";
import { contraste, cssDaMarca, iconeDaMarca, legivelSobre, textoSobre } from "../src/marca.js";

const EXPO = { primaria: "#011433", primariaClara: "#1F4FA8", destaque: "#D9911C" };
const AZUL_E_AMARELO = { primaria: "#0B2A6F", primariaClara: "#1F56C3", destaque: "#FFCC1A" };
const CLARA = { primaria: "#F2F2F2", primariaClara: "#9AD0FF", destaque: "#222222" };
const variavel = (css, nome, bloco = 0) => new RegExp(`--${nome}: (#[0-9A-F]{6});`, "g").exec(css.split("@media")[bloco])?.[1];

test("contraste segue a fórmula da WCAG", () => {
  assert.equal(contraste("#000000", "#FFFFFF"), 21);
  assert.equal(contraste("#FFFFFF", "#000000"), 21);
  assert.equal(contraste("#777777", "#777777"), 1);
  assert.ok(Math.abs(contraste("#767676", "#FFFFFF") - 4.54) < 0.01);
});

test("a marca da Expo está configurada e os arquivos existem", () => {
  const marca = carregarMarca();
  assert.equal(marca.nome, "Expo Contabilidade e Consultoria");
  assert.deepEqual(marca.cores, EXPO);
  assert.equal(marca.logo, "marca/logo-expo.png");
  assert.equal(marca.icone, "marca/icone-expo.png");
});

test("as cores derivadas da marca são sempre legíveis (contraste de texto 4,5:1)", () => {
  for (const cores of [EXPO, AZUL_E_AMARELO, CLARA]) {
    const css = cssDaMarca(cores);
    assert.equal(variavel(css, "azul"), cores.primaria.toUpperCase());
    assert.equal(variavel(css, "amarelo"), cores.destaque.toUpperCase());
    assert.ok(contraste(variavel(css, "sobre-azul"), cores.primaria) >= 4.5, "texto sobre a cor principal");
    assert.ok(contraste(variavel(css, "sobre-amarelo"), cores.destaque) >= 4.5, "texto do botão");
    assert.ok(contraste(variavel(css, "amarelo-no-azul"), cores.primaria) >= 4.5, "destaque sobre a capa");
    assert.ok(contraste(variavel(css, "amarelo-texto"), "#FFFFFF") >= 4.5, "destaque como texto no tema claro");
    assert.ok(contraste(variavel(css, "azul-texto"), "#FFFFFF") >= 4.5, "links no tema claro");
    assert.ok(contraste(variavel(css, "amarelo-texto", 1), "#111C33") >= 4.5, "destaque como texto no tema escuro");
    assert.ok(contraste(variavel(css, "azul-texto", 1), "#111C33") >= 4.5, "links no tema escuro");
  }
});

test("na marca da Expo, o dourado e o azul originais são mantidos onde já são legíveis", () => {
  const css = cssDaMarca(EXPO);
  assert.equal(variavel(css, "sobre-azul"), "#FFFFFF");
  assert.equal(variavel(css, "sobre-amarelo"), "#1A1200");
  assert.equal(variavel(css, "amarelo-no-azul"), "#D9911C");
  assert.equal(variavel(css, "azul-texto"), "#1F4FA8");
  assert.equal(variavel(css, "amarelo-texto", 1), "#D9911C");
});

test("legivelSobre e textoSobre escolhem o lado certo", () => {
  assert.equal(textoSobre("#011433"), "#FFFFFF");
  assert.equal(textoSobre("#FFCC1A"), "#1A1200");
  assert.equal(legivelSobre("#000000", "#FFFFFF"), "#000000");
  assert.ok(contraste(legivelSobre("#FFFF00", "#FFFFFF"), "#FFFFFF") >= 4.5);
  assert.ok(contraste(legivelSobre("#000033", "#000000"), "#000000") >= 4.5);
});

test("ícone de reserva usa a inicial do escritório e não aceita marcação", () => {
  assert.match(iconeDaMarca({ nome: "expo", cores: EXPO }), />E<\/text>/);
  const svg = iconeDaMarca({ nome: `<"&'> & cia`, cores: EXPO });
  assert.match(svg, />C<\/text>/);
  assert.equal(svg.match(/[<>]/g).length, 12, "só as marcas do próprio desenho");
  assert.match(iconeDaMarca({ nome: "!!!", cores: EXPO }), />\?<\/text>/);
  assert.match(svg, /fill="#011433"/);
});

test("marca.json inválido é recusado com uma explicação", () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "marca-"));
  fs.mkdirSync(path.join(pasta, "config"));
  fs.mkdirSync(path.join(pasta, "public", "marca"), { recursive: true });
  fs.writeFileSync(path.join(pasta, "public", "marca", "logo.png"), "x");
  const gravar = (marca) => fs.writeFileSync(path.join(pasta, "config", "marca.json"), JSON.stringify(marca));
  const valida = { nome: "Escritório", cores: EXPO, logo: "marca/logo.png" };

  gravar(valida);
  assert.deepEqual(carregarMarca(pasta), { nome: "Escritório", subtitulo: null, logo: "marca/logo.png", icone: null, compartilhar: null, cores: EXPO });
  gravar({ ...valida, nome: "  " });
  assert.throws(() => carregarMarca(pasta), /nome/);
  gravar({ ...valida, cores: { ...EXPO, destaque: "dourado" } });
  assert.throws(() => carregarMarca(pasta), /destaque/);
  gravar({ ...valida, cores: { ...EXPO, primaria: "#011433; } body { display: none" } });
  assert.throws(() => carregarMarca(pasta), /primaria/);
  gravar({ nome: "Sem cores" });
  assert.throws(() => carregarMarca(pasta), /primaria/);
  gravar({ ...valida, logo: "marca/nao-existe.png" });
  assert.throws(() => carregarMarca(pasta), /não encontrado/);
  for (const logo of ["../config/marca.json", "/etc/passwd", 'marca/x.png" onerror="alert(1)', "marca/../../x.png"]) {
    gravar({ ...valida, logo });
    assert.throws(() => carregarMarca(pasta), /caminho simples/, logo);
  }
  fs.rmSync(pasta, { recursive: true, force: true });
});

test("endereço público: explícito, do Railway ou nenhum", () => {
  assert.equal(lerUrlPublica({}), "");
  assert.equal(lerUrlPublica({ URL_PUBLICA: "https://calc.exemplo.com.br/" }), "https://calc.exemplo.com.br");
  assert.equal(lerUrlPublica({ URL_PUBLICA: " https://calc.exemplo.com.br/pagina?x=1 " }), "https://calc.exemplo.com.br");
  assert.equal(lerUrlPublica({ RAILWAY_PUBLIC_DOMAIN: "calculadora-production.up.railway.app" }), "https://calculadora-production.up.railway.app");
  assert.equal(lerUrlPublica({ URL_PUBLICA: "https://meu.dominio", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }), "https://meu.dominio");
  assert.throws(() => lerUrlPublica({ URL_PUBLICA: "calc.exemplo.com.br" }), /URL_PUBLICA inválida/);
  assert.throws(() => lerUrlPublica({ URL_PUBLICA: "javascript:alert(1)" }), /URL_PUBLICA inválida/);
  assert.equal(lerUrlPublica({ RAILWAY_PUBLIC_DOMAIN: "isto não é domínio" }), "");
});

test("configuração: porta, proxies e endereço da Receita", () => {
  assert.equal(lerConfig({}).porta, 3000);
  assert.equal(lerConfig({ PORT: "8080" }).porta, 8080);
  assert.equal(lerConfig({ PORT: "8080", PORTA: "3001" }).porta, 3001);
  assert.throws(() => lerConfig({ PORT: "abc" }), /Porta inválida/);
  assert.equal(lerConfig({}).receitaApi, "https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api");
  assert.equal(lerConfig({ RECEITA_API: "http://localhost:8080/api/" }).receitaApi, "http://localhost:8080/api");
  assert.throws(() => lerConfig({ RECEITA_API: "ftp://x" }), /RECEITA_API inválida/);
  assert.equal(lerProxies({}), 0);
  assert.equal(lerProxies({ TRUST_PROXY: "1" }), 1);
  assert.throws(() => lerProxies({ TRUST_PROXY: "true" }), /TRUST_PROXY inválido/);
});

test("origem do IP do visitante: detectada no Railway, configurável fora dele", () => {
  assert.deepEqual(lerOrigemDoIp({}), { cabecalhoIp: "", proxies: 0 });
  assert.deepEqual(lerOrigemDoIp({ TRUST_PROXY: "2" }), { cabecalhoIp: "", proxies: 2 });
  assert.deepEqual(lerOrigemDoIp({ RAILWAY_PROJECT_ID: "abc" }), { cabecalhoIp: "x-real-ip", proxies: 1 });
  assert.deepEqual(lerOrigemDoIp({ RAILWAY_ENVIRONMENT_NAME: "production", CABECALHO_IP: "Fly-Client-IP", TRUST_PROXY: "3" }), { cabecalhoIp: "fly-client-ip", proxies: 3 });
  assert.throws(() => lerOrigemDoIp({ CABECALHO_IP: "x real ip" }), /CABECALHO_IP inválido/);
  assert.deepEqual(lerConfig({ RAILWAY_SERVICE_ID: "x" }).origemDoIp, { cabecalhoIp: "x-real-ip", proxies: 1 });
});

test("apoio à simulação: o arquivo do projeto é válido e cobre de 2027 a 2033 sem buracos", () => {
  const periodos = carregarSimulacao();
  assert.ok(periodos.length >= 1);
  assert.equal(periodos[0].de, "2027-01-01");
  assert.equal(periodos.at(-1).ate, "2033-12-31");
  for (const [i, p] of periodos.entries()) {
    assert.equal(conferirData(p.de), p.de);
    assert.equal(conferirData(p.ate), p.ate);
    if (i > 0) {
      const diaSeguinte = new Date(`${periodos[i - 1].ate}T00:00:00Z`);
      diaSeguinte.setUTCDate(diaSeguinte.getUTCDate() + 1);
      assert.equal(p.de, diaSeguinte.toISOString().slice(0, 10), "cada período começa no dia seguinte ao fim do anterior");
    }
    assert.ok(p.nota.length > 20);
  }
  // Em 2027 e 2028 o IBS é fixado na Constituição (ADCT, art. 127): 0,05% estadual + 0,05% municipal.
  for (const p of periodos.filter((x) => x.de < "2029-01-01")) assert.deepEqual({ uf: p.preencher.ibsEstadual, mun: p.preencher.ibsMunicipal }, { uf: "0.05", mun: "0.05" });
  // A alíquota da CBS ainda não é lei: pode aparecer como exemplo, nunca já preenchida.
  for (const p of periodos) assert.equal(p.preencher.cbs, undefined);
});

test("apoio à simulação: arquivo ausente é aceito; arquivo inválido é recusado com explicação", () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "simulacao-"));
  fs.mkdirSync(path.join(pasta, "config"));
  assert.deepEqual(carregarSimulacao(pasta), []);
  const gravar = (conteudo) => fs.writeFileSync(path.join(pasta, "config", "simulacao.json"), JSON.stringify(conteudo));
  gravar({ periodos: [{ de: "2027-01-01", ate: "2027-12-31", preencher: { cbs: "8.8", ibsEstadual: "" }, nota: " ok " }] });
  assert.deepEqual(carregarSimulacao(pasta), [{ de: "2027-01-01", ate: "2027-12-31", preencher: { cbs: "8.8" }, exemplo: {}, nota: "ok" }]);
  for (const [ruim, motivo] of [
    [{ periodos: "x" }, /lista/],
    [{ periodos: [{ de: "2027", ate: "2027-12-31" }] }, /AAAA-MM-DD/],
    [{ periodos: [{ de: "2028-01-01", ate: "2027-12-31" }] }, /antes de/],
    [{ periodos: [{ de: "2027-01-01", ate: "2027-12-31", preencher: { cbs: 8.8 } }] }, /entre aspas/],
    [{ periodos: [{ de: "2027-01-01", ate: "2027-12-31", exemplo: { cbs: "8,8" } }] }, /exemplo\.cbs/],
    [{ periodos: [{ de: "2027-01-01", ate: "2027-12-31", preencher: { cbs: "101" } }] }, /percentual/],
    [{ periodos: [{ de: "2027-01-01", ate: "2027-12-31", nota: 5 }] }, /nota/],
  ]) {
    gravar(ruim);
    assert.throws(() => carregarSimulacao(pasta), motivo);
  }
  fs.rmSync(pasta, { recursive: true, force: true });
});
