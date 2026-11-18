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
  porta: Number(env.PORTA || 3000),
  whatsappModo: env.WHATSAPP_MODO || "simulador",
  claudeModelo: env.CLAUDE_MODELO || "claude-opus-5-5",
  adminEmail: (env.ADMIN_EMAIL || "admin@examecontabilidade.com.br").trim().toLowerCase(),
  adminSenha: env.ADMIN_SENHA || "",
  esperaTriagemMs: Number(env.ESPERA_TRIAGEM_SEGUNDOS ?? 8) * 1000,
  assinarRespostas: (env.ASSINAR_RESPOSTAS || "true") !== "false",
  pastaDados,
  arquivoBanco: path.join(pastaDados, "central.db"),
  pastaSessoesWhatsapp: path.join(pastaDados, "sessoes-whatsapp"),
};

export function carregarSetores() {
  const arquivo = path.join(raiz, "config", "setores.json");
  const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  if (!dados.setores?.some((s) => s.id === dados.setorPadrao)) {
    throw new Error(`config/setores.json: setorPadrao "${dados.setorPadrao}" não existe na lista de setores`);
  }
  return dados;
}
