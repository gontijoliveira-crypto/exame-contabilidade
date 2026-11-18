/**
 * Servidor da calculadora: entrega a página (com a marca de config/marca.json), os arquivos de public/
 * e uma pequena API própria (/api/...) que consulta a Calculadora da Receita Federal.
 * Não usa bibliotecas externas: só o que já vem com o Node.js.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ErroFormato, ErroPedido, conferirData, montarOperacao, montarOperacaoSubcontratada, resumirCalculo, resumirCredito, traduzirErro, validarPedido } from "./calculo.js";
import { cssDaMarca, iconeDaMarca } from "./marca.js";
import { renderizarNaoEncontrada, renderizarPagina } from "./pagina.js";
import { ErroBloqueio, ErroDaReceita, ErroIndisponivel, ErroOcupado } from "./receita.js";

class ErroHttp extends Error {
  constructor(status, mensagem, cabecalhos = {}) {
    super(mensagem);
    this.status = status;
    this.cabecalhos = cabecalhos;
  }
}

const TIPOS = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const HTML = "text/html; charset=utf-8";
const JSON_TIPO = "application/json; charset=utf-8";
const SEMPRE_CONFERIR = "no-cache"; // o navegador guarda, mas confirma com o servidor (ETag) antes de usar
const CACHE_LISTAS = "public, max-age=300";
const MAX_CORPO = 4096; // bytes; o pedido de cálculo tem menos de 300

const SEGURANCA = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

/** Conteúdo pronto para envio: tipo, etiqueta de versão (ETag) e a cópia compactada, quando compensa. */
function recurso(conteudo, tipo, cache = SEMPRE_CONFERIR) {
  const dados = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, "utf8");
  const texto = /^(text\/|application\/json|image\/svg)/.test(tipo);
  return {
    dados,
    tipo,
    cache,
    etag: `"${crypto.createHash("sha256").update(dados).digest("base64url").slice(0, 22)}"`,
    gzip: texto && dados.length > 1024 ? zlib.gzipSync(dados) : null,
  };
}

/** Lê todos os arquivos de public/ para a memória (são poucos e pequenos). Chave: o caminho na URL. */
function carregarPublicos(pasta) {
  const arquivos = new Map();
  const percorrer = (dir, prefixo) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name.startsWith(".")) continue;
      const tipo = TIPOS[path.extname(item.name).toLowerCase()];
      if (item.isDirectory()) percorrer(path.join(dir, item.name), `${prefixo}${item.name}/`);
      else if (item.isFile() && tipo) arquivos.set(`/${prefixo}${item.name}`, recurso(fs.readFileSync(path.join(dir, item.name)), tipo));
    }
  };
  percorrer(pasta, "");
  return arquivos;
}

function dimensoesPng(dados) {
  if (!dados || dados.length < 24 || dados.toString("latin1", 1, 4) !== "PNG") return null;
  return { largura: dados.readUInt32BE(16), altura: dados.readUInt32BE(20) };
}

/** Limite de pedidos por chave (IP) em uma janela de tempo. Devolve `true` enquanto estiver dentro do limite. */
export function criarLimitador(maximo, janelaMs, agora = Date.now) {
  const usos = new Map(); // chave → { inicio, n }
  return (chave) => {
    const t = agora();
    if (usos.size >= 10_000) {
      for (const [k, uso] of usos) if (t - uso.inicio >= janelaMs) usos.delete(k);
      if (usos.size >= 10_000) usos.clear(); // nunca cresce sem limite
    }
    const uso = usos.get(chave);
    if (!uso || t - uso.inicio >= janelaMs) {
      usos.set(chave, { inicio: t, n: 1 });
      return true;
    }
    uso.n++;
    return uso.n <= maximo;
  };
}

const PARECE_IP = /^[0-9a-fA-F:.]{3,45}$/;

/**
 * IP de quem fez o pedido, usado só para o limite por visitante.
 * - `cabecalhoIp`: cabeçalho que a hospedagem preenche com o IP do visitante (no Railway, X-Real-IP).
 * - `proxies` > 0 (TRUST_PROXY): usa o X-Forwarded-For contando a partir do fim. O último endereço foi
 *   anotado pelo proxy mais próximo do servidor; os anteriores podem ter sido inventados por quem pediu.
 * - Sem nenhum dos dois: o endereço da própria conexão.
 */
export function ipDoCliente(req, { cabecalhoIp = "", proxies = 0 } = {}) {
  const direto = req.socket?.remoteAddress || "";
  if (cabecalhoIp) {
    const valor = String(req.headers[cabecalhoIp] || "").trim();
    if (PARECE_IP.test(valor)) return valor;
  }
  if (!proxies) return direto;
  const lista = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return lista.length >= proxies ? lista[lista.length - proxies] : lista[0] || direto;
}

function lerJson(req) {
  return new Promise((ok, falha) => {
    const partes = [];
    let tamanho = 0;
    req.on("data", (parte) => {
      tamanho += parte.length;
      if (tamanho > MAX_CORPO) {
        // Para de guardar o que chega (descarta o resto) e responde 413 fechando a conexão.
        req.removeAllListeners("data");
        req.resume();
        falha(new ErroHttp(413, "Pedido grande demais.", { Connection: "close" }));
        return;
      }
      partes.push(parte);
    });
    req.on("end", () => {
      try {
        ok(JSON.parse(Buffer.concat(partes).toString("utf8")));
      } catch {
        falha(new ErroHttp(400, "Pedido inválido."));
      }
    });
    req.on("error", () => falha(new ErroHttp(400, "Pedido interrompido.")));
  });
}

export function criarServidor({ marca, receita, raiz, urlPublica = "", origemDoIp = {}, simulacao = [], limites = {}, agora = Date.now, log = console }) {
  const publicos = carregarPublicos(path.join(raiz, "public"));
  const pagina = recurso(
    renderizarPagina({
      marca,
      urlPublica,
      logo: marca.logo ? dimensoesPng(publicos.get(`/${marca.logo}`)?.dados) : null,
      imagemCompartilhar: marca.compartilhar || marca.icone,
      simulacao,
    }),
    HTML,
  );
  const naoEncontrada = recurso(renderizarNaoEncontrada({ marca, logo: marca.logo ? dimensoesPng(publicos.get(`/${marca.logo}`)?.dados) : null }), HTML, "no-store");
  const estiloDaMarca = recurso(cssDaMarca(marca.cores), TIPOS[".css"]);
  const icone = recurso(iconeDaMarca(marca), TIPOS[".svg"]);

  // Limites folgados para uso normal (uma pessoa faz poucos cálculos por minuto); servem para conter abuso.
  const { calculosPorMinuto = 60, consultasPorMinuto = 300 } = limites;
  const dentroDoLimiteDeCalculos = criarLimitador(calculosPorMinuto, 60_000, agora);
  const dentroDoLimiteDeConsultas = criarLimitador(consultasPorMinuto, 60_000, agora);
  // Trocar de data busca uma lista nova na Receita: limite próprio, bem menor que o das demais consultas.
  const dentroDoLimiteDeDatas = criarLimitador(limites.datasPorMinuto ?? 20, 60_000, agora);
  // Cada visitante pode ter poucas consultas à Receita em andamento, para ninguém ocupar todas as vagas.
  const maxPorVisitante = limites.simultaneasPorVisitante ?? 2;
  const emAndamento = new Map(); // ip → pedidos em andamento

  function enviar(req, res, status, r, extras = {}) {
    const cabecalhos = { "Content-Type": r.tipo, "Cache-Control": r.cache, ...extras };
    if (r.cache !== "no-store") cabecalhos.ETag = r.etag;
    if (r.gzip) cabecalhos.Vary = "Accept-Encoding";
    if (status === 200 && r.cache !== "no-store" && req.headers["if-none-match"] === r.etag) {
      res.writeHead(304, cabecalhos);
      return res.end();
    }
    let corpo = r.dados;
    if (r.gzip && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
      corpo = r.gzip;
      cabecalhos["Content-Encoding"] = "gzip";
    }
    cabecalhos["Content-Length"] = corpo.length;
    res.writeHead(status, cabecalhos);
    res.end(req.method === "HEAD" ? undefined : corpo);
  }

  const json = (req, res, status, dados, cache = "no-store", extras = {}) => enviar(req, res, status, recurso(JSON.stringify(dados), JSON_TIPO, cache), extras);

  const exigirLeitura = (req) => {
    if (req.method !== "GET" && req.method !== "HEAD") throw new ErroHttp(405, "Método não permitido.", { Allow: "GET, HEAD" });
  };

  async function api(req, res, url) {
    const ip = ipDoCliente(req, origemDoIp);
    const atuais = emAndamento.get(ip) || 0;
    if (atuais >= maxPorVisitante) throw new ErroHttp(429, "Aguarde a consulta anterior terminar.", { "Retry-After": "2" });
    emAndamento.set(ip, atuais + 1);
    try {
      return await rotaDaApi(req, res, url, ip);
    } finally {
      const resto = (emAndamento.get(ip) || 1) - 1;
      if (resto > 0) emAndamento.set(ip, resto);
      else emAndamento.delete(ip);
    }
  }

  async function rotaDaApi(req, res, url, ip) {
    const rota = url.pathname.slice("/api/".length);

    if (rota === "calcular") {
      if (req.method !== "POST") throw new ErroHttp(405, "Método não permitido.", { Allow: "POST" });
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) throw new ErroHttp(415, "Envie os dados em JSON.");
      if (!dentroDoLimiteDeCalculos(ip)) throw new ErroHttp(429, "Muitos cálculos em pouco tempo. Aguarde um minuto e tente de novo.", { "Retry-After": "60" });
      const pedido = validarPedido(await lerJson(req));
      const novoId = () => crypto.randomUUID().replaceAll("-", "");
      const empresa = pedido.credito?.tipo === "empresa";
      // O frete da transportadora subcontratada é calculado pela Receita junto com a operação.
      const [principal, subcontratado] = await Promise.all([
        receita.calcular(montarOperacao(pedido, novoId())),
        empresa ? receita.calcular(montarOperacaoSubcontratada(pedido, novoId())) : null,
      ]);
      const resultado = resumirCalculo(principal.corpo, { aviso: principal.aviso, pedido });
      if (pedido.credito) {
        const sub = empresa ? resumirCalculo(subcontratado.corpo, { aviso: subcontratado.aviso, pedido: { ...pedido, valor: pedido.credito.valor } }) : null;
        resultado.credito = resumirCredito(pedido.credito, resultado, sub);
      } else {
        resultado.credito = null;
      }
      return json(req, res, 200, resultado);
    }

    exigirLeitura(req);
    if (!dentroDoLimiteDeConsultas(ip)) throw new ErroHttp(429, "Muitas consultas em pouco tempo. Aguarde um minuto e tente de novo.", { "Retry-After": "60" });

    if (rota === "ufs") return json(req, res, 200, await receita.ufs(), CACHE_LISTAS);
    if (rota === "municipios") {
      const uf = url.searchParams.get("uf") || "";
      if (!(await receita.ufs()).some((u) => u.sigla === uf)) throw new ErroPedido("Escolha a UF.", "uf");
      return json(req, res, 200, await receita.municipios(uf), CACHE_LISTAS);
    }
    // Só conta as datas que exigem consulta nova à Receita (a de hoje, já guardada, não conta).
    if (rota === "situacoes" && !receita.situacoesGuardadas?.(url.searchParams.get("data")) && !dentroDoLimiteDeDatas(ip)) {
      throw new ErroHttp(429, "Muitas trocas de data em pouco tempo. Aguarde um minuto e tente de novo.", { "Retry-After": "60" });
    }
    if (rota === "situacoes") return json(req, res, 200, await receita.situacoes(conferirData(url.searchParams.get("data"))), CACHE_LISTAS);
    if (rota === "versao") return json(req, res, 200, await receita.versao(), CACHE_LISTAS);
    throw new ErroHttp(404, "Rota não encontrada.");
  }

  function responderErro(req, res, erro) {
    if (res.headersSent) return res.destroy();
    if (erro instanceof ErroPedido) return json(req, res, 400, { erro: erro.message, detalhe: null, campo: erro.campo });
    if (erro instanceof ErroHttp) return json(req, res, erro.status, { erro: erro.message, detalhe: null, campo: null }, "no-store", erro.cabecalhos);
    if (erro instanceof ErroDaReceita) return json(req, res, 422, traduzirErro(erro.problema));
    if (erro instanceof ErroBloqueio) {
      log.warn(`Consulta bloqueada pelo firewall da Receita Federal (${req.url}). Muitas consultas a partir deste servidor?`);
      return json(req, res, 503, { erro: "A Calculadora da Receita Federal está recusando consultas no momento.", detalhe: "Tente de novo em alguns minutos.", campo: null }, "no-store", { "Retry-After": "120" });
    }
    if (erro instanceof ErroOcupado) {
      return json(req, res, 503, { erro: "Muitas pessoas usando a calculadora agora.", detalhe: "Tente de novo em alguns segundos.", campo: null }, "no-store", { "Retry-After": "5" });
    }
    if (erro instanceof ErroIndisponivel) {
      log.warn(`Receita Federal indisponível: ${erro.message}`);
      return json(req, res, 503, { erro: "A Calculadora da Receita Federal não respondeu.", detalhe: "Tente de novo em instantes.", campo: null }, "no-store", { "Retry-After": "10" });
    }
    if (erro instanceof ErroFormato) {
      log.error(`Resposta inesperada da Receita Federal: ${erro.message}`);
      return json(req, res, 502, { erro: "A Calculadora da Receita Federal respondeu em um formato inesperado.", detalhe: "Tente de novo mais tarde.", campo: null });
    }
    log.error(erro);
    return json(req, res, 500, { erro: "Erro interno.", detalhe: null, campo: null });
  }

  return async function atender(req, res) {
    for (const [nome, valor] of Object.entries(SEGURANCA)) res.setHeader(nome, valor);
    try {
      let url;
      try {
        url = new URL(req.url, "http://calculadora.local");
        decodeURIComponent(url.pathname);
      } catch {
        return json(req, res, 400, { erro: "Endereço inválido.", detalhe: null, campo: null });
      }
      const caminho = url.pathname;
      if (caminho.startsWith("/api/")) return await api(req, res, url);
      exigirLeitura(req);
      if (caminho === "/saude") return json(req, res, 200, { ok: true }); // verificação de saúde da hospedagem (sem dados)
      if (caminho === "/") return enviar(req, res, 200, pagina);
      if (caminho === "/marca.css") return enviar(req, res, 200, estiloDaMarca);
      if (caminho === "/icone.svg") return enviar(req, res, 200, icone);
      const arquivo = publicos.get(caminho);
      if (arquivo) return enviar(req, res, 200, arquivo);
      return enviar(req, res, 404, naoEncontrada);
    } catch (erro) {
      return responderErro(req, res, erro);
    }
  };
}
