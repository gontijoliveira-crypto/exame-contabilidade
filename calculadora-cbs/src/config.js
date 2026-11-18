import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Carrega o .env (se existir) sem sobrescrever variáveis já definidas no ambiente.
const arquivoEnv = path.join(raiz, ".env");
if (fs.existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);

const API_DA_RECEITA = "https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api";

/** Endereço público da página (usado na prévia do link ao compartilhar). Vazio quando não há. */
export function lerUrlPublica(env) {
  const informado = (env.URL_PUBLICA || "").trim();
  const bruto = informado || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN.trim()}` : "");
  if (!bruto) return "";
  let url;
  try {
    url = new URL(bruto);
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol)) {
    if (informado) throw new Error(`URL_PUBLICA inválida: "${informado}". Use o endereço completo, por exemplo https://calculadora.exemplo.com.br`);
    return "";
  }
  return url.origin;
}

/** Quantos proxies reversos ficam à frente do servidor (0 = nenhum; 1 = Render, Fly, Nginx...). */
export function lerProxies(env) {
  const bruto = (env.TRUST_PROXY || "").trim();
  if (!bruto) return 0;
  if (!/^\d$/.test(bruto)) throw new Error(`TRUST_PROXY inválido: "${bruto}". Use o número de proxies à frente do servidor (por exemplo 1).`);
  return Number(bruto);
}

/**
 * De onde vem o IP do visitante, usado só para o limite de pedidos por pessoa.
 * No Railway a borda da hospedagem grava o IP em X-Real-IP (é o cabeçalho documentado por eles), e isso
 * é detectado sozinho. Em outras hospedagens, use TRUST_PROXY (conta o X-Forwarded-For a partir do fim)
 * ou CABECALHO_IP (nome do cabeçalho que a hospedagem preenche com o IP do visitante).
 */
export function lerOrigemDoIp(env) {
  const informado = (env.CABECALHO_IP || "").trim().toLowerCase();
  if (informado && !/^[a-z0-9-]+$/.test(informado)) throw new Error(`CABECALHO_IP inválido: "${informado}". Use o nome de um cabeçalho, por exemplo x-real-ip.`);
  const noRailway = Object.keys(env).some((nome) => nome.startsWith("RAILWAY_"));
  return { cabecalhoIp: informado || (noRailway ? "x-real-ip" : ""), proxies: lerProxies(env) || (noRailway ? 1 : 0) };
}

export function lerConfig(env = process.env) {
  const porta = Number(env.PORTA || env.PORT || 3000); // PORT é a variável usada pelas hospedagens (Railway, Render, Fly)
  if (!Number.isInteger(porta) || porta < 0 || porta > 65535) throw new Error(`Porta inválida: "${env.PORTA || env.PORT}"`);
  const receitaApi = (env.RECEITA_API || API_DA_RECEITA).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(receitaApi)) throw new Error(`RECEITA_API inválida: "${receitaApi}"`);
  return { raiz, porta, receitaApi, urlPublica: lerUrlPublica(env), origemDoIp: lerOrigemDoIp(env) };
}

const COR = /^#[0-9a-fA-F]{6}$/;

/** Identidade visual do escritório (nome, logo e cores), em config/marca.json. Mesmo formato da Central de Atendimento. */
export function carregarMarca(pasta = raiz) {
  const marca = JSON.parse(fs.readFileSync(path.join(pasta, "config", "marca.json"), "utf8"));
  if (typeof marca.nome !== "string" || !marca.nome.trim()) throw new Error('config/marca.json: informe o "nome" do escritório');
  for (const chave of ["primaria", "primariaClara", "destaque"]) {
    if (!COR.test(marca.cores?.[chave] || "")) throw new Error(`config/marca.json: cor "${chave}" deve estar no formato #RRGGBB`);
  }
  // "compartilhar" (opcional) é a imagem que aparece na prévia do link no WhatsApp e nas redes sociais.
  for (const campo of ["logo", "icone", "compartilhar"]) {
    if (!marca[campo]) continue;
    if (typeof marca[campo] !== "string" || !/^[\w.-]+(\/[\w.-]+)*$/.test(marca[campo]) || marca[campo].includes("..")) {
      throw new Error(`config/marca.json: "${campo}" deve ser um caminho simples dentro de public/, como marca/logo.png`);
    }
    if (!fs.existsSync(path.join(pasta, "public", marca[campo]))) {
      throw new Error(`config/marca.json: arquivo "${campo}" não encontrado em public/${marca[campo]}`);
    }
  }
  return {
    nome: marca.nome.trim(),
    subtitulo: marca.subtitulo || null,
    logo: marca.logo || null,
    icone: marca.icone || null,
    compartilhar: marca.compartilhar || null,
    cores: marca.cores,
  };
}

const PERCENTUAL = /^\d{1,3}(\.\d{1,4})?$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Apoio à simulação de datas a partir de 2027 (config/simulacao.json): para cada período, as alíquotas
 * que a tela já traz preenchidas, as que aparecem só como exemplo e uma nota explicativa.
 */
export function carregarSimulacao(pasta = raiz) {
  const arquivo = path.join(pasta, "config", "simulacao.json");
  if (!fs.existsSync(arquivo)) return [];
  const { periodos } = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  if (!Array.isArray(periodos)) throw new Error('config/simulacao.json: "periodos" deve ser uma lista');
  const aliquotas = (grupo, onde) => {
    const limpo = {};
    for (const chave of ["cbs", "ibsEstadual", "ibsMunicipal"]) {
      const valor = grupo?.[chave];
      if (valor === undefined || valor === null || valor === "") continue;
      if (typeof valor !== "string" || !PERCENTUAL.test(valor) || Number(valor) > 100) {
        throw new Error(`config/simulacao.json: ${onde}.${chave} deve ser um percentual entre aspas, com ponto decimal (por exemplo "0.05")`);
      }
      limpo[chave] = valor;
    }
    return limpo;
  };
  return periodos.map((p, i) => {
    const onde = `periodos[${i}]`;
    if (!DATA.test(p?.de || "") || !DATA.test(p?.ate || "") || p.de > p.ate) throw new Error(`config/simulacao.json: ${onde} precisa de "de" e "ate" no formato AAAA-MM-DD, com "de" antes de "ate"`);
    if (p.nota !== undefined && typeof p.nota !== "string") throw new Error(`config/simulacao.json: ${onde}.nota deve ser um texto`);
    return { de: p.de, ate: p.ate, preencher: aliquotas(p.preencher, `${onde}.preencher`), exemplo: aliquotas(p.exemplo, `${onde}.exemplo`), nota: (p.nota || "").trim() };
  });
}
