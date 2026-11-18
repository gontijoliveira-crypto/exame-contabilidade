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

export const gerarSenha = () => randomBytes(9).toString("base64url");

export function criarAuth(banco) {
  const falhas = new Map(); // usuario -> { n, ate }

  return {
    /** Devolve { token, expiraEm } ou lança erro com mensagem para o usuário. */
    entrar(usuario, senha) {
      const f = falhas.get(usuario);
      if (f && f.n >= MAX_FALHAS && f.ate > Date.now()) {
        throw new Error("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
      }
      const atendente = banco.buscarAtendentePorUsuario(usuario);
      if (!atendente || !atendente.ativo || !conferirSenha(senha, atendente.senha_hash)) {
        const n = f && f.ate > Date.now() ? f.n + 1 : 1;
        falhas.set(usuario, { n, ate: Date.now() + BLOQUEIO_MS });
        throw new Error("Usuário ou senha incorretos.");
      }
      falhas.delete(usuario);
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
