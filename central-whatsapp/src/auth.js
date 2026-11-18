import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000; // um expediente
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
export const COOKIE = "central_sessao";
export const VALIDADE_REDEFINICAO_MIN = 60;
const PEDIDOS_POR_EMAIL = 3; // links de redefinição por e-mail a cada hora
const hashDoToken = (token) => createHash("sha256").update(token).digest("hex");

/** Limite simples em memória: devolve false quando `chave` já fez `max` pedidos na janela. */
export function criarLimitador(max, janelaMs, relogio = Date.now) {
  const pedidos = new Map();
  return (chave) => {
    const agora = relogio();
    const recentes = (pedidos.get(chave) || []).filter((t) => agora - t < janelaMs);
    if (recentes.length >= max) return false;
    recentes.push(agora);
    pedidos.set(chave, recentes);
    if (pedidos.size > 10_000) for (const [k, v] of pedidos) if (v.every((t) => agora - t >= janelaMs)) pedidos.delete(k);
    return true;
  };
}

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

export function criarAuth(banco, { relogio = Date.now } = {}) {
  const falhas = new Map(); // e-mail -> { n, ate }
  const podePedirRedefinicao = criarLimitador(PEDIDOS_POR_EMAIL, 60 * 60 * 1000, relogio);

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

    /**
     * Gera um link de redefinição de senha. Devolve { atendente, token } ou null quando
     * não há atendente ativo com esse e-mail ou o limite de pedidos foi atingido;
     * quem chama responde igual nos dois casos, para não revelar quais e-mails existem.
     */
    pedirRedefinicao(email) {
      const atendente = banco.buscarAtendentePorEmail(email);
      if (!atendente?.ativo || !podePedirRedefinicao(email)) return null;
      const token = randomBytes(32).toString("base64url");
      const expiraEm = new Date(relogio() + VALIDADE_REDEFINICAO_MIN * 60 * 1000).toISOString();
      banco.criarRedefinicao(hashDoToken(token), atendente.id, expiraEm);
      return { atendente, token };
    },

    /** Troca a senha usando o link do e-mail. O link vale uma vez; todas as sessões abertas são encerradas. */
    redefinirSenha(token, novaSenha) {
      const pedido = typeof token === "string" && banco.buscarRedefinicao(hashDoToken(token), new Date(relogio()).toISOString());
      const atendente = pedido && banco.buscarAtendente(pedido.atendente_id);
      if (!atendente?.ativo) throw new Error("Este link é inválido ou expirou. Peça um novo em \"Esqueci minha senha\".");
      banco.atualizarAtendente(atendente.id, { senhaHash: gerarHash(novaSenha) });
      banco.apagarRedefinicoes(atendente.id);
      banco.apagarSessoesDoAtendente(atendente.id);
      falhas.delete(atendente.email);
      return atendente;
    },
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
