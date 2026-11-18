import fs from "node:fs";
import makeWASocket, {
  Browsers,
  downloadMediaMessage,
  DisconnectReason,
  fetchLatestBaileysVersion,
  normalizeMessageContent,
  useMultiFileAuthState,
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";

/** Converte o conteúdo de uma mensagem do WhatsApp em { tipo, texto } legível; null se não interessa. */
export function extrairConteudo(mensagem) {
  const c = normalizeMessageContent(mensagem);
  if (!c) return null;
  const comLegenda = (rotulo, legenda) => (legenda ? `${rotulo} ${legenda}` : rotulo);

  if (c.conversation) return { tipo: "texto", texto: c.conversation };
  if (c.extendedTextMessage?.text) return { tipo: "texto", texto: c.extendedTextMessage.text };
  // `midia` descreve o arquivo a baixar: { mime, nome (só documentos têm), tamanho em bytes }.
  const midia = (m) => ({ mime: m.mimetype || "", nome: m.fileName || "", tamanho: Number(m.fileLength || 0) });
  if (c.imageMessage) return { tipo: "imagem", texto: comLegenda("[imagem]", c.imageMessage.caption), midia: midia(c.imageMessage) };
  if (c.videoMessage) return { tipo: "video", texto: comLegenda("[vídeo]", c.videoMessage.caption), midia: midia(c.videoMessage) };
  if (c.documentMessage) {
    return {
      tipo: "documento",
      texto: comLegenda(`[documento: ${c.documentMessage.fileName || "sem nome"}]`, c.documentMessage.caption),
      midia: midia(c.documentMessage),
    };
  }
  if (c.audioMessage) return { tipo: "audio", texto: "[áudio]", midia: midia(c.audioMessage) };
  if (c.stickerMessage) return { tipo: "figurinha", texto: "[figurinha]" };
  if (c.locationMessage) return { tipo: "localizacao", texto: "[localização]" };
  if (c.contactMessage) return { tipo: "contato", texto: `[contato: ${c.contactMessage.displayName || ""}]` };
  return null; // reações, enquetes, mensagens de protocolo etc.
}

/**
 * Adaptador do WhatsApp real, via Baileys (protocolo do WhatsApp Web).
 * O número é pareado lendo o QR code com o celular, como no WhatsApp Web.
 */
export function criarBaileys({ pastaSessao, maxArquivoBytes = 25 * 1048576, log = console }) {
  let sock = null;
  let aoReceber = () => {};
  let aoMudar = () => {};
  let estado = { modo: "baileys", status: "desconectado", qr: null, numero: null };
  let parado = false;
  let reconexao = null;
  const nomesDosGrupos = new Map();
  const enviadasPeloPainel = new Set();

  const definirEstado = (novo) => {
    estado = { ...estado, ...novo };
    aoMudar(estado);
  };

  async function nomeDoGrupo(jid) {
    if (!nomesDosGrupos.has(jid)) {
      try {
        nomesDosGrupos.set(jid, (await sock.groupMetadata(jid)).subject);
      } catch {
        return "";
      }
    }
    return nomesDosGrupos.get(jid);
  }

  async function tratarMensagem(m) {
    const jid = m.key.remoteJid;
    if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) return;
    if (m.key.fromMe && enviadasPeloPainel.delete(m.key.id)) return; // já registrada ao enviar

    const conteudo = extrairConteudo(m.message);
    if (!conteudo) return;

    // Baixa a foto, documento, vídeo ou áudio na chegada (o WhatsApp não guarda os arquivos para sempre).
    let arquivo = null;
    if (conteudo.midia && conteudo.midia.tamanho <= maxArquivoBytes) {
      try {
        const buffer = await downloadMediaMessage(m, "buffer", {}, { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage });
        if (buffer.length <= maxArquivoBytes) arquivo = { nome: conteudo.midia.nome, mime: conteudo.midia.mime, buffer };
      } catch (erro) {
        log.error("Não foi possível baixar o arquivo de uma mensagem:", erro.message);
      }
    }
    const semArquivo = conteudo.midia && !arquivo
      ? conteudo.midia.tamanho > maxArquivoBytes ? " (arquivo não guardado: maior que o limite)" : " (arquivo não guardado: falha ao baixar)"
      : "";

    const grupo = jid.endsWith("@g.us");
    const autorJid = grupo ? m.key.participantAlt || m.key.participant || "" : m.key.remoteJidAlt || jid;
    aoReceber({
      waId: m.key.id,
      chatJid: jid,
      chatNome: grupo ? await nomeDoGrupo(jid) : m.key.fromMe ? "" : m.pushName || "",
      chatTipo: grupo ? "grupo" : "privado",
      autorJid,
      autorNome: m.pushName || autorJid.split("@")[0],
      texto: conteudo.texto + semArquivo,
      tipo: conteudo.tipo,
      arquivo,
      criadoEm: new Date(Number(m.messageTimestamp || Date.now() / 1000) * 1000).toISOString(),
      enviadaPorNos: !!m.key.fromMe,
    });
  }

  async function conectar() {
    if (parado) return;
    const { state, saveCreds } = await useMultiFileAuthState(pastaSessao);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
    const atual = makeWASocket({
      auth: state,
      version,
      browser: Browsers.appropriate("Central de Atendimento"),
      logger: pino({ level: "silent" }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock = atual;

    atual.ev.on("creds.update", saveCreds);

    atual.ev.on("groups.update", (grupos) => {
      for (const g of grupos) if (g.id && g.subject) nomesDosGrupos.set(g.id, g.subject);
    });

    atual.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        definirEstado({ status: "aguardando_qr", qr: await QRCode.toDataURL(qr, { width: 320 }) });
        log.info("\nLeia o QR code abaixo com o WhatsApp do escritório (Aparelhos conectados > Conectar um aparelho):\n");
        log.info(await QRCode.toString(qr, { type: "terminal", small: true }));
      }
      if (connection === "open") {
        definirEstado({ status: "conectado", qr: null, numero: (sock.user?.id || "").split(/[:@]/)[0] || null });
        log.info("WhatsApp conectado.");
      }
      if (connection === "close") {
        const codigo = lastDisconnect?.error?.output?.statusCode;
        definirEstado({ status: "desconectado", qr: null });
        // Fechamento de uma conexão antiga (já substituída ao desvincular): não reconecta.
        if (parado || sock !== atual) return;
        if (codigo === DisconnectReason.loggedOut) {
          log.warn("Sessão do WhatsApp encerrada pelo celular. Será preciso ler o QR code novamente.");
          fs.rmSync(pastaSessao, { recursive: true, force: true });
        }
        reconexao = setTimeout(() => conectar().catch((e) => log.error("Falha ao reconectar ao WhatsApp:", e.message)), 3000);
      }
    });

    atual.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return; // ignora histórico antigo sincronizado na conexão
      for (const m of messages) {
        try {
          await tratarMensagem(m);
        } catch (erro) {
          log.error("Erro ao tratar mensagem do WhatsApp:", erro);
        }
      }
    });
  }

  return {
    modo: "baileys",
    aoReceberMensagem: (fn) => (aoReceber = fn),
    aoMudarEstado: (fn) => (aoMudar = fn),
    iniciar: conectar,
    estado: () => estado,
    /** Encerra a conexão sem desvincular o aparelho (a sessão continua válida). */
    async parar() {
      parado = true;
      clearTimeout(reconexao);
      try { sock?.end(undefined); } catch { /* já estava fechada */ }
      definirEstado({ status: "desconectado", qr: null });
    },
    /** Desvincula o número (some de "Aparelhos conectados") e apaga a sessão; será preciso novo QR code. */
    async desvincular() {
      parado = true;
      clearTimeout(reconexao);
      try { await sock?.logout(); } catch { /* sem conexão: basta apagar a sessão */ }
      fs.rmSync(pastaSessao, { recursive: true, force: true });
      definirEstado({ status: "desconectado", qr: null, numero: null });
      parado = false;
    },
    async enviarTexto(jid, texto) {
      if (estado.status !== "conectado") throw new Error("WhatsApp desconectado. Verifique a conexão no painel.");
      const enviada = await sock.sendMessage(jid, { text: texto });
      enviadasPeloPainel.add(enviada.key.id);
      return { waId: enviada.key.id };
    },
  };
}
