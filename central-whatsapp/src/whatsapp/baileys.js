import fs from "node:fs";
import makeWASocket, {
  Browsers,
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
  if (c.imageMessage) return { tipo: "imagem", texto: comLegenda("[imagem]", c.imageMessage.caption) };
  if (c.videoMessage) return { tipo: "video", texto: comLegenda("[vídeo]", c.videoMessage.caption) };
  if (c.documentMessage) {
    return { tipo: "documento", texto: comLegenda(`[documento: ${c.documentMessage.fileName || "sem nome"}]`, c.documentMessage.caption) };
  }
  if (c.audioMessage) return { tipo: "audio", texto: "[áudio]" };
  if (c.stickerMessage) return { tipo: "figurinha", texto: "[figurinha]" };
  if (c.locationMessage) return { tipo: "localizacao", texto: "[localização]" };
  if (c.contactMessage) return { tipo: "contato", texto: `[contato: ${c.contactMessage.displayName || ""}]` };
  return null; // reações, enquetes, mensagens de protocolo etc.
}

/**
 * Adaptador do WhatsApp real, via Baileys (protocolo do WhatsApp Web).
 * O número é pareado lendo o QR code com o celular, como no WhatsApp Web.
 */
export function criarBaileys({ pastaSessao, log = console }) {
  let sock = null;
  let aoReceber = () => {};
  let aoMudar = () => {};
  let estado = { modo: "baileys", status: "desconectado", qr: null };
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

    const grupo = jid.endsWith("@g.us");
    const autorJid = grupo ? m.key.participantAlt || m.key.participant || "" : m.key.remoteJidAlt || jid;
    aoReceber({
      waId: m.key.id,
      chatJid: jid,
      chatNome: grupo ? await nomeDoGrupo(jid) : m.key.fromMe ? "" : m.pushName || "",
      chatTipo: grupo ? "grupo" : "privado",
      autorJid,
      autorNome: m.pushName || autorJid.split("@")[0],
      texto: conteudo.texto,
      tipo: conteudo.tipo,
      criadoEm: new Date(Number(m.messageTimestamp || Date.now() / 1000) * 1000).toISOString(),
      enviadaPorNos: !!m.key.fromMe,
    });
  }

  async function conectar() {
    const { state, saveCreds } = await useMultiFileAuthState(pastaSessao);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
    sock = makeWASocket({
      auth: state,
      version,
      browser: Browsers.appropriate("Central de Atendimento"),
      logger: pino({ level: "silent" }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("groups.update", (grupos) => {
      for (const g of grupos) if (g.id && g.subject) nomesDosGrupos.set(g.id, g.subject);
    });

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        definirEstado({ status: "aguardando_qr", qr: await QRCode.toDataURL(qr, { width: 320 }) });
        log.info("\nLeia o QR code abaixo com o WhatsApp do escritório (Aparelhos conectados > Conectar um aparelho):\n");
        log.info(await QRCode.toString(qr, { type: "terminal", small: true }));
      }
      if (connection === "open") {
        definirEstado({ status: "conectado", qr: null });
        log.info("WhatsApp conectado.");
      }
      if (connection === "close") {
        const codigo = lastDisconnect?.error?.output?.statusCode;
        definirEstado({ status: "desconectado", qr: null });
        if (codigo === DisconnectReason.loggedOut) {
          log.warn("Sessão do WhatsApp encerrada pelo celular. Será preciso ler o QR code novamente.");
          fs.rmSync(pastaSessao, { recursive: true, force: true });
        }
        setTimeout(() => conectar().catch((e) => log.error("Falha ao reconectar ao WhatsApp:", e.message)), 3000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
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
    async enviarTexto(jid, texto) {
      if (estado.status !== "conectado") throw new Error("WhatsApp desconectado. Verifique a conexão no painel.");
      const enviada = await sock.sendMessage(jid, { text: texto });
      enviadasPeloPainel.add(enviada.key.id);
      return { waId: enviada.key.id };
    },
  };
}
