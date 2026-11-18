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

  return { valor, data, uf, municipio: Number(municipio), cst, cClassTrib, ncm: ncm || null, nbs: nbs || null, aliquotas, credito: validarCredito(corpo.credito, data) };
}

export const INICIO_CREDITO_SUBCONTRATACAO = "2027-01-01"; // LC 214/2025, art. 544, III (redação da LC 227/2026)

/**
 * Crédito na subcontratação do frete (opcional), a partir de 2027:
 * - "autonomo": transportador autônomo pessoa física não contribuinte ou MEI. Crédito presumido do
 *   art. 169 da LC 214/2025, com os percentuais de CBS e de IBS informados (o ato conjunto que os fixa
 *   ainda não foi publicado).
 * - "empresa": transportadora do regime regular. Crédito do IBS e da CBS cobrados no frete dela,
 *   calculado pela Calculadora da Receita com as mesmas alíquotas da operação.
 */
function validarCredito(bruto, data) {
  if (bruto === undefined || bruto === null) return null;
  if (typeof bruto !== "object" || Array.isArray(bruto)) throw new ErroPedido("Pedido inválido.");
  if (data < INICIO_CREDITO_SUBCONTRATACAO) {
    throw new ErroPedido("O crédito na subcontratação só pode ser simulado para fatos geradores a partir de 01/01/2027.", "creditoTipo");
  }
  const tipo = texto(bruto.tipo);
  if (tipo !== "autonomo" && tipo !== "empresa") throw new ErroPedido("Escolha quem foi subcontratado.", "creditoTipo");
  const valor = texto(bruto.valor);
  if (!DINHEIRO.test(valor) || Number(valor) <= 0) throw new ErroPedido("Informe o valor pago ao subcontratado, maior que zero.", "creditoValor");
  if (tipo === "empresa") return { tipo, valor };
  const percentuais = {};
  for (const [chave, campo, nome] of [
    ["cbs", "creditoCbs", "da CBS"],
    ["ibs", "creditoIbs", "do IBS"],
  ]) {
    const v = texto(bruto[chave]);
    if (!percentualValido(v)) throw new ErroPedido(`Informe o percentual do crédito presumido ${nome} (entre 0 e 100%).`, campo);
    percentuais[chave] = v;
  }
  return { tipo, valor, ...percentuais };
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

/** Operação do frete subcontratado de uma transportadora do regime regular: tributação integral, mesma data e local. */
export function montarOperacaoSubcontratada(pedido, id) {
  return montarOperacao({ ...pedido, valor: pedido.credito.valor, cst: "000", cClassTrib: "000001", ncm: null, nbs: null }, id);
}

// ---------- valores ----------
// Contas em centavos inteiros, para não haver erro de arredondamento de ponto flutuante.

function centavos(valor) {
  const t = typeof valor === "number" ? (Number.isFinite(valor) ? valor.toFixed(2) : "") : texto(valor);
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return null;
  const [inteiro, decimal = ""] = t.split(".");
  return Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
}

const emReais = (c) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

/** Divide inteiros (BigInt) e arredonda como a Calculadora da Receita: meio centavo vai para o par (HALF_EVEN). */
function dividirArredondando(numerador, divisor) {
  let quociente = numerador / divisor;
  const dobroDoResto = 2n * (numerador % divisor);
  if (dobroDoResto > divisor || (dobroDoResto === divisor && quociente % 2n === 1n)) quociente += 1n;
  return quociente;
}

/** "12.375" → { inteiro: 12375n, escala: 1000n } (percentual sem a vírgula e a potência de 10 retirada). */
function percentualInteiro(percentualTexto) {
  const [inteiro, decimal = ""] = percentualTexto.split(".");
  return { inteiro: BigInt(inteiro + decimal), escala: 10n ** BigInt(decimal.length) };
}

/** Valor em centavos × percentual ("12.5"), arredondado ao centavo. Conta exata, com inteiros. */
export function aplicarPercentual(c, percentualTexto) {
  const { inteiro, escala } = percentualInteiro(percentualTexto);
  return Number(dividirArredondando(BigInt(c) * inteiro, 100n * escala));
}

/**
 * Crédito presumido do art. 169 sobre o valor pago, em centavos: CP = [VO × C] / [1 + C], com C = p/100
 * (Decreto 12.955/2026, art. 253, e o regulamento do IBS). O percentual incide sobre o valor líquido
 * (valor pago menos o crédito), e não sobre o valor pago.
 */
export function creditoPresumido(c, percentualTexto) {
  const { inteiro, escala } = percentualInteiro(percentualTexto);
  return Number(dividirArredondando(BigInt(c) * inteiro, 100n * escala + inteiro));
}

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

const debitoDe = (r) => ({ cbs: centavos(r.cbs.valor), ibs: centavos(r.ibsUf.valor) + centavos(r.ibsMun.valor) });

/**
 * Crédito na subcontratação e saldo da operação (débito menos crédito, por tributo).
 * - autônomo: crédito presumido do art. 169, calculado aqui (a Calculadora da Receita ainda não o calcula);
 * - empresa: `subcontratada` é o resumo do frete dela calculado pela Receita, e o crédito é o tributo cobrado.
 * O saldo negativo indica crédito maior que o tributo desta operação (sobra para outras operações).
 */
export function resumirCredito(credito, operacao, subcontratada = null) {
  const base = centavos(credito.valor);
  const debito = debitoDe(operacao);
  let cbs;
  let ibs;
  if (credito.tipo === "empresa") {
    if (!subcontratada) throw new ErroFormato("Faltou o cálculo do frete subcontratado.");
    ({ cbs, ibs } = debitoDe(subcontratada));
  } else {
    cbs = creditoPresumido(base, credito.cbs);
    ibs = creditoPresumido(base, credito.ibs);
  }
  return {
    tipo: credito.tipo,
    base: emReais(base),
    cbs: { percentual: credito.tipo === "autonomo" ? credito.cbs : null, valor: emReais(cbs) },
    ibs: { percentual: credito.tipo === "autonomo" ? credito.ibs : null, valor: emReais(ibs) },
    total: emReais(cbs + ibs),
    simulado: credito.tipo === "autonomo" || Boolean(subcontratada?.simulado),
    debito: { cbs: emReais(debito.cbs), ibs: emReais(debito.ibs), total: emReais(debito.cbs + debito.ibs) },
    saldo: { cbs: emReais(debito.cbs - cbs), ibs: emReais(debito.ibs - ibs), total: emReais(debito.cbs + debito.ibs - cbs - ibs) },
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
