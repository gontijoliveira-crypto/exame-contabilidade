import path from "node:path";
import express from "express";
import { COOKIE, gerarHash, lerCookie } from "./auth.js";

const publico = ({ senha_hash, ...resto }) => resto;

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export function criarServidor({ banco, central, auth, whatsapp, raiz, cookieSeguro = false }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
    });
    next();
  });
  app.use(express.static(path.join(raiz, "public")));

  // ---------- autenticação ----------
  app.post("/api/login", (req, res) => {
    const { usuario, senha } = req.body || {};
    if (typeof usuario !== "string" || typeof senha !== "string") throw new ErroHttp(400, "Informe usuário e senha.");
    let sessao;
    try {
      sessao = auth.entrar(usuario.trim().toLowerCase(), senha);
    } catch (erro) {
      throw new ErroHttp(401, erro.message);
    }
    res.cookie(COOKIE, sessao.token, { httpOnly: true, sameSite: "strict", secure: cookieSeguro, expires: sessao.expiraEm });
    res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    auth.sair(lerCookie(req, COOKIE));
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  // Tudo abaixo exige sessão válida.
  app.use("/api", (req, res, next) => {
    req.atendente = auth.atendenteDaSessao(lerCookie(req, COOKIE));
    if (!req.atendente) throw new ErroHttp(401, "Sessão expirada. Entre novamente.");
    next();
  });

  const exigirAdmin = (req, res, next) => {
    if (!req.atendente.admin) throw new ErroHttp(403, "Apenas administradores.");
    next();
  };

  /** Carrega o atendimento da rota, conferindo se o atendente pode vê-lo. */
  function atendimentoDaRota(req) {
    const a = banco.buscarAtendimento(Number(req.params.id));
    if (!a) throw new ErroHttp(404, "Atendimento não encontrado.");
    if (!req.atendente.admin && !req.atendente.setores.includes(a.setor_id)) {
      throw new ErroHttp(403, "Este atendimento é de outro setor.");
    }
    return a;
  }

  app.get("/api/eu", (req, res) => {
    res.json({
      atendente: publico(req.atendente),
      setores: banco.listarSetores(),
      colegas: banco.listarAtendentes().filter((t) => t.ativo).map(({ id, nome, setores }) => ({ id, nome, setores })),
      whatsapp: { modo: whatsapp.modo, status: whatsapp.estado().status },
      iaAtiva: !!central.classificar,
    });
  });

  // ---------- atendimentos ----------
  app.get("/api/atendimentos", (req, res) => {
    const { escopo = "meus", resolvidos } = req.query;
    const filtro = { resolvidos: resolvidos === "1" };
    if (escopo === "meus") filtro.atendenteId = req.atendente.id;
    if (!req.atendente.admin) filtro.setores = req.atendente.setores;
    res.json(banco.listarAtendimentos(filtro));
  });

  app.get("/api/atendimentos/:id", (req, res) => {
    const atendimento = atendimentoDaRota(req);
    res.json({ atendimento, mensagens: banco.mensagensDoAtendimento(atendimento.id) });
  });

  app.post("/api/atendimentos/:id/responder", async (req, res) => {
    const a = atendimentoDaRota(req);
    const texto = typeof req.body?.texto === "string" ? req.body.texto.trim() : "";
    if (!texto) throw new ErroHttp(400, "Escreva a resposta.");
    if (texto.length > 4000) throw new ErroHttp(400, "Resposta muito longa (máximo de 4000 caracteres).");
    try {
      await central.responder(a.id, req.atendente, texto);
    } catch (erro) {
      throw new ErroHttp(502, `Não foi possível enviar: ${erro.message}`);
    }
    res.json({ ok: true });
  });

  app.post("/api/atendimentos/:id/assumir", (req, res) => {
    central.assumir(atendimentoDaRota(req).id, req.atendente);
    res.json({ ok: true });
  });

  app.post("/api/atendimentos/:id/transferir", (req, res) => {
    const a = atendimentoDaRota(req);
    const { setor_id: setorId, atendente_id: atendenteId = null } = req.body || {};
    if (!banco.listarSetores().some((s) => s.id === setorId)) throw new ErroHttp(400, "Setor inválido.");
    if (atendenteId !== null) {
      const destino = banco.buscarAtendente(Number(atendenteId));
      if (!destino?.ativo || !destino.setores.includes(setorId)) throw new ErroHttp(400, "Este atendente não é do setor escolhido.");
    }
    central.transferir(a.id, setorId, atendenteId === null ? null : Number(atendenteId));
    res.json({ ok: true });
  });

  app.post("/api/atendimentos/:id/resolver", (req, res) => {
    central.definirStatus(atendimentoDaRota(req).id, "resolvido");
    res.json({ ok: true });
  });

  app.post("/api/atendimentos/:id/reabrir", (req, res) => {
    central.definirStatus(atendimentoDaRota(req).id, "aberto");
    res.json({ ok: true });
  });

  // ---------- atualizações em tempo real (Server-Sent Events) ----------
  app.get("/api/eventos", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders();
    const avisar = (evento) => res.write(`data: ${JSON.stringify(evento)}\n\n`);
    const pulso = setInterval(() => res.write(": pulso\n\n"), 25000);
    central.on("mudou", avisar);
    req.on("close", () => {
      clearInterval(pulso);
      central.off("mudou", avisar);
    });
  });

  // ---------- administração ----------
  app.get("/api/whatsapp", exigirAdmin, (req, res) => res.json(whatsapp.estado()));

  app.get("/api/atendentes", exigirAdmin, (req, res) => res.json(banco.listarAtendentes().map(publico)));

  function validarAtendente(corpo, { novo }) {
    const dados = {};
    const setoresValidos = banco.listarSetores().map((s) => s.id);
    if (novo || corpo.nome !== undefined) {
      if (typeof corpo.nome !== "string" || !corpo.nome.trim()) throw new ErroHttp(400, "Informe o nome.");
      dados.nome = corpo.nome.trim();
    }
    if (novo) {
      if (typeof corpo.usuario !== "string" || !/^[a-z0-9._-]{3,30}$/.test(corpo.usuario.trim().toLowerCase())) {
        throw new ErroHttp(400, "Usuário deve ter de 3 a 30 caracteres: letras, números, ponto, hífen ou sublinhado.");
      }
      dados.usuario = corpo.usuario.trim().toLowerCase();
    }
    if (novo || corpo.senha) {
      if (typeof corpo.senha !== "string" || corpo.senha.length < 8) throw new ErroHttp(400, "A senha deve ter pelo menos 8 caracteres.");
      dados.senhaHash = gerarHash(corpo.senha);
    }
    if (corpo.setores !== undefined) {
      if (!Array.isArray(corpo.setores) || corpo.setores.some((s) => !setoresValidos.includes(s))) throw new ErroHttp(400, "Setor inválido.");
      dados.setores = corpo.setores;
    }
    if (corpo.admin !== undefined) dados.admin = !!corpo.admin;
    if (corpo.ativo !== undefined) dados.ativo = !!corpo.ativo;
    return dados;
  }

  app.post("/api/atendentes", exigirAdmin, (req, res) => {
    const dados = validarAtendente(req.body || {}, { novo: true });
    if (banco.buscarAtendentePorUsuario(dados.usuario)) throw new ErroHttp(409, "Já existe um atendente com este usuário.");
    res.status(201).json({ id: banco.criarAtendente(dados) });
  });

  app.put("/api/atendentes/:id", exigirAdmin, (req, res) => {
    const alvo = banco.buscarAtendente(Number(req.params.id));
    if (!alvo) throw new ErroHttp(404, "Atendente não encontrado.");
    const dados = validarAtendente(req.body || {}, { novo: false });
    const deixaDeSerAdmin = alvo.admin && alvo.ativo && (dados.admin === false || dados.ativo === false);
    if (deixaDeSerAdmin && banco.contarAdminsAtivos() <= 1) throw new ErroHttp(400, "É preciso manter pelo menos um administrador ativo.");
    banco.atualizarAtendente(alvo.id, dados);
    res.json({ ok: true });
  });

  // ---------- simulador (só existe no modo de testes) ----------
  if (whatsapp.modo === "simulador") {
    app.post("/api/simulador/mensagem", exigirAdmin, (req, res) => {
      const { chatNome, chatTipo, autorNome, texto } = req.body || {};
      if (![chatNome, autorNome, texto].every((v) => typeof v === "string" && v.trim())) {
        throw new ErroHttp(400, "Preencha grupo, autor e mensagem.");
      }
      whatsapp.simularRecebimento({ chatNome: chatNome.trim(), chatTipo: chatTipo === "privado" ? "privado" : "grupo", autorNome: autorNome.trim(), texto: texto.trim() });
      res.json({ ok: true });
    });
  }

  app.use("/api", (req, res) => res.status(404).json({ erro: "Rota não encontrada." }));

  // eslint-disable-next-line no-unused-vars
  app.use((erro, req, res, next) => {
    const status = erro.status || 500;
    if (status === 500) console.error(erro);
    res.status(status).json({ erro: status === 500 ? "Erro interno." : erro.message });
  });

  return app;
}
