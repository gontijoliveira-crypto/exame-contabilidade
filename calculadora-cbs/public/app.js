// Comportamento da página: carrega as listas, confere o formulário, pede o cálculo ao servidor e mostra o resultado.
import { lerPercentual, lerValor, porcento, reais } from "./formatos.js";

const $ = (id) => document.getElementById(id);
const campos = {
  valor: $("valor"), data: $("data"), uf: $("uf"), municipio: $("municipio"), cst: $("cst"), cClassTrib: $("cClassTrib"),
  ncm: $("ncm"), nbs: $("nbs"), aliquotaCbs: $("aliquotaCbs"), aliquotaIbsUf: $("aliquotaIbsUf"), aliquotaIbsMun: $("aliquotaIbsMun"),
  creditoTipo: $("creditoTipo"), creditoValor: $("creditoValor"), creditoCbs: $("creditoCbs"), creditoIbs: $("creditoIbs"),
};
const INICIO_CREDITO = "2027-01-01"; // crédito presumido do transportador autônomo: LC 214/2025, art. 544, III
const botao = $("calcular");
const INICIO_ALIQUOTAS = "2027-01-01"; // a partir daqui a Receita pede as alíquotas da simulação
let situacoes = [];
let dataDasSituacoes = ""; // data usada na última lista de situações carregada
let listasProntas = false;
let ocupado = false; // cálculo em andamento

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

/** Tira a marca de erro de todos os campos (e o texto de erro que fica junto de cada um). */
function limparErrosDosCampos() {
  for (const c of Object.values(campos)) {
    c.removeAttribute("aria-invalid");
    const ligados = (c.getAttribute("aria-describedby") || "").split(" ").filter((id) => id && id !== `erro-${c.id}`);
    if (ligados.length) c.setAttribute("aria-describedby", ligados.join(" "));
    else c.removeAttribute("aria-describedby");
  }
  for (const e of document.querySelectorAll(".erro-campo")) e.remove();
}

/**
 * Mostra o erro: junto do campo a corrigir (visível no celular, lido pelo leitor de tela ao focar o
 * campo) e também na caixa acima do botão. Sem campo, o foco vai para a caixa de erro.
 */
function mostrarErro(titulo, detalhe, campo) {
  limparErrosDosCampos();
  const caixa = $("erro-form");
  mostrarMensagem(caixa, titulo, detalhe);
  const alvo = campo && campos[campo];
  if (!alvo) {
    caixa.focus();
    return;
  }
  const junto = document.createElement("p");
  junto.className = "erro-campo";
  junto.id = `erro-${alvo.id}`;
  junto.textContent = detalhe ? `${titulo} ${detalhe}` : titulo;
  alvo.insertAdjacentElement("afterend", junto);
  alvo.setAttribute("aria-invalid", "true");
  alvo.setAttribute("aria-describedby", [junto.id, ...(alvo.getAttribute("aria-describedby") || "").split(" ").filter(Boolean)].join(" "));
  alvo.focus();
}

// ---------- listas ----------
let pedidoDeMunicipios = 0;
async function carregarMunicipios(preferido = "") {
  const uf = campos.uf.value;
  const pedido = ++pedidoDeMunicipios;
  preencher(campos.municipio, [], uf ? "Carregando…" : "Escolha a UF");
  $("tentar-municipios").hidden = true;
  if (!uf) return;
  try {
    const lista = await api(`/api/municipios?uf=${encodeURIComponent(uf)}`);
    if (pedido !== pedidoDeMunicipios) return; // a UF mudou enquanto a lista vinha
    preencher(campos.municipio, lista.map((m) => ({ valor: String(m.codigo), rotulo: m.nome })), "Selecione");
    if (preferido && lista.some((m) => String(m.codigo) === preferido)) campos.municipio.value = preferido;
  } catch (falha) {
    if (pedido !== pedidoDeMunicipios) return;
    preencher(campos.municipio, [], "A lista não carregou");
    mostrarErro(`Não foi possível carregar os municípios. ${falha.message}`, "Use o botão abaixo da lista para tentar de novo.", null);
    $("tentar-municipios").hidden = false;
  }
}

/** Mostra abaixo da lista a descrição inteira da classificação escolhida (no celular, a opção fica cortada). */
function mostrarDescricaoDaClassificacao() {
  const opcao = campos.cClassTrib.selectedOptions[0];
  const texto = opcao && opcao.value ? opcao.textContent : "";
  $("descricao-classtrib").textContent = texto;
  $("descricao-classtrib").hidden = !texto;
}

function carregarClassificacoes(preferida = "") {
  const situacao = situacoes.find((s) => s.codigo === campos.cst.value);
  const lista = situacao ? situacao.classificacoes : [];
  preencher(campos.cClassTrib, lista.map((c) => ({ valor: c.codigo, rotulo: `${c.codigo} · ${c.descricao}` })), situacao ? "Selecione" : "Escolha o CST");
  if (lista.some((c) => c.codigo === preferida)) campos.cClassTrib.value = preferida;
  else if (lista.length === 1) campos.cClassTrib.value = lista[0].codigo;
  mostrarDescricaoDaClassificacao();
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

/** Crédito na subcontratação: só a partir de 2027; os percentuais só valem para o transportador autônomo. */
function ajustarCredito() {
  const disponivel = dataNoPeriodo() && campos.data.value >= INICIO_CREDITO;
  const ativo = $("creditoAtivo");
  ativo.disabled = !disponivel;
  if (!disponivel) ativo.checked = false;
  $("credito-indisponivel").hidden = disponivel;
  $("credito-campos").hidden = !ativo.checked;
  const autonomo = campos.creditoTipo.value === "autonomo";
  $("credito-autonomo").hidden = !autonomo;
  $("credito-empresa").hidden = autonomo;
}

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
  if ($("creditoAtivo").checked && campos.data.value >= INICIO_CREDITO) {
    const valorCredito = lerValor(campos.creditoValor.value);
    if (!valorCredito || Number(valorCredito) <= 0) throw new Falha("Informe o valor pago ao subcontratado, por exemplo 700,00.", null, "creditoValor");
    pedido.credito = { tipo: campos.creditoTipo.value, valor: valorCredito };
    if (pedido.credito.tipo === "autonomo") {
      for (const [chave, campo, nome] of [["cbs", "creditoCbs", "da CBS"], ["ibs", "creditoIbs", "do IBS"]]) {
        const v = lerPercentual(campos[campo].value);
        if (!v) throw new Falha(`Informe o percentual do crédito presumido ${nome} (entre 0 e 100%).`, null, campo);
        pedido.credito[chave] = v;
      }
    }
  }
  return pedido;
}

function mostrarCredito(r) {
  const bloco = $("r-credito");
  const c = r.credito;
  bloco.hidden = !c;
  if (!c) return;
  $("r-credito-quem").textContent = c.tipo === "autonomo"
    ? `Transportador autônomo pessoa física, valor pago de ${reais(c.base)}. Crédito presumido com ${porcento(c.cbs.percentual)} para a CBS e ${porcento(c.ibs.percentual)} para o IBS.`
    : `Transportadora do regime regular, valor pago de ${reais(c.base)}. Crédito igual ao IBS e à CBS cobrados no frete dela.`;
  const celula = (id, valor) => {
    $(id).textContent = reais(String(valor).replace(/^-/, ""));
    if (Number(valor) < 0) $(id).textContent += " a favor";
    $(id).classList.toggle("negativo", Number(valor) < 0);
  };
  $("r-cred-cbs-debito").textContent = reais(c.debito.cbs);
  $("r-cred-ibs-debito").textContent = reais(c.debito.ibs);
  $("r-cred-total-debito").textContent = reais(c.debito.total);
  $("r-cred-cbs").textContent = reais(c.cbs.valor);
  $("r-cred-ibs").textContent = reais(c.ibs.valor);
  $("r-cred-total").textContent = reais(c.total);
  celula("r-saldo-cbs", c.saldo.cbs);
  celula("r-saldo-ibs", c.saldo.ibs);
  celula("r-saldo-total", c.saldo.total);
  const notas = [];
  if (c.tipo === "autonomo") notas.push("Fórmula do crédito presumido, para cada tributo: valor pago × p ÷ (100 + p), em que p é o percentual informado (Decreto 12.955/2026, art. 253). Os percentuais oficiais de 2027 ainda não foram publicados.");
  notas.push("O crédito da CBS só abate CBS, e o do IBS só abate IBS.");
  if (Number(c.saldo.total) < 0) notas.push("Saldo a favor: o crédito é maior que o tributo desta operação e pode abater o devido em outras operações do período.");
  $("r-credito-nota").textContent = notas.join(" ");
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
  $("r-total").textContent = r.regimeEspecifico ? "Não apurado" : reais(r.total);
  const carga = Number(r.valorInformado) > 0 ? (Number(r.total) / Number(r.valorInformado)) * 100 : 0;
  $("r-carga").textContent = `Equivale a ${carga.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% do valor informado (${reais(r.valorInformado)}).`;
  linhaDoTributo("r-cbs", r.cbs);
  linhaDoTributo("r-ibsuf", r.ibsUf);
  linhaDoTributo("r-ibsmun", r.ibsMun);

  const base = $("r-base");
  base.textContent = reais(r.base);
  if (r.base !== r.valorInformado && !r.semIncidencia && !r.regimeEspecifico) {
    const nota = document.createElement("small");
    nota.textContent = "diferente do valor informado: veja a memória de cálculo";
    base.append(nota);
  }

  const observacoes = [];
  if (r.semIncidencia) observacoes.push("Nesta classificação não há CBS nem IBS a pagar sobre a operação.");
  if (campos.data.value < INICIO_ALIQUOTAS && !r.semIncidencia && !r.regimeEspecifico) {
    observacoes.push("Em 2026, quem cumpre as obrigações acessórias fica dispensado de recolher estes valores (LC 214/2025, art. 348), e as alíquotas de teste não se aplicam a optantes do Simples Nacional.");
  }
  if (r.regimeEspecifico) observacoes.push("Esta classificação é tributada em regime ou documento específico, que esta calculadora não apura. Os valores zerados acima não significam que não há tributo: consulte o escritório.");
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

  mostrarCredito(r);
  $("vazio").hidden = true;
  $("calculo").hidden = false;
}

function limparResultado() {
  $("calculo").hidden = true;
  $("vazio").hidden = false;
}

$("form").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!listasProntas || botao.disabled || ocupado) return;
  $("erro-form").hidden = true;
  limparErrosDosCampos();
  let pedido;
  try {
    pedido = lerFormulario();
  } catch (falha) {
    limparResultado();
    mostrarErro(falha.message, falha.detalhe, falha.campo);
    return;
  }
  // O botão fica focável durante o cálculo (aria-disabled), para o foco do teclado não se perder.
  ocupado = true;
  botao.setAttribute("aria-disabled", "true");
  botao.textContent = "Calculando…";
  try {
    mostrarResultado(await api("/api/calcular", pedido));
    const resultado = $("resultado");
    resultado.focus({ preventScroll: true });
    resultado.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  } catch (falha) {
    limparResultado();
    mostrarErro(falha.message, falha.detalhe, falha.campo);
  } finally {
    ocupado = false;
    botao.removeAttribute("aria-disabled");
    botao.textContent = "Calcular";
  }
});

// Resultado antigo some quando qualquer dado muda, para não ficar ao lado de dados diferentes.
$("form").addEventListener("input", limparResultadoAposMudanca);
$("form").addEventListener("change", limparResultadoAposMudanca);
function limparResultadoAposMudanca() {
  if (!ocupado && !$("calculo").hidden) {
    limparResultado();
    $("vazio").textContent = "Os dados mudaram. Clique em Calcular para ver o novo resultado.";
  }
}
campos.cClassTrib.addEventListener("change", mostrarDescricaoDaClassificacao);
$("tentar-municipios").addEventListener("click", () => carregarMunicipios());

campos.uf.addEventListener("change", () => {
  guardar("calculadora-uf", campos.uf.value);
  carregarMunicipios();
});
campos.municipio.addEventListener("change", () => guardar("calculadora-municipio", campos.municipio.value));
campos.cst.addEventListener("change", () => carregarClassificacoes());
$("creditoAtivo").addEventListener("change", ajustarCredito);
campos.creditoTipo.addEventListener("change", ajustarCredito);
campos.data.addEventListener("change", () => {
  ajustarCredito();
  ajustarAliquotas();
  if (!dataNoPeriodo() || !listasProntas) return;
  carregarSituacoes().catch((falha) => {
    // Sem as listas da nova data, as da data anterior não podem ser usadas.
    preencher(campos.cst, [], "A lista não carregou");
    preencher(campos.cClassTrib, [], "A lista não carregou");
    mostrarDescricaoDaClassificacao();
    $("erro-inicio-texto").textContent = `Não foi possível carregar as classificações desta data. ${falha.message} ${falha.detalhe || ""}`.trim();
    $("erro-inicio").hidden = false;
    botao.disabled = true;
  });
});
$("tentar").addEventListener("click", iniciar);

const hoje = hojeEmBrasilia();
campos.data.value = hoje < campos.data.min ? campos.data.min : hoje > campos.data.max ? campos.data.max : hoje;
ajustarAliquotas();
ajustarCredito();
iniciar();
