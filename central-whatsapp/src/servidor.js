import path from "node:path";
import express from "express";
import { COOKIE, VALIDADE_REDEFINICAO_MIN, criarLimitador, gerarHash, lerCookie, normalizarEmail } from "./auth.js";
import { mensagemDeRedefinicao } from "./email.js";
import { podeMostrar } from "./arquivos.js";

const publico = ({ senha_hash, ...resto }) => resto;

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

/** Folha de estilo com as cores da marca (config/marca.json). */
function cssDaMarca(cores) {
  return `:root {\n  --azul: ${cores.primaria};\n  --azul-claro: ${cores.primariaClara};\n  --amarelo: ${cores.destaque};\n}\n`;
}

/** Ícone da aba quando não há logo: a inicial do escritório sobre a cor principal. */
function iconeDaMarca(marca) {
  const inicial = (marca.nome.trim()[0] || "?").toUpperCase().replace(/[<>&"']/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" rx="14" fill="${marca.cores.primaria}"/>` +
    `<rect x="10" y="44" width="36" height="5" rx="2.5" fill="${marca.cores.destaque}"/>` +
    `<text x="28" y="37" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="bold" fill="#fff">${inicial}</text></svg>`;
}

/** Senha nova: mínimo de 8 caracteres (e um teto, para não pesar no cálculo do hash). */
function validarSenha(senha) {
  if (typeof senha !== "string" || senha.length < 8) throw new ErroHttp(400, "A senha deve ter pelo menos 8 caracteres.");
  if (senha.length > 200) throw new ErroHttp(400, "A senha pode ter no máximo 200 caracteres.");
  return senha;
}

export function criarServidor({ banco, central, auth, whatsapp, raiz, marca, email, urlPainel, entrada = null, backup = null, arquivos = null, cookieSeguro = false, log = console }) {
  const app = express();
  app.disable("x-powered-by");
  // Atrás de um proxy reverso (Nginx, Caddy), use TRUST_PROXY=1 para req.ip ser o IP real do usuário.
  if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  // O simulador aceita um arquivo de teste junto da mensagem; as demais rotas só recebem textos curtos.
  app.use("/api/simulador", express.json({ limit: "12mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
    });
    next();
  });
  // Verificação de saúde para a hospedagem (sem dados).
  app.get("/saude", (req, res) => res.json({ ok: true }));

  // Identidade visual (pública: aparece na tela de login).
  app.get("/marca.css", (req, res) => res.type("css").set("Cache-Control", "no-cache").send(cssDaMarca(marca.cores)));
  app.get("/icone", (req, res) => {
    if (marca.icone) return res.redirect(`/${marca.icone}`);
    res.type("svg").set("Cache-Control", "no-cache").send(iconeDaMarca(marca));
  });
  app.get("/api/marca", (req, res) => res.json({ nome: marca.nome, subtitulo: marca.subtitulo, logo: marca.logo ? `/${marca.logo}` : null }));
  // Indicadores e notícias da tela de entrada (dados públicos, os mesmos dos painéis da Central de Painéis).
  app.get("/api/entrada", (req, res) => {
    const dados = entrada?.dados();
    if (!dados) return res.status(503).json({ erro: "Indicadores indisponíveis no momento." });
    res.set("Cache-Control", "public, max-age=300").json(dados);
  });
  app.use(express.static(path.join(raiz, "public")));

  // ---------- autenticação ----------
  app.post("/api/login", (req, res) => {
    const { senha } = req.body || {};
    const email = normalizarEmail(req.body?.email);
    if (!email || typeof senha !== "string") throw new ErroHttp(400, "Informe e-mail e senha.");
    let sessao;
    try {
      sessao = auth.entrar(email, senha);
    } catch (erro) {
      throw new ErroHttp(401, erro.message);
    }
    res.cookie(COOKIE, sessao.token, { httpOnly: true, sameSite: "strict", secure: cookieSeguro, expires: sessao.expiraEm });
    res.json({ ok: true });
  });

  // ---------- esqueci minha senha ----------
  const limitePorIp = criarLimitador(10, 60 * 60 * 1000);

  app.post("/api/senha/esqueci", (req, res) => {
    const emailInformado = normalizarEmail(req.body?.email);
    if (!emailInformado) throw new ErroHttp(400, "Informe um e-mail válido.");
    if (!limitePorIp(req.ip)) throw new ErroHttp(429, "Muitos pedidos deste computador. Tente de novo mais tarde.");
    const pedido = auth.pedirRedefinicao(emailInformado);
    if (pedido) {
      // O token vai no fragmento (#): o navegador não o envia ao servidor nem a outros sites.
      const link = `${urlPainel}/#redefinir=${pedido.token}`;
      const msg = mensagemDeRedefinicao({ nome: pedido.atendente.nome, link, validadeMinutos: VALIDADE_REDEFINICAO_MIN, marca });
      // Envio em segundo plano: a resposta tem o mesmo tempo e conteúdo exista ou não o e-mail.
      email.enviar({ para: pedido.atendente.email, ...msg }).catch((erro) => log.error("Falha ao enviar e-mail de redefinição:", erro.message));
    }
    res.json({ ok: true });
  });

  app.post("/api/senha/redefinir", (req, res) => {
    const senha = validarSenha(req.body?.senha);
    try {
      auth.redefinirSenha(req.body?.token, senha);
    } catch (erro) {
      throw new ErroHttp(400, erro.message);
    }
    res.clearCookie(COOKIE);
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

  /** Regra de acesso: administrador vê tudo; os demais precisam do setor E do número do atendimento. */
  const podeVer = (atendente, a) =>
    atendente.admin || (atendente.setores.includes(a.setor_id) && atendente.canais.includes(a.canal_id));

  /** Carrega o atendimento da rota, conferindo se o atendente pode vê-lo. */
  function atendimentoDaRota(req) {
    const a = banco.buscarAtendimento(Number(req.params.id));
    if (!a) throw new ErroHttp(404, "Atendimento não encontrado.");
    if (!podeVer(req.atendente, a)) throw new ErroHttp(403, "Você não tem acesso a este atendimento.");
    return a;
  }

  /** Estado de conexão de cada número que o atendente pode ver (sem o QR code). */
  function canaisVisiveis(atendente) {
    return banco
      .listarCanais({ inativos: atendente.admin })
      .filter((c) => atendente.admin || atendente.canais.includes(c.id))
      .map((c) => ({ id: c.id, nome: c.nome, ativo: c.ativo, status: whatsapp.estado(c.id).status }));
  }

  app.get("/api/eu", (req, res) => {
    res.json({
      atendente: publico(req.atendente),
      setores: banco.listarSetores(),
      colegas: banco.listarAtendentes().filter((t) => t.ativo).map(({ id, nome, setores, canais }) => ({ id, nome, setores, canais })),
      canais: canaisVisiveis(req.atendente),
      modo: whatsapp.modo,
      iaAtiva: !!central.classificar,
    });
  });

  // ---------- atendimentos ----------
  app.get("/api/atendimentos", (req, res) => {
    const { escopo = "meus", resolvidos } = req.query;
    const filtro = { resolvidos: resolvidos === "1" };
    if (escopo === "meus") filtro.atendenteId = req.atendente.id;
    if (!req.atendente.admin) {
      filtro.setores = req.atendente.setores;
      filtro.canais = req.atendente.canais;
    }
    res.json(banco.listarAtendimentos(filtro));
  });

  app.get("/api/atendimentos/:id", (req, res) => {
    const atendimento = atendimentoDaRota(req);
    const mensagens = banco.mensagensDoAtendimento(atendimento.id).map(({ arquivo_local, arquivo_drive_id, ...m }) => ({
      ...m,
      arquivo_disponivel: Boolean(m.arquivo_nome && (arquivo_local || arquivo_drive_id)),
      arquivo_mostra: Boolean(m.arquivo_nome) && podeMostrar(m.arquivo_mime),
    }));
    res.json({ atendimento, mensagens });
  });

  // Arquivo de uma mensagem (foto, documento, vídeo, áudio). Mesma regra de acesso do atendimento;
  // arquivos de mensagens sem atendimento (ignoradas pela triagem) só o administrador abre.
  app.get("/api/arquivos/:id", async (req, res) => {
    const m = banco.buscarMensagemComArquivo(Number(req.params.id));
    if (!m) throw new ErroHttp(404, "Arquivo não encontrado.");
    const liberado = req.atendente.admin || (m.setor_id && podeVer(req.atendente, m));
    if (!liberado) throw new ErroHttp(403, "Você não tem acesso a este arquivo.");
    let conteudo;
    try {
      conteudo = await arquivos?.abrir(m);
    } catch (erro) {
      throw new ErroHttp(502, `Não foi possível buscar o arquivo no Google Drive: ${erro.message}`);
    }
    if (!conteudo) throw new ErroHttp(404, "Este arquivo não está mais disponível.");
    const nome = encodeURIComponent(m.arquivo_nome);
    res.set({
      "Content-Type": podeMostrar(m.arquivo_mime) ? m.arquivo_mime : "application/octet-stream",
      "Content-Disposition": `${podeMostrar(m.arquivo_mime) ? "inline" : "attachment"}; filename*=UTF-8''${nome}`,
      "Cache-Control": "private, max-age=3600",
    });
    res.send(conteudo);
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
      if (!destino?.ativo || !destino.setores.includes(setorId) || !destino.canais.includes(a.canal_id)) {
        throw new ErroHttp(400, "Este atendente não atende o setor escolhido neste número de WhatsApp.");
      }
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
  // Números de WhatsApp (canais)
  const canalDaRota = (req) => {
    const canal = banco.buscarCanal(Number(req.params.id));
    if (!canal) throw new ErroHttp(404, "Número não encontrado.");
    return canal;
  };
  const nomeDoCanal = (corpo) => {
    const nome = typeof corpo?.nome === "string" ? corpo.nome.trim() : "";
    if (!nome || nome.length > 40) throw new ErroHttp(400, "Dê um nome ao número (até 40 caracteres).");
    return nome;
  };

  app.get("/api/canais", exigirAdmin, (req, res) => {
    res.json(banco.listarCanais({ inativos: true }).map((c) => ({ ...c, ...whatsapp.estado(c.id) })));
  });

  app.post("/api/canais", exigirAdmin, async (req, res) => {
    const id = banco.criarCanal(nomeDoCanal(req.body));
    await whatsapp.iniciarCanal(id);
    central.emit("mudou", { canalId: id });
    res.status(201).json({ id });
  });

  app.put("/api/canais/:id", exigirAdmin, async (req, res) => {
    const canal = canalDaRota(req);
    const dados = {};
    if (req.body?.nome !== undefined) dados.nome = nomeDoCanal(req.body);
    if (req.body?.ativo !== undefined) dados.ativo = !!req.body.ativo;
    banco.atualizarCanal(canal.id, dados);
    if (dados.ativo === true) await whatsapp.iniciarCanal(canal.id);
    if (dados.ativo === false) await whatsapp.pararCanal(canal.id);
    central.emit("mudou", { canalId: canal.id });
    res.json({ ok: true });
  });

  app.post("/api/canais/:id/desvincular", exigirAdmin, async (req, res) => {
    const canal = canalDaRota(req);
    if (!canal.ativo) throw new ErroHttp(400, "Reative o número antes de vincular outro aparelho.");
    await whatsapp.desvincularCanal(canal.id);
    central.emit("mudou", { canalId: canal.id });
    res.json({ ok: true });
  });

  // Backup no Google Drive
  app.get("/api/backup", exigirAdmin, (req, res) => res.json(backup ? backup.status() : { configurado: false, ultimo: null }));
  app.post("/api/backup/agora", exigirAdmin, async (req, res) => {
    if (!backup) throw new ErroHttp(503, "Backup indisponível.");
    res.json(await backup.executar(`manual (${req.atendente.nome})`));
  });

  app.get("/api/atendentes", exigirAdmin, (req, res) => res.json(banco.listarAtendentes().map(publico)));

  function validarAtendente(corpo, { novo }) {
    const dados = {};
    const setoresValidos = banco.listarSetores().map((s) => s.id);
    const canaisValidos = banco.listarCanais({ inativos: true }).map((c) => c.id);
    if (novo || corpo.nome !== undefined) {
      if (typeof corpo.nome !== "string" || !corpo.nome.trim()) throw new ErroHttp(400, "Informe o nome.");
      dados.nome = corpo.nome.trim();
    }
    if (novo || corpo.email !== undefined) {
      dados.email = normalizarEmail(corpo.email);
      if (!dados.email) throw new ErroHttp(400, "Informe um e-mail válido.");
    }
    if (corpo.canais !== undefined) {
      if (!Array.isArray(corpo.canais) || corpo.canais.some((c) => !canaisValidos.includes(c))) throw new ErroHttp(400, "Número de WhatsApp inválido.");
      dados.canais = corpo.canais;
    }
    if (novo || corpo.senha) dados.senhaHash = gerarHash(validarSenha(corpo.senha));
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
    if (banco.buscarAtendentePorEmail(dados.email)) throw new ErroHttp(409, "Já existe um atendente com este e-mail.");
    res.status(201).json({ id: banco.criarAtendente(dados) });
  });

  app.put("/api/atendentes/:id", exigirAdmin, (req, res) => {
    const alvo = banco.buscarAtendente(Number(req.params.id));
    if (!alvo) throw new ErroHttp(404, "Atendente não encontrado.");
    const dados = validarAtendente(req.body || {}, { novo: false });
    const outro = dados.email && banco.buscarAtendentePorEmail(dados.email);
    if (outro && outro.id !== alvo.id) throw new ErroHttp(409, "Já existe um atendente com este e-mail.");
    const deixaDeSerAdmin = alvo.admin && alvo.ativo && (dados.admin === false || dados.ativo === false);
    if (deixaDeSerAdmin && banco.contarAdminsAtivos() <= 1) throw new ErroHttp(400, "É preciso manter pelo menos um administrador ativo.");
    banco.atualizarAtendente(alvo.id, dados);
    res.json({ ok: true });
  });

  // ---------- simulador (só existe no modo de testes) ----------
  if (whatsapp.modo === "simulador") {
    app.post("/api/simulador/mensagem", exigirAdmin, (req, res) => {
      const { canalId, chatNome, chatTipo, autorNome, texto, arquivo } = req.body || {};
      const anexo = arquivo && typeof arquivo.base64 === "string" && typeof arquivo.nome === "string"
        ? { nome: arquivo.nome, mime: String(arquivo.mime || ""), buffer: Buffer.from(arquivo.base64, "base64") }
        : null;
      const tipoAnexo = !anexo ? "texto" : anexo.mime.startsWith("image/") ? "imagem" : anexo.mime.startsWith("audio/") ? "audio" : anexo.mime.startsWith("video/") ? "video" : "documento";
      if (!banco.buscarCanal(Number(canalId))?.ativo) throw new ErroHttp(400, "Escolha um número ativo.");
      if (![chatNome, autorNome].every((v) => typeof v === "string" && v.trim()) || typeof texto !== "string" || (!texto.trim() && !anexo)) {
        throw new ErroHttp(400, "Preencha grupo, autor e a mensagem (ou anexe um arquivo).");
      }
      const rotulo = { imagem: "[imagem]", audio: "[áudio]", video: "[vídeo]", documento: `[documento: ${anexo?.nome}]` }[tipoAnexo];
      whatsapp.simularRecebimento(Number(canalId), {
        chatNome: chatNome.trim(), chatTipo: chatTipo === "privado" ? "privado" : "grupo", autorNome: autorNome.trim(),
        texto: [rotulo, texto.trim()].filter(Boolean).join(" "), tipo: tipoAnexo, arquivo: anexo,
      });
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
