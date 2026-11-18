import fs from "node:fs";
import path from "node:path";
import { enviarParaAppsScript, horarioDeBrasilia } from "./backup.js";

/** Tipos que o navegador pode mostrar direto (o resto é sempre baixado, por segurança). */
const MOSTRAR_NO_NAVEGADOR = /^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/(mp4|webm)|application\/pdf)$/;
const EXTENSOES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "audio/ogg": "ogg", "audio/mpeg": "mp3",
  "audio/mp4": "m4a", "audio/aac": "aac", "video/mp4": "mp4", "application/pdf": "pdf" };

export const limparMime = (mime) => String(mime || "application/octet-stream").split(";")[0].trim().toLowerCase();
export const podeMostrar = (mime) => MOSTRAR_NO_NAVEGADOR.test(limparMime(mime));
/** Nome de arquivo seguro para disco e para o Drive. */
export const nomeSeguro = (nome) => String(nome || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "arquivo";

/**
 * Guarda os arquivos recebidos pelo WhatsApp (fotos, documentos, vídeos e áudios).
 *
 * - Na chegada, o arquivo é gravado no servidor (pasta dados/arquivos) e fica disponível no painel.
 * - Em seguida, uma cópia vai para o Google Drive: "Arquivos › <grupo ou contato> › AAAA-MM", pelo mesmo
 *   Apps Script do backup. O Drive é a guarda definitiva.
 * - Quando a pasta do servidor passa do limite, os arquivos mais antigos que já estão no Drive saem do
 *   servidor; ao abrir um deles no painel, a central busca no Drive.
 */
export function criarArquivos({ banco, pastaLocal, url, segredo, maxLocalBytes = 1024 * 1048576, log = console, enviar = enviarParaAppsScript }) {
  const noDrive = Boolean(url && segredo);
  let enviando = null;

  const caminho = (relativo) => path.join(pastaLocal, relativo);

  /** Grava o arquivo de uma mensagem já registrada e agenda a cópia para o Drive. */
  function guardar({ mensagemId, criadoEm, tipo, arquivo }) {
    const mime = limparMime(arquivo.mime);
    const { dia, hora, ano, mes } = horarioDeBrasilia(new Date(criadoEm || Date.now()));
    const nome = nomeSeguro(arquivo.nome || `${tipo || "arquivo"}-${dia}-${hora.replace(":", "")}.${EXTENSOES[mime] || "bin"}`);
    const relativo = path.join(`${ano}-${mes}`, `${mensagemId}-${nome}`);
    fs.mkdirSync(path.dirname(caminho(relativo)), { recursive: true });
    fs.writeFileSync(caminho(relativo), arquivo.buffer);
    banco.definirArquivo(mensagemId, { nome, mime, tamanho: arquivo.buffer.length, local: relativo });
    if (noDrive) setTimeout(() => api.enviarPendentes(), 0);
  }

  async function enviarUm(m) {
    const buffer = fs.readFileSync(caminho(m.arquivo_local));
    const { dia, hora, ano, mes } = horarioDeBrasilia(new Date(m.criado_em));
    const r = await enviar(url, {
      segredo,
      arquivos: [{
        raiz: "Arquivos",
        pasta: `${nomeSeguro(m.chat_nome || m.chat_jid)}/${ano}-${mes}`,
        nome: `${dia.slice(8)}-${mes} ${hora.replace(":", "h")} ${m.arquivo_nome}`,
        mime: m.arquivo_mime,
        base64: buffer.toString("base64"),
      }],
    });
    banco.definirArquivoDrive(m.id, r.arquivos[0].id);
  }

  /** Tira do servidor os arquivos mais antigos que já estão no Drive, até caber no limite. */
  function liberarEspaco() {
    let total = banco.tamanhoDosArquivosLocais();
    if (total <= maxLocalBytes) return;
    for (const m of banco.arquivosLocaisNoDrive()) {
      fs.rmSync(caminho(m.arquivo_local), { force: true });
      banco.limparArquivoLocal(m.id);
      total -= m.arquivo_tamanho;
      if (total <= maxLocalBytes) break;
    }
  }

  const api = {
    noDrive,
    guardar,
    /** Envia ao Drive o que ainda não foi (um por vez; tenta de novo no próximo ciclo se falhar). */
    enviarPendentes() {
      if (!noDrive) return Promise.resolve();
      enviando ??= (async () => {
        for (const m of banco.arquivosPendentesDeDrive(50)) {
          try {
            await enviarUm(m);
          } catch (erro) {
            log.error(`Arquivo da mensagem ${m.id} não foi para o Drive (${erro.message}). Nova tentativa em breve.`);
            break;
          }
        }
        liberarEspaco();
      })().finally(() => (enviando = null));
      return enviando;
    },
    iniciar() {
      setInterval(() => api.enviarPendentes(), 5 * 60 * 1000).unref();
      api.enviarPendentes();
    },
    /** Conteúdo do arquivo de uma mensagem: do servidor ou, se já saiu de lá, do Drive. Null se não existe mais. */
    async abrir(m) {
      if (m.arquivo_local && fs.existsSync(caminho(m.arquivo_local))) return fs.readFileSync(caminho(m.arquivo_local));
      if (m.arquivo_drive_id && noDrive) {
        const r = await enviar(url, { segredo, ler: m.arquivo_drive_id });
        return Buffer.from(r.base64, "base64");
      }
      return null;
    },
  };
  return api;
}
