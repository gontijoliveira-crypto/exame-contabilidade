/**
 * Regras da calculadora: confere o pedido da página, monta a operação no formato da Receita Federal
 * e resume a resposta (ou o erro) em um formato simples para a tela.
 */

/** O pedido da página está incompleto ou inválido. `campo` indica onde corrigir. */
export class ErroPedido extends Error {
  constructor(mensagem, campo = null) {
    super(mensagem);
    this.campo = campo;
  }
}

/** A resposta da Receita veio em um formato que a calculadora não reconhece. */
export class ErroFormato extends Error {}

export const DATA_MINIMA = "2026-01-01";
export const DATA_MAXIMA = "2033-12-31";
/** A partir desta data a Receita exige que as alíquotas sejam informadas (ainda não estão na base oficial). */
export const INICIO_ALIQUOTAS_INFORMADAS = "2027-01-01";

const DINHEIRO = /^\d{1,13}(\.\d{1,2})?$/;
const PERCENTUAL = /^\d{1,3}(\.\d{1,4})?$/;

const AVISOS = {
  1: "As alíquotas da CBS e do IBS deste período ainda não estão definidas em lei. Os valores são simulados.",
  2: "As alíquotas da CBS e do IBS e o redutor de compras governamentais ainda não estão definidos em lei. Os valores são simulados.",
  3: "As alíquotas da CBS e do IBS e as regras do Imposto Seletivo ainda não estão definidas em lei. Os valores são simulados.",
  4: "As alíquotas, os redutores e as regras do Imposto Seletivo ainda não estão definidos em lei. Os valores são simulados.",
  5: "Para esta classificação tributária a alíquota ainda não foi definida em lei. Os valores são simulados.",
  6: "Simulação com as alíquotas que você informou. As alíquotas oficiais deste período ainda não constam na base da Receita Federal.",
};

/** Campo da tela ligado a cada tipo de erro da Receita, e uma explicação mais direta quando ajuda. */
const ERROS_CONHECIDOS = {
  "ncm-completo-nao-informado": { campo: "ncm", dica: "Esta classificação exige o NCM completo da mercadoria (8 dígitos)." },
  "nbs-completo-nao-informado": { campo: "nbs", dica: "Esta classificação exige o código NBS completo do serviço (9 dígitos)." },
  "municipio-nao-pertencente-uf": { campo: "municipio" },
  "classificacao-tributaria-nao-encontrada": { campo: "cClassTrib" },
  "aliquotas-nominais-nao-informadas": { campo: "aliquotaCbs" },
  "grupo-tributacao-regular-nao-informado": {
    campo: "cClassTrib",
    dica: "Esta classificação depende dos dados da tributação regular da operação, que esta calculadora simplificada não coleta.",
  },
  "dados-imposto-seletivo-nao-informados": {
    campo: "ncm",
    dica: "Este NCM está sujeito ao Imposto Seletivo, que esta calculadora simplificada não calcula.",
  },
};

const texto = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** Confere a data do fato gerador (AAAA-MM-DD, existente e dentro do período atendido) e a devolve. */
export function conferirData(valor) {
  const data = texto(valor);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(data) ? new Date(`${data}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== data) throw new ErroPedido("Informe a data do fato gerador.", "data");
  if (data < DATA_MINIMA || data > DATA_MAXIMA) throw new ErroPedido("A data do fato gerador deve estar entre 01/01/2026 e 31/12/2033.", "data");
  return data;
}

function percentualValido(v) {
  return PERCENTUAL.test(v) && Number(v) <= 100;
}

/** Confere o pedido enviado pela página e devolve os campos já limpos. */
export function validarPedido(corpo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw new ErroPedido("Pedido inválido.");

  const valor = texto(corpo.valor);
  if (!DINHEIRO.test(valor) || Number(valor) <= 0) throw new ErroPedido("Informe o valor da operação, maior que zero.", "valor");

  const data = conferirData(corpo.data);

  const uf = texto(corpo.uf);
  if (!/^[A-Z]{2}$/.test(uf)) throw new ErroPedido("Escolha a UF.", "uf");

  const municipio = texto(corpo.municipio);
  if (!/^\d{7}$/.test(municipio)) throw new ErroPedido("Escolha o município.", "municipio");

  const cst = texto(corpo.cst);
  if (!/^\d{3}$/.test(cst)) throw new ErroPedido("Escolha a situação tributária (CST).", "cst");

  const cClassTrib = texto(corpo.cClassTrib);
  if (!/^\d{6}$/.test(cClassTrib)) throw new ErroPedido("Escolha a classificação tributária.", "cClassTrib");

  const ncm = texto(corpo.ncm);
  if (ncm && !/^\d{8}$/.test(ncm)) throw new ErroPedido("O NCM deve ter 8 dígitos.", "ncm");
  const nbs = texto(corpo.nbs);
  if (nbs && !/^\d{9}$/.test(nbs)) throw new ErroPedido("O NBS deve ter 9 dígitos.", "nbs");
  if (ncm && nbs) throw new ErroPedido("Informe o NCM (mercadoria) ou o NBS (serviço), não os dois.", "nbs");

  let aliquotas = null;
  if (data >= INICIO_ALIQUOTAS_INFORMADAS) {
    const informadas = corpo.aliquotas && typeof corpo.aliquotas === "object" ? corpo.aliquotas : {};
    aliquotas = {};
    for (const [chave, campo, nome] of [
      ["cbs", "aliquotaCbs", "da CBS"],
      ["ibsEstadual", "aliquotaIbsUf", "do IBS estadual"],
      ["ibsMunicipal", "aliquotaIbsMun", "do IBS municipal"],
    ]) {
      const v = texto(informadas[chave]);
      if (!percentualValido(v)) throw new ErroPedido(`Informe a alíquota ${nome} para a simulação (entre 0 e 100%).`, campo);
      aliquotas[chave] = v;
    }
  }

  return { valor, data, uf, municipio: Number(municipio), cst, cClassTrib, ncm: ncm || null, nbs: nbs || null, aliquotas };
}

/** Monta a operação de consumo (um item) no formato do serviço "regime-geral" da Receita. */
export function montarOperacao(pedido, id) {
  const item = { numero: 1, cst: pedido.cst, cClassTrib: pedido.cClassTrib, baseCalculo: Number(pedido.valor) };
  if (pedido.ncm) item.ncm = pedido.ncm;
  if (pedido.nbs) item.nbs = pedido.nbs;
  if (pedido.aliquotas) {
    item.aliquotasNominais = {
      cbs: Number(pedido.aliquotas.cbs),
      ibsEstadual: Number(pedido.aliquotas.ibsEstadual),
      ibsMunicipal: Number(pedido.aliquotas.ibsMunicipal),
    };
  }
  return {
    id,
    versao: "1.0.0",
    dhFatoGerador: `${pedido.data}T12:00:00-03:00`, // meio-dia de Brasília: a data não muda com o fuso
    municipio: pedido.municipio,
    uf: pedido.uf,
    itens: [item],
  };
}

// ---------- valores ----------
// Contas em centavos inteiros, para não haver erro de arredondamento de ponto flutuante.

function centavos(valor) {
  const t = typeof valor === "number" ? (Number.isFinite(valor) ? valor.toFixed(2) : "") : texto(valor);
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return null;
  const [inteiro, decimal = ""] = t.split(".");
  return Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
}

const emReais = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

const ausente = (v) => v === undefined || v === null || v === "";

/**
 * Valor em reais como texto ("9.00"). Presente mas fora do formato → erro: mostrar zero no lugar
 * de um valor que não foi entendido seria pior do que não mostrar nada.
 */
function dinheiro(valor) {
  const c = centavos(valor);
  if (c === null) throw new ErroFormato("A resposta da Receita Federal trouxe um valor ausente ou em formato desconhecido.");
  return emReais(c);
}

/** Como `dinheiro`, mas aceita o campo ausente (a Receita só o envia quando se aplica). */
const dinheiroOuZero = (valor) => (ausente(valor) ? "0.00" : dinheiro(valor));

/** Percentual como a Receita devolve ("0.90"). Ausente → null; fora do formato → erro. */
function percentual(valor) {
  if (ausente(valor)) return null;
  const t = typeof valor === "number" ? (Number.isFinite(valor) ? String(valor) : "") : texto(valor);
  if (!/^\d{1,3}(\.\d{1,6})?$/.test(t)) throw new ErroFormato("A resposta da Receita Federal trouxe uma alíquota em formato desconhecido.");
  return t;
}

function tributo(grupo, chaveAliquota, totais, chaveValor) {
  return {
    aliquota: percentual(grupo?.[chaveAliquota]), // alíquota nominal
    reducao: percentual(grupo?.gRed?.pRedAliq), // % de redução da alíquota, quando a classificação tem
    efetiva: percentual(grupo?.gRed?.pAliqEfet), // alíquota depois da redução
    valor: dinheiro(totais?.[chaveValor]),
    diferido: dinheiroOuZero(totais?.vDif),
    devolvido: dinheiroOuZero(totais?.vDevTrib),
  };
}

const trecho = (v, max) => texto(v).slice(0, max);

/** Resume a resposta do serviço "regime-geral" (uma operação com um item) para a tela. */
export function resumirCalculo(corpo, { aviso = null, pedido }) {
  const objeto = corpo?.objetos?.[0];
  const ibscbs = objeto?.tribCalc?.IBSCBS;
  const totais = corpo?.total?.tribCalc?.IBSCBSTot;
  if (!ibscbs || typeof ibscbs !== "object" || !totais || typeof totais !== "object") {
    throw new ErroFormato("A resposta da Receita Federal não trouxe os valores de CBS e IBS.");
  }
  const grupo = ibscbs.gIBSCBS && typeof ibscbs.gIBSCBS === "object" ? ibscbs.gIBSCBS : null;
  const cbs = tributo(grupo?.gCBS, "pCBS", totais.gCBS, "vCBS");
  const ibsUf = tributo(grupo?.gIBSUF, "pIBSUF", totais.gIBS?.gIBSUF, "vIBSUF");
  const ibsMun = tributo(grupo?.gIBSMun, "pIBSMun", totais.gIBS?.gIBSMun, "vIBSMun");
  const soma = (campo) => emReais(centavos(cbs[campo]) + centavos(ibsUf[campo]) + centavos(ibsMun[campo]));
  const codigoAviso = /^[1-6]$/.test(texto(aviso)) ? Number(aviso) : null;
  const memoria = ibscbs.memoriaCalculo && typeof ibscbs.memoriaCalculo === "object" ? ibscbs.memoriaCalculo : {};

  return {
    valorInformado: dinheiro(pedido.valor),
    base: dinheiro(totais.vBCIBSCBS ?? grupo?.vBC),
    total: soma("valor"),
    diferido: soma("diferido"),
    devolvido: soma("devolvido"),
    cbs,
    ibsUf,
    ibsMun,
    semIncidencia: grupo === null, // isenção, imunidade ou não incidência: a Receita não devolve alíquotas
    simulado: Boolean(objeto.calculoSimulado) || codigoAviso !== null,
    aviso: codigoAviso ? AVISOS[codigoAviso] : objeto.calculoSimulado ? AVISOS[6] : null,
    memoria: { cbs: trecho(memoria.cbs, 1500), ibsUf: trecho(memoria.ibsUF, 1500), ibsMun: trecho(memoria.ibsMun, 1500) },
  };
}

/** Transforma a recusa da Receita (problem+json) em uma mensagem para a tela. */
export function traduzirErro(problema) {
  const tipo = texto(problema?.type).split("/").pop();
  const conhecido = /^[a-z0-9-]+$/.test(tipo) ? ERROS_CONHECIDOS[tipo] : undefined;
  const titulo = trecho(problema?.title, 200) || "A Receita Federal não conseguiu calcular esta operação.";
  const detalhe = conhecido?.dica || trecho(problema?.detail, 600);
  return {
    erro: titulo,
    detalhe: detalhe && detalhe !== titulo ? detalhe : null,
    campo: conhecido?.campo || null,
  };
}
