import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Carrega o .env (se existir) sem sobrescrever variáveis já definidas no ambiente.
const arquivoEnv = path.join(raiz, ".env");
if (fs.existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);

const env = process.env;
const pastaDados = path.resolve(raiz, env.PASTA_DADOS || "./dados");

export const config = {
  raiz,
  porta: Number(env.PORTA || env.PORT || 3000), // PORT é a variável usada pelas hospedagens (Railway, Render, Fly)
  whatsappModo: env.WHATSAPP_MODO || "simulador",
  claudeModelo: env.CLAUDE_MODELO || "claude-opus-5-5",
  adminEmail: (env.ADMIN_EMAIL || "admin@escritorio.com.br").trim().toLowerCase(),
  // Endereço pelo qual os atendentes abrem o painel; usado nos links enviados por e-mail.
  urlPainel: (env.URL_PAINEL || `http://localhost:${env.PORTA || env.PORT || 3000}`).replace(/\/+$/, ""),
  backup: {
    // Endereço do app da Web do Apps Script de backup (termina em /exec) e o segredo combinado com ele.
    url: env.BACKUP_URL || "",
    segredo: env.BACKUP_SEGREDO || "",
    horarios: (env.BACKUP_HORARIOS || "00:00,06:00,12:00,18:00").split(",").map((h) => h.trim()).filter(Boolean),
    retencaoDias: Number(env.BACKUP_RETENCAO_DIAS || 30),
    pastaLocal: path.join(pastaDados, "backups"),
  },
  smtp: {
    host: env.SMTP_HOST || "",
    porta: Number(env.SMTP_PORTA || 587),
    usuario: env.SMTP_USUARIO || "",
    senha: env.SMTP_SENHA || "",
    remetente: env.SMTP_REMETENTE || env.SMTP_USUARIO || "",
  },
  adminSenha: env.ADMIN_SENHA || "",
  esperaTriagemMs: Number(env.ESPERA_TRIAGEM_SEGUNDOS ?? 8) * 1000,
  assinarRespostas: (env.ASSINAR_RESPOSTAS || "true") !== "false",
  pastaDados,
  arquivoBanco: path.join(pastaDados, "central.db"),
  pastaSessoesWhatsapp: path.join(pastaDados, "sessoes-whatsapp"),
};

const COR = /^#[0-9a-fA-F]{6}$/;

/** Identidade visual do escritório (nome, logo e cores), em config/marca.json. */
export function carregarMarca() {
  const marca = JSON.parse(fs.readFileSync(path.join(raiz, "config", "marca.json"), "utf8"));
  for (const [chave, valor] of Object.entries(marca.cores || {})) {
    if (!COR.test(valor)) throw new Error(`config/marca.json: cor "${chave}" deve estar no formato #RRGGBB`);
  }
  for (const campo of ["logo", "icone"]) {
    if (marca[campo] && !fs.existsSync(path.join(raiz, "public", marca[campo]))) {
      throw new Error(`config/marca.json: arquivo "${campo}" não encontrado em public/${marca[campo]}`);
    }
  }
  return marca;
}

/** Tela de entrada no padrão da Central de Painéis (config/entrada.json). ENTRADA_FONTE troca a fonte dos indicadores. */
export function carregarEntrada() {
  const entrada = JSON.parse(fs.readFileSync(path.join(raiz, "config", "entrada.json"), "utf8"));
  return { ...entrada, fonte: env.ENTRADA_FONTE ?? entrada.fonte, arquivoCache: path.join(pastaDados, "indicadores-entrada.json") };
}

export function carregarSetores() {
  const arquivo = path.join(raiz, "config", "setores.json");
  const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  if (!dados.setores?.some((s) => s.id === dados.setorPadrao)) {
    throw new Error(`config/setores.json: setorPadrao "${dados.setorPadrao}" não existe na lista de setores`);
  }
  return dados;
}
