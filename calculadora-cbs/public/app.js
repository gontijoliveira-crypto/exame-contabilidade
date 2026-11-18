// Comportamento da página: carrega as listas, confere o formulário, pede o cálculo ao servidor e mostra o resultado.
import { lerPercentual, lerValor, porcento, reais } from "./formatos.js";

const $ = (id) => document.getElementById(id);
const campos = {
  valor: $("valor"), data: $("data"), uf: $("uf"), municipio: $("municipio"), cst: $("cst"), cClassTrib: $("cClassTrib"),
  ncm: $("ncm"), nbs: $("nbs"), aliquotaCbs: $("aliquotaCbs"), aliquotaIbsUf: $("aliquotaIbsUf"), aliquotaIbsMun: $("aliquotaIbsMun"),
};
const botao = $("calcular");
const INICIO_ALIQUOTAS = "2027-01-01"; // a partir daqui a Receita pede as alíquotas da simulação
let situacoes = [];
let dataDasSituacoes = ""; // data usada na última lista de situações carregada
let listasProntas = false;

// ---------- utilidades ----------
const guardar = (chave, valor) => { try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: segue sem lembrar */ } };
const lembrar = (chave) => { try { return localStorage.getItem(chave) || ""; } catch { return ""; } };

const hojeEmBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

class Falha extends Error {
  constructor(erro, detalhe = null, campo = null) {
    super(erro);
    this.detalhe = detalhe;
    this.campo = campo;
  }
}

async function api(caminho, corpo) {
  let resposta;
  try {
    resposta = await fetch(caminho, corpo ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) } : undefined);
  } catch {
    throw new Falha("Sem conexão com a calculadora.", "Confira a sua internet e tente de novo.");
  }
  let dados = null;
  try { dados = await resposta.json(); } catch { /* resposta sem JSON: tratada abaixo */ }
  if (!resposta.ok || dados === null) {
    throw new Falha((dados && dados.erro) || "Não foi possível concluir o pedido.", (dados && dados.detalhe) || "Tente de novo em instantes.", dados && dados.campo);
  }
  return dados;
}

function preencher(select, itens, rotulo) {
  select.textContent = "";
  select.append(new Option(rotulo, ""));
  for (const item of itens) select.append(new Option(item.rotulo, item.valor));
  select.disabled = itens.length === 0;
}

function mostrarMensagem(caixa, titulo, detalhe) {
  caixa.textContent = "";
  const forte = document.createElement("strong");
  forte.textContent = titulo;
  caixa.append(forte);
  if (detalhe) caixa.append(detalhe);
  caixa.hidden = false;
}

function marcarInvalido(campo) {
  for (const c of Object.values(campos)) c.removeAttribute("aria-invalid");
  if (campo && campos[campo]) {
    campos[campo].setAttribute("aria-invalid", "true");
    campos[campo].focus();
  }
}

// ---------- listas ----------
let pedidoDeMunicipios = 0;
async function carregarMunicipios(preferido = "") {
  const uf = campos.uf.value;
  const pedido = ++pedidoDeMunicipios;
  preencher(campos.municipio, [], uf ? "Carregando…" : "Escolha a UF");
  if (!uf) return;
  try {
    const lista = await api(`/api/municipios?uf=${encodeURIComponent(uf)}`);
    if (pedido !== pedidoDeMunicipios) return; // a UF mudou enquanto a lista vinha
    preencher(campos.municipio, lista.map((m) => ({ valor: String(m.codigo), rotulo: m.nome })), "Selecione");
    if (preferido && lista.some((m) => String(m.codigo) === preferido)) campos.municipio.value = preferido;
  } catch (falha) {
    if (pedido !== pedidoDeMunicipios) return;
    preencher(campos.municipio, [], "Não foi possível carregar");
    mostrarMensagem($("erro-form"), falha.message, falha.detalhe);
  }
}

function carregarClassificacoes(preferida = "") {
  const situacao = situacoes.find((s) => s.codigo === campos.cst.value);
  const lista = situacao ? situacao.classificacoes : [];
  preencher(campos.cClassTrib, lista.map((c) => ({ valor: c.codigo, rotulo: `${c.codigo} · ${c.descricao}` })), situacao ? "Selecione" : "Escolha o CST");
  if (lista.some((c) => c.codigo === preferida)) campos.cClassTrib.value = preferida;
  else if (lista.length === 1) campos.cClassTrib.value = lista[0].codigo;
}

let pedidoDeSituacoes = 0;
async function carregarSituacoes() {
  const data = campos.data.value;
  const pedido = ++pedidoDeSituacoes;
  const anterior = { cst: campos.cst.value, cClassTrib: campos.cClassTrib.value };
  const lista = await api(`/api/situacoes?data=${encodeURIComponent(data)}`);
  if (pedido !== pedidoDeSituacoes) return;
  situacoes = lista;
  dataDasSituacoes = data;
  preencher(campos.cst, lista.map((s) => ({ valor: s.codigo, rotulo: `${s.codigo} · ${s.descricao}` })), "Selecione");
  // Mantém a escolha anterior quando ela existe na nova data; na primeira carga, sugere a regra geral.
  const tem = (codigo) => lista.some((s) => s.codigo === codigo);
  if (tem(anterior.cst)) {
    campos.cst.value = anterior.cst;
    carregarClassificacoes(anterior.cClassTrib);
  } else if (!anterior.cst && tem("000")) {
    campos.cst.value = "000";
    carregarClassificacoes("000001");
  } else {
    carregarClassificacoes();
  }
}

const dataNoPeriodo = () => Boolean(campos.data.value) && campos.data.value >= campos.data.min && campos.data.value <= campos.data.max;

// Apoio à simulação (config/simulacao.json, enviado pelo servidor): por período, alíquotas já preenchidas, exemplos e nota.
const CAMPOS_DE_ALIQUOTA = { cbs: "aliquotaCbs", ibsEstadual: "aliquotaIbsUf", ibsMunicipal: "aliquotaIbsMun" };
let periodos = [];
try { periodos = JSON.parse($("aliquotas").dataset.periodos || "[]"); } catch { /* sem apoio: os campos ficam em branco */ }
const comVirgula = (v) => String(v).replace(".", ",");

function ajustarAliquotas() {
  const ativo = dataNoPeriodo() && campos.data.value >= INICIO_ALIQUOTAS;
  $("aliquotas").hidden = !ativo;
  if (!ativo) return;
  const periodo = periodos.find((p) => campos.data.value >= p.de && campos.data.value <= p.ate) || { preencher: {}, exemplo: {}, nota: "" };
  for (const [chave, id] of Object.entries(CAMPOS_DE_ALIQUOTA)) {
    const campo = campos[id];
    const sugerida = periodo.preencher[chave];
    // Só preenche o que está vazio ou o que a própria página preencheu antes; o que a pessoa digitou é dela.
    if (!campo.value || campo.dataset.sugerida === campo.value) {
      campo.value = sugerida ? comVirgula(sugerida) : "";
      if (sugerida) campo.dataset.sugerida = campo.value;
      else delete campo.dataset.sugerida;
    }
    campo.placeholder = periodo.exemplo[chave] ? `ex.: ${comVirgula(periodo.exemplo[chave])}` : "0,00";
  }
  $("nota-aliquotas").textContent = periodo.nota;
  $("nota-aliquotas").hidden = !periodo.nota;
}

async function iniciar() {
  $("erro-inicio").hidden = true;
  botao.disabled = true;
  listasProntas = false;
  try {
    const [ufs] = await Promise.all([api("/api/ufs"), carregarSituacoes()]);
    preencher(campos.uf, ufs.map((u) => ({ valor: u.sigla, rotulo: `${u.sigla} · ${u.nome}` })), "Selecione");
    const ufLembrada = lembrar("calculadora-uf");
    if (ufs.some((u) => u.sigla === ufLembrada)) {
      campos.uf.value = ufLembrada;
      carregarMunicipios(lembrar("calculadora-municipio"));
    }
    listasProntas = true;
    botao.disabled = false;
    // Se a data foi trocada enquanto as listas vinham, busca as situações da data atual.
    if (dataNoPeriodo() && campos.data.value !== dataDasSituacoes) await carregarSituacoes();
  } catch (falha) {
    $("erro-inicio-texto").textContent = `${falha.message} ${falha.detalhe || ""}`.trim();
    $("erro-inicio").hidden = false;
  }
  api("/api/versao")
    .then((v) => {
      if (!v.app || !v.base) return;
      const dataBase = /^\d{4}-\d{2}-\d{2}$/.test(v.dataBase) ? ` de ${v.dataBase.split("-").reverse().join("/")}` : "";
      $("fonte").textContent = `Fonte: Calculadora de Tributos da Receita Federal. Versão ${v.app}, base de dados ${v.base}${dataBase}.`;
      $("fonte").hidden = false;
    })
    .catch(() => { /* a linha da fonte é só informativa */ });
}

// ---------- cálculo ----------
function lerFormulario() {
  const valor = lerValor(campos.valor.value);
  if (!valor || Number(valor) <= 0) throw new Falha("Informe o valor da operação, por exemplo 1.000,00.", null, "valor");
  if (!campos.data.value) throw new Falha("Informe a data do fato gerador.", null, "data");
  if (!dataNoPeriodo()) throw new Falha("A data do fato gerador deve estar entre 01/01/2026 e 31/12/2033.", null, "data");
  if (!campos.uf.value) throw new Falha("Escolha a UF.", null, "uf");
  if (!campos.municipio.value) throw new Falha("Escolha o município.", null, "municipio");
  if (!campos.cst.value) throw new Falha("Escolha a situação tributária (CST).", null, "cst");
  if (!campos.cClassTrib.value) throw new Falha("Escolha a classificação tributária.", null, "cClassTrib");
  const ncm = campos.ncm.value.replace(/[.\s-]/g, "");
  if (ncm && !/^\d{8}$/.test(ncm)) throw new Falha("O NCM deve ter 8 dígitos.", null, "ncm");
  const nbs = campos.nbs.value.replace(/[.\s-]/g, "");
  if (nbs && !/^\d{9}$/.test(nbs)) throw new Falha("O NBS deve ter 9 dígitos.", null, "nbs");
  if (ncm && nbs) throw new Falha("Informe o NCM (mercadoria) ou o NBS (serviço), não os dois.", null, "nbs");

  const pedido = { valor, data: campos.data.value, uf: campos.uf.value, municipio: campos.municipio.value, cst: campos.cst.value, cClassTrib: campos.cClassTrib.value };
  if (ncm) pedido.ncm = ncm;
  if (nbs) pedido.nbs = nbs;
  if (campos.data.value >= INICIO_ALIQUOTAS) {
    pedido.aliquotas = {};
    for (const [chave, campo, nome] of [["cbs", "aliquotaCbs", "da CBS"], ["ibsEstadual", "aliquotaIbsUf", "do IBS estadual"], ["ibsMunicipal", "aliquotaIbsMun", "do IBS municipal"]]) {
      const v = lerPercentual(campos[campo].value);
      if (!v) throw new Falha(`Informe a alíquota ${nome} para a simulação (entre 0 e 100%).`, null, campo);
      pedido.aliquotas[chave] = v;
    }
  }
  return pedido;
}

function linhaDoTributo(prefixo, t) {
  const aliquota = $(`${prefixo}-aliquota`);
  const valor = $(`${prefixo}-valor`);
  aliquota.textContent = "";
  valor.textContent = reais(t.valor);
  if (t.aliquota === null) {
    aliquota.textContent = "—";
  } else {
    aliquota.append(porcento(t.efetiva !== null ? t.efetiva : t.aliquota));
    if (t.reducao !== null) {
      const nota = document.createElement("small");
      nota.textContent = `padrão ${porcento(t.aliquota)}, redução de ${porcento(t.reducao)}`;
      aliquota.append(nota);
    }
  }
  for (const [campo, rotulo] of [["diferido", "diferido"], ["devolvido", "devolvido"]]) {
    if (Number(t[campo]) > 0) {
      const nota = document.createElement("small");
      nota.textContent = `${rotulo}: ${reais(t[campo])}`;
      valor.append(nota);
    }
  }
}

function mostrarResultado(r) {
  $("r-total").textContent = reais(r.total);
  const carga = Number(r.valorInformado) > 0 ? (Number(r.total) / Number(r.valorInformado)) * 100 : 0;
  $("r-carga").textContent = `Equivale a ${carga.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% do valor informado (${reais(r.valorInformado)}).`;
  linhaDoTributo("r-cbs", r.cbs);
  linhaDoTributo("r-ibsuf", r.ibsUf);
  linhaDoTributo("r-ibsmun", r.ibsMun);

  const base = $("r-base");
  base.textContent = reais(r.base);
  if (r.base !== r.valorInformado && !r.semIncidencia) {
    const nota = document.createElement("small");
    nota.textContent = "diferente do valor informado: veja a memória de cálculo";
    base.append(nota);
  }

  const observacoes = [];
  if (r.semIncidencia) observacoes.push("Nesta classificação não há CBS nem IBS a pagar sobre a operação.");
  if (Number(r.diferido) > 0) observacoes.push(`Tributo diferido (não cobrado nesta operação): ${reais(r.diferido)}.`);
  if (Number(r.devolvido) > 0) observacoes.push(`Tributo devolvido: ${reais(r.devolvido)}.`);
  $("r-observacao").textContent = observacoes.join(" ");
  $("r-observacao").hidden = observacoes.length === 0;

  const memoria = $("memoria-texto");
  memoria.textContent = "";
  for (const [nome, texto] of [["CBS", r.memoria.cbs], ["IBS estadual", r.memoria.ibsUf], ["IBS municipal", r.memoria.ibsMun]]) {
    if (!texto) continue;
    const p = document.createElement("p");
    const forte = document.createElement("strong");
    forte.textContent = `${nome}: `;
    p.append(forte, texto);
    memoria.append(p);
  }
  $("memoria").hidden = memoria.childElementCount === 0;

  if (r.aviso) mostrarMensagem($("aviso"), "Valores simulados", r.aviso);
  else $("aviso").hidden = true;

  $("vazio").hidden = true;
  $("calculo").hidden = false;
}

function limparResultado() {
  $("calculo").hidden = true;
  $("vazio").hidden = false;
}

$("form").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!listasProntas || botao.disabled) return;
  const erro = $("erro-form");
  erro.hidden = true;
  marcarInvalido(null);
  let pedido;
  try {
    pedido = lerFormulario();
  } catch (falha) {
    mostrarMensagem(erro, falha.message, falha.detalhe);
    marcarInvalido(falha.campo);
    return;
  }
  botao.disabled = true;
  botao.textContent = "Calculando…";
  try {
    mostrarResultado(await api("/api/calcular", pedido));
    const resultado = $("resultado");
    resultado.focus({ preventScroll: true });
    resultado.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  } catch (falha) {
    limparResultado();
    mostrarMensagem(erro, falha.message, falha.detalhe);
    marcarInvalido(falha.campo);
  } finally {
    botao.disabled = false;
    botao.textContent = "Calcular";
  }
});

campos.uf.addEventListener("change", () => {
  guardar("calculadora-uf", campos.uf.value);
  carregarMunicipios();
});
campos.municipio.addEventListener("change", () => guardar("calculadora-municipio", campos.municipio.value));
campos.cst.addEventListener("change", () => carregarClassificacoes());
campos.data.addEventListener("change", () => {
  ajustarAliquotas();
  if (!dataNoPeriodo() || !listasProntas) return;
  carregarSituacoes().catch((falha) => mostrarMensagem($("erro-form"), falha.message, falha.detalhe));
});
$("tentar").addEventListener("click", iniciar);

const hoje = hojeEmBrasilia();
campos.data.value = hoje < campos.data.min ? campos.data.min : hoje > campos.data.max ? campos.data.max : hoje;
ajustarAliquotas();
iniciar();
