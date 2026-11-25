/**
 * Cliente das APIs da Apuração Assistida da CBS (Receita Federal), versão 2.
 * Documentação: https://docs.receitafederal.gov.br/apuracao-cbs/
 *
 * - Autenticação OAuth2 (client credentials) no portal Receita Integra; o token é guardado e reaproveitado.
 * - Consultas assíncronas (débitos, créditos, pagamentos e recolhimentos/RAD): abre a solicitação, acompanha a
 *   situação e baixa o arquivo pela URL assinada.
 * - Geração de DARF (síncrona): recolhimento pelo adquirente (RAD) e pagamento como contribuinte (PCONT).
 *
 * Nunca registra o token, o segredo nem a URL assinada.
 */
import { cnpjBase, cnpjCompleto, chaveDfe, ErroDeEntrada, periodo, tiquete, urlRetorno, valorEmReais } from "./validacao.js";

/** A Receita recusou ou não concluiu o pedido. `codigo` é o codigoErro/cdRetorno devolvido, quando há. */
export class ErroDaApi extends Error {
  constructor(mensagem, { status = null, codigo = null, dados = null } = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.dados = dados;
  }
}

/** As consultas assíncronas aceitam no máximo 4 chamadas por API, por dia e por credencial. */
export class ErroDeCota extends Error {}

export const CONSULTAS = {
  debitos: "Débitos de CBS em operações de consumo",
  creditos: "Créditos de CBS em operações de consumo",
  pagamentos: "Pagamentos de CBS (próprios e por adquirentes)",
  recolhimentos: "Recolhimentos de CBS como adquirente (RAD)",
};

export const COTA_DIARIA = 4;
const SITUACOES_FINAIS = new Set(["CONCLUIDA", "ERRO", "EXPIRADA"]);

/** Data de hoje em Brasília (AAAA-MM-DD): a cota da Receita reinicia à meia-noite. */
export const hojeEmBrasilia = (agora = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);

/**
 * @param {object} op
 * @param {string} op.clientId
 * @param {string} op.clientSecret
 * @param {string} [op.base] endereço das APIs (produção por padrão)
 * @param {{ ler(): object, gravar(dados: object): void }} [op.cota] onde guardar o uso diário (padrão: só na memória)
 */
export function criarCliente({
  clientId,
  clientSecret,
  base = "https://api.receitafederal.gov.br",
  buscar = fetch,
  agora = () => new Date(),
  esperar = (ms) => new Promise((ok) => setTimeout(ok, ms)),
  tempoLimiteMs = 30_000,
  cota = memoriaDeCota(),
}) {
  if (!clientId || !clientSecret) throw new ErroDeEntrada("Informe RECEITA_CLIENT_ID e RECEITA_CLIENT_SECRET (credencial gerada no portal Receita Integra).");
  base = base.replace(/\/+$/, "");
  let token = null; // { valor, validoAte }

  async function chamar(url, init = {}) {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(new Error("Tempo esgotado")), tempoLimiteMs);
    try {
      const resposta = await buscar(url, { ...init, signal: controle.signal, redirect: "error" });
      const texto = await resposta.text();
      let json = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch {
        json = null;
      }
      return { status: resposta.status, ok: resposta.ok, json, texto };
    } catch (erro) {
      throw new ErroDaApi(`Não foi possível falar com a Receita Federal: ${erro.message}`);
    } finally {
      clearTimeout(relogio);
    }
  }

  /** Token OAuth2 (client credentials), reaproveitado até 1 minuto antes de vencer. */
  async function obterToken() {
    if (token && token.validoAte > agora().getTime()) return token.valor;
    const r = await chamar(`${base}/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (!r.ok || typeof r.json?.access_token !== "string") {
      throw new ErroDaApi("A Receita recusou a credencial ao gerar o token. Confira RECEITA_CLIENT_ID e RECEITA_CLIENT_SECRET.", { status: r.status, codigo: r.json?.error || null });
    }
    const segundos = Number(r.json.expires_in) > 0 ? Number(r.json.expires_in) : 3600;
    token = { valor: r.json.access_token, validoAte: agora().getTime() + Math.max(segundos - 60, 30) * 1000 };
    return token.valor;
  }

  async function chamarComToken(caminho, { metodo = "GET", corpo } = {}) {
    const fazer = async () =>
      chamar(`${base}${caminho}`, {
        method: metodo,
        headers: { authorization: `Bearer ${await obterToken()}`, accept: "application/json", ...(corpo !== undefined ? { "content-type": "application/json" } : {}) },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      });
    let r = await fazer();
    if (r.status === 401 && token) {
      token = null; // token vencido antes da hora: pede outro uma vez
      r = await fazer();
    }
    return r;
  }

  const erroDe = (r, padrao) => {
    const codigo = r.json?.codigoErro || r.json?.cdRetorno || null;
    const mensagem = r.json?.mensagemErro || r.json?.mensagem || padrao;
    return new ErroDaApi(codigo ? `${mensagem} (${codigo})` : mensagem, { status: r.status, codigo, dados: r.json });
  };

  /** Registra o uso da cota; recusa antes de chamar se as 4 do dia já foram usadas. */
  function usarCota(tipo) {
    const dia = hojeEmBrasilia(agora());
    const dados = cota.ler();
    const usadas = dados[dia]?.[tipo] || 0;
    if (usadas >= COTA_DIARIA) {
      throw new ErroDeCota(`A cota de ${COTA_DIARIA} consultas de "${tipo}" por dia já foi usada nesta credencial. Ela reinicia à meia-noite.`);
    }
    // Guarda só o dia de hoje: o arquivo não cresce.
    cota.gravar({ [dia]: { ...(dados[dia] || {}), [tipo]: usadas + 1 } });
  }

  /** Quantas consultas de cada tipo ainda restam hoje. */
  function cotaRestante() {
    const usadas = cota.ler()[hojeEmBrasilia(agora())] || {};
    return Object.fromEntries(Object.keys(CONSULTAS).map((tipo) => [tipo, COTA_DIARIA - (usadas[tipo] || 0)]));
  }

  /** Abre uma consulta assíncrona. Devolve { tiquete, segundosEstimados }. */
  async function solicitar(tipo, cnpj, { webhook = "" } = {}) {
    if (!CONSULTAS[tipo]) throw new ErroDeEntrada(`Consulta desconhecida: "${tipo}". Use: ${Object.keys(CONSULTAS).join(", ")}.`);
    const raiz = cnpjBase(cnpj);
    const corpo = { urlRetorno: urlRetorno(webhook) };
    usarCota(tipo);
    const r = await chamarComToken(`/apuracao-cbs/v2/${tipo}/${raiz}`, { metodo: "POST", corpo });
    if (r.status !== 201 || typeof r.json?.tiqueteSolicitacao !== "string") throw erroDe(r, `A Receita não abriu a consulta de ${tipo}.`);
    return { tiquete: r.json.tiqueteSolicitacao, segundosEstimados: Number.isInteger(r.json.tEASegundos) ? r.json.tEASegundos : -1 };
  }

  /** Situação de uma consulta: PENDENTE, EM_PROCESSAMENTO, CONCLUIDA, ERRO ou EXPIRADA. */
  async function situacao(tiqueteSolicitacao) {
    const t = tiquete(tiqueteSolicitacao);
    const r = await chamarComToken(`/apuracao-cbs/v2/situacao/${encodeURIComponent(t)}`);
    if (!r.ok || typeof r.json?.situacao !== "string") throw erroDe(r, "Não foi possível consultar a situação da solicitação.");
    return { situacao: r.json.situacao, codigoErro: r.json.codigoErro || null, mensagemErro: r.json.mensagemErro || null };
  }

  /** Baixa o arquivo de retorno de uma consulta concluída (pela URL assinada, sem token). */
  async function baixar(tiqueteSolicitacao) {
    const t = tiquete(tiqueteSolicitacao);
    const r = await chamarComToken(`/apuracao-cbs/v2/download/${encodeURIComponent(t)}`);
    if (!r.ok || typeof r.json?.urlAssinada !== "string") throw erroDe(r, "O arquivo de retorno não está disponível.");
    if (r.json.urlAssinadaExpiraEm && Date.parse(r.json.urlAssinadaExpiraEm) <= agora().getTime()) {
      throw new ErroDaApi("O link de download já expirou. Abra uma nova consulta.", { codigo: "URL_EXPIRADA" });
    }
    const arquivo = await chamar(r.json.urlAssinada); // sem Bearer nem cabeçalhos extras, como manda a documentação
    if (!arquivo.ok || arquivo.json === null) throw new ErroDaApi("Não foi possível baixar o arquivo de retorno.", { status: arquivo.status });
    return arquivo.json;
  }

  /**
   * Consulta completa: abre, acompanha a situação até concluir (até `maxMinutos`) e baixa o arquivo.
   * `aoMudar` recebe cada situação nova, para mostrar o andamento.
   */
  async function consultar(tipo, cnpj, { maxMinutos = 30, intervaloSegundos = 30, aoMudar = () => {} } = {}) {
    const { tiquete: t, segundosEstimados } = await solicitar(tipo, cnpj);
    aoMudar({ situacao: "ABERTA", tiquete: t, segundosEstimados });
    const limite = agora().getTime() + maxMinutos * 60_000;
    let ultima = null;
    await esperar(Math.min(Math.max(segundosEstimados, 5), intervaloSegundos) * 1000);
    for (;;) {
      const s = await situacao(t);
      if (s.situacao !== ultima) aoMudar({ ...s, tiquete: t });
      ultima = s.situacao;
      if (s.situacao === "CONCLUIDA") return { tiquete: t, arquivo: await baixar(t) };
      if (SITUACOES_FINAIS.has(s.situacao)) {
        throw new ErroDaApi(`A consulta terminou em ${s.situacao}: ${s.mensagemErro || "sem detalhes"}`, { codigo: s.codigoErro });
      }
      if (agora().getTime() >= limite) {
        throw new ErroDaApi(`A consulta ainda não terminou. Acompanhe depois com o tíquete ${t} (a Receita processa em até 4 horas).`, { codigo: "AINDA_EM_PROCESSAMENTO", dados: { tiquete: t } });
      }
      await esperar(intervaloSegundos * 1000);
    }
  }

  const resumoDarf = (r) => {
    if (r.json?.cdRetorno !== "DARF_GERADO") throw erroDe(r, "A Receita não gerou o DARF.");
    return { darf: r.json.darf, pagamento: r.json.informacoesPagamento };
  };

  /**
   * DARF de recolhimento pelo adquirente (RAD), um por documento fiscal.
   * itens: [{ chave, valorParcial? }] — sem valorParcial, paga o total do documento.
   * Devolve uma lista com o resultado de cada item.
   */
  async function gerarDarfRad(cnpj, itens) {
    const numero = cnpjCompleto(cnpj);
    if (!Array.isArray(itens) || itens.length === 0) throw new ErroDeEntrada("Informe ao menos uma chave de documento fiscal.");
    const corpo = itens.map((item) => {
      const pedido = { chaveDFE: chaveDfe(item.chave), opcaoPagamento: item.valorParcial ? "PAGAMENTO_PARCIAL" : "PAGAMENTO_TOTAL" };
      if (item.valorParcial) pedido.valorDarfParcial = valorEmReais(item.valorParcial);
      return pedido;
    });
    const r = await chamarComToken(`/apuracao-cbs/v2/rad/${numero}`, { metodo: "POST", corpo });
    // A documentação mostra um objeto por chamada; se vier uma lista (um por documento), devolve todos.
    const respostas = Array.isArray(r.json) ? r.json : [r.json];
    return respostas.map((json, i) => {
      try {
        return { chave: corpo[i]?.chaveDFE ?? null, ...resumoDarf({ ...r, json }) };
      } catch (erro) {
        return { chave: corpo[i]?.chaveDFE ?? null, erro: erro.message, codigo: erro.codigo };
      }
    });
  }

  /** DARF de pagamento de CBS como contribuinte (PCONT) de um período. Sem valorParcial, paga o total. */
  async function gerarDarfPcont(cnpj, { pa, valorParcial } = {}) {
    const numero = cnpjCompleto(cnpj);
    const corpo = { pa: periodo(pa), opcaoPagamento: valorParcial ? "PAGAMENTO_PARCIAL" : "PAGAMENTO_TOTAL" };
    if (valorParcial) corpo.valorDarfParcial = valorEmReais(valorParcial);
    const r = await chamarComToken(`/apuracao-cbs/v2/pcont/${numero}`, { metodo: "POST", corpo });
    return resumoDarf(r);
  }

  return { solicitar, situacao, baixar, consultar, gerarDarfRad, gerarDarfPcont, cotaRestante };
}

/** Uso da cota guardado só na memória (para testes ou uso pontual). */
export function memoriaDeCota() {
  let dados = {};
  return { ler: () => dados, gravar: (novos) => { dados = novos; } };
}
