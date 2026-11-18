import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000; // um expediente
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
export const COOKIE = "central_sessao";

export function gerarHash(senha) {
  const sal = randomBytes(16);
  return `${sal.toString("hex")}:${scryptSync(senha, sal, 64).toString("hex")}`;
}

export function conferirSenha(senha, hash) {
  const [sal, esperado] = hash.split(":");
  const calculado = scryptSync(senha, Buffer.from(sal, "hex"), 64);
  return timingSafeEqual(calculado, Buffer.from(esperado, "hex"));
}

/** Normaliza o e-mail (minúsculas, sem espaços); devolve null se não parecer um e-mail. */
export function normalizarEmail(valor) {
  if (typeof valor !== "string") return null;
  const email = valor.trim().toLowerCase();
  return email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export const gerarSenha = () => randomBytes(9).toString("base64url");

export function criarAuth(banco) {
  const falhas = new Map(); // e-mail -> { n, ate }

  return {
    /** Devolve { token, expiraEm } ou lança erro com mensagem para o usuário. */
    entrar(email, senha) {
      const f = falhas.get(email);
      if (f && f.n >= MAX_FALHAS && f.ate > Date.now()) {
        throw new Error("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
      }
      const atendente = banco.buscarAtendentePorEmail(email);
      if (!atendente || !atendente.ativo || !conferirSenha(senha, atendente.senha_hash)) {
        const n = f && f.ate > Date.now() ? f.n + 1 : 1;
        falhas.set(email, { n, ate: Date.now() + BLOQUEIO_MS });
        throw new Error("E-mail ou senha incorretos.");
      }
      falhas.delete(email);
      const token = randomBytes(32).toString("base64url");
      const expiraEm = new Date(Date.now() + DURACAO_SESSAO_MS);
      banco.criarSessao(token, atendente.id, expiraEm.toISOString());
      return { token, expiraEm };
    },
    sair: (token) => token && banco.apagarSessao(token),
    /** Atendente da sessão, ou null. */
    atendenteDaSessao(token) {
      if (!token) return null;
      const sessao = banco.buscarSessao(token);
      if (!sessao) return null;
      const atendente = banco.buscarAtendente(sessao.atendente_id);
      return atendente?.ativo ? atendente : null;
    },
  };
}

export function lerCookie(req, nome) {
  for (const parte of (req.headers.cookie || "").split(";")) {
    const [chave, ...valor] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(valor.join("="));
  }
  return null;
}
