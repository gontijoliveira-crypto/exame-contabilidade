/**
 * Cliente da API da Calculadora da Reforma Tributária do Consumo (Receita Federal).
 * A API é pública e não exige chave. Aqui ficam as tentativas, o tempo limite e a memória das listas
 * (UFs, municípios e classificações), para a página não depender de cada chamada dar certo.
 */

/** A Receita não respondeu (rede, tempo esgotado ou erro 5xx), mesmo depois das tentativas. */
export class ErroIndisponivel extends Error {}

/**
 * O firewall da Receita recusou a consulta (página "Request Rejected" no lugar da resposta).
 * Acontece quando o mesmo endereço faz muitas consultas; repetir na hora só prolonga o bloqueio.
 */
export class ErroBloqueio extends ErroIndisponivel {}

const PAGINA_DE_BLOQUEIO = /Request Rejected|requested URL was rejected/i;

/** A Receita recusou o pedido (4xx) e explicou o motivo em `problema` (title, detail, type). */
export class ErroDaReceita extends Error {
  constructor(status, problema) {
    super(problema?.title || `Erro ${status}`);
    this.status = status;
    this.problema = problema && typeof problema === "object" ? problema : {};
  }
}

const HORA = 3_600_000;
const MAX_RESPOSTA = 2_000_000; // caracteres; as maiores listas reais têm cerca de 40 mil
const MAX_MEMORIA = 80; // listas guardadas (1 de UFs, até 27 de municípios, o resto por data)
const MINUSCULAS = new Set(["de", "do", "da", "dos", "das", "e"]);

/** "MATO GROSSO DO SUL" → "Mato Grosso do Sul". */
export function nomeProprio(nome) {
  return String(nome)
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p[0].toLocaleUpperCase("pt-BR") + p.slice(1)))
    .join(" ");
}

const texto = (v) => (typeof v === "string" ? v.trim() : "");

export function criarReceita({
  base,
  buscar = fetch,
  agora = Date.now,
  esperar = (ms) => new Promise((ok) => setTimeout(ok, ms)),
  tentativas = 3,
  tempoLimiteMs = 8_000,
  maxSimultaneas = 8,
  log = console,
}) {
  let emAndamento = 0;

  /** Uma chamada à Receita, com novas tentativas quando a falha é passageira. */
  async function chamar(caminho, { metodo = "GET", corpo } = {}) {
    if (emAndamento >= maxSimultaneas) throw new ErroIndisponivel("Muitas consultas ao mesmo tempo.");
    emAndamento++;
    try {
      let ultima;
      for (let i = 0; i < tentativas; i++) {
        if (i > 0) await esperar(300 * 3 ** (i - 1));
        try {
          const resposta = await buscar(base + caminho, {
            method: metodo,
            headers: corpo ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
            body: corpo ? JSON.stringify(corpo) : undefined,
            signal: AbortSignal.timeout(tempoLimiteMs),
            redirect: "error",
          });
          const conteudo = await resposta.text();
          if (resposta.status >= 500 || resposta.status === 429 || resposta.status === 408) {
            ultima = new Error(`HTTP ${resposta.status}`);
            continue;
          }
          let json = null;
          if (conteudo.length <= MAX_RESPOSTA) {
            try {
              json = JSON.parse(conteudo);
            } catch {
              json = null;
            }
          }
          if (json === null && PAGINA_DE_BLOQUEIO.test(conteudo.slice(0, 2000))) {
            throw new ErroBloqueio("O firewall da Receita Federal recusou a consulta (Request Rejected).");
          }
          if (!resposta.ok) throw new ErroDaReceita(resposta.status, json);
          if (json === null) {
            ultima = new Error("Resposta fora do formato esperado.");
            continue;
          }
          return { corpo: json, cabecalhos: resposta.headers };
        } catch (erro) {
          if (erro instanceof ErroDaReceita || erro instanceof ErroBloqueio) throw erro;
          ultima = erro;
        }
      }
      throw new ErroIndisponivel(ultima?.message || "Falha ao consultar a Receita Federal.", { cause: ultima });
    } finally {
      emAndamento--;
    }
  }

  const memoria = new Map(); // chave → { valor, validoAte }; a ordem do Map é a de uso (a mais antiga sai primeiro)
  const pendentes = new Map(); // chave → promessa da consulta em curso (pedidos iguais esperam a mesma)

  /** Lista guardada por `validadeMs`. Se a Receita falhar e houver uma cópia antiga, ela é usada. */
  function consultar(chave, validadeMs, carregar) {
    const guardada = memoria.get(chave);
    if (guardada && guardada.validoAte > agora()) {
      memoria.delete(chave);
      memoria.set(chave, guardada);
      return Promise.resolve(guardada.valor);
    }
    if (pendentes.has(chave)) return pendentes.get(chave);
    const promessa = (async () => {
      try {
        const valor = await carregar();
        memoria.delete(chave);
        memoria.set(chave, { valor, validoAte: agora() + validadeMs });
        while (memoria.size > MAX_MEMORIA) memoria.delete(memoria.keys().next().value);
        return valor;
      } catch (erro) {
        if (guardada && erro instanceof ErroIndisponivel) {
          log.warn(`Receita indisponível; usando a cópia guardada de "${chave}".`);
          return guardada.valor;
        }
        throw erro;
      } finally {
        pendentes.delete(chave);
      }
    })();
    pendentes.set(chave, promessa);
    return promessa;
  }

  const lista = (corpo) => {
    if (!Array.isArray(corpo)) throw new ErroIndisponivel("Resposta fora do formato esperado.");
    return corpo;
  };

  return {
    /** Unidades da Federação, em ordem de sigla. */
    ufs: () =>
      consultar("ufs", 24 * HORA, async () => {
        const { corpo } = await chamar("/calculadora/dados-abertos/ufs");
        return lista(corpo)
          .filter((u) => /^[A-Z]{2}$/.test(u?.sigla) && u.sigla !== "EX" && texto(u.nome))
          .map((u) => ({ sigla: u.sigla, nome: nomeProprio(u.nome) }))
          .sort((a, b) => a.sigla.localeCompare(b.sigla));
      }),

    /** Municípios de uma UF (a sigla já deve ter sido conferida contra `ufs()`). */
    municipios: (uf) =>
      consultar(`municipios:${uf}`, 24 * HORA, async () => {
        const { corpo } = await chamar(`/calculadora/dados-abertos/ufs/municipios?siglaUf=${encodeURIComponent(uf)}`);
        return lista(corpo)
          .filter((m) => Number.isInteger(m?.codigo) && texto(m.nome))
          .map((m) => ({ codigo: m.codigo, nome: texto(m.nome) }))
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      }),

    /** Situações tributárias (CST) vigentes na data, cada uma com as suas classificações (cClassTrib). */
    situacoes: (data) =>
      consultar(`situacoes:${data}`, 6 * HORA, async () => {
        const { corpo } = await chamar(`/calculadora/dados-abertos/situacoes-tributarias/cbs-ibs?data=${encodeURIComponent(data)}`);
        return lista(corpo)
          .filter((s) => /^\d{3}$/.test(s?.codigo))
          .map((s) => ({
            codigo: s.codigo,
            descricao: texto(s.descricao),
            classificacoes: (Array.isArray(s.classificacoesTributarias) ? s.classificacoesTributarias : [])
              .filter((c) => /^\d{6}$/.test(c?.codigo))
              .map((c) => ({ codigo: c.codigo, descricao: texto(c.descricao) })),
          }))
          .filter((s) => s.classificacoes.length > 0)
          .sort((a, b) => a.codigo.localeCompare(b.codigo));
      }),

    /** Versão da calculadora e da base de dados da Receita. */
    versao: () =>
      consultar("versao", HORA, async () => {
        const { corpo } = await chamar("/calculadora/dados-abertos/versao");
        return { app: texto(corpo?.versaoApp).split("-")[0], base: texto(corpo?.versaoDb), dataBase: texto(corpo?.dataVersaoDb) };
      }),

    /** Cálculo dos tributos de uma operação. `aviso` é o código de "dados simulados" (1 a 6), quando houver. */
    async calcular(operacao) {
      const { corpo, cabecalhos } = await chamar("/calculadora/regime-geral", { metodo: "POST", corpo: operacao });
      return { corpo, aviso: cabecalhos.get("x-warning-dados-simulados") };
    },
  };
}
