import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";

export const FUSO = "America/Sao_Paulo";
const COPIAS_LOCAIS = 8; // cópias do banco guardadas também no servidor

/** Data e hora no fuso de Brasília: { dia: "2026-11-18", hora: "12:00", ano, mes }. */
export function horarioDeBrasilia(data = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(data).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, ano: p.year, mes: p.month };
}

const ROTULO_STATUS = { aberto: "Aguardando", em_atendimento: "Em atendimento", resolvido: "Resolvido" };

/** Planilha CSV (separada por ponto e vírgula, com BOM, para abrir certo no Excel e no Google Planilhas). */
export function planilhaDeMensagens(mensagens) {
  const campo = (v) => {
    const s = String(v ?? "");
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cabecalho = ["Data", "Hora", "Número de WhatsApp", "Grupo ou contato", "Tipo de chat", "Direção", "Autor", "Atendente",
    "Setor", "Atendimento", "Situação do atendimento", "Tipo", "Mensagem", "Arquivo", "Link do arquivo no Drive"];
  const linhas = mensagens.map((m) => {
    const { dia, hora } = horarioDeBrasilia(new Date(m.criado_em));
    return [
      dia.split("-").reverse().join("/"), hora, m.canal_nome, m.chat_nome || m.chat_jid, m.chat_tipo === "grupo" ? "Grupo" : "Privado",
      m.direcao === "entrada" ? "Recebida" : "Enviada", m.autor_nome || m.autor_jid, m.atendente_nome || "", m.setor_nome || "",
      m.atendimento_id ?? "", ROTULO_STATUS[m.atendimento_status] || "", m.tipo, m.texto,
      m.arquivo_nome || "", m.arquivo_drive_id ? `https://drive.google.com/file/d/${m.arquivo_drive_id}/view` : "",
    ].map(campo).join(";");
  });
  return "﻿" + [cabecalho.join(";"), ...linhas].join("\r\n") + "\r\n";
}

/** Envia os arquivos ao Apps Script de backup, que grava no Google Drive. */
export async function enviarParaAppsScript(url, carga) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(carga),
    redirect: "follow",
    signal: AbortSignal.timeout(180_000),
  });
  const texto = await r.text();
  let resposta;
  try {
    resposta = JSON.parse(texto);
  } catch {
    throw new Error(`o Apps Script não respondeu em JSON (HTTP ${r.status}); confira se ele está publicado como app da Web com acesso "Qualquer pessoa"`);
  }
  if (!resposta.ok) throw new Error(resposta.erro || "o Apps Script recusou o backup");
  return resposta;
}

/**
 * Backup das mensagens no Google Drive, nos horários configurados (padrão: 00:00, 06:00, 12:00 e 18:00
 * de Brasília). Cada execução grava:
 *  - Backups/AAAA/MM/mensagens-AAAA-MM-DD.csv de hoje e de ontem (substitui a versão anterior do dia);
 *  - Backups/AAAA/MM/banco-AAAA-MM-DD-HHMM.db.gz, cópia completa do banco (sem as sessões de login),
 *    apagada do Drive depois de `retencaoDias`.
 */
export function criarBackup({
  banco, url, segredo, horarios = ["00:00", "06:00", "12:00", "18:00"], retencaoDias = 30, pastaLocal,
  log = console, relogio = () => new Date(), enviar = enviarParaAppsScript,
}) {
  const arquivoStatus = path.join(pastaLocal, "status.json");
  let ultimo = null;
  try { ultimo = JSON.parse(fs.readFileSync(arquivoStatus, "utf8")); } catch { /* primeiro backup */ }
  let ultimaChaveAgendada = null;
  let emAndamento = null;

  function copiaDoBanco(nomeBase) {
    fs.mkdirSync(pastaLocal, { recursive: true });
    const tmp = path.join(pastaLocal, `${nomeBase}.tmp`);
    fs.rmSync(tmp, { force: true });
    banco.copiarPara(tmp);
    const copia = new DatabaseSync(tmp);
    copia.exec("DELETE FROM sessoes; DELETE FROM redefinicoes_senha; VACUUM;"); // nada de sessões abertas no backup
    copia.close();
    const gz = gzipSync(fs.readFileSync(tmp), { level: 9 });
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(path.join(pastaLocal, `${nomeBase}.db.gz`), gz);
    const antigas = fs.readdirSync(pastaLocal).filter((n) => /^banco-.*\.db\.gz$/.test(n)).sort();
    for (const n of antigas.slice(0, Math.max(0, antigas.length - COPIAS_LOCAIS))) fs.rmSync(path.join(pastaLocal, n));
    return gz;
  }

  async function rodar(motivo) {
    const agora = relogio();
    const hoje = horarioDeBrasilia(agora);
    const ontem = horarioDeBrasilia(new Date(agora.getTime() - 24 * 3600 * 1000));
    const recentes = banco.mensagensDesde(new Date(agora.getTime() - 50 * 3600 * 1000).toISOString());
    const arquivos = [];
    let total = 0;
    for (const d of [ontem, hoje]) {
      const doDia = recentes.filter((m) => horarioDeBrasilia(new Date(m.criado_em)).dia === d.dia);
      if (d === ontem && !doDia.length) continue;
      if (d === hoje) total = doDia.length;
      arquivos.push({ pasta: `${d.ano}/${d.mes}`, nome: `mensagens-${d.dia}.csv`, mime: "text/csv", substituir: true,
        base64: Buffer.from(planilhaDeMensagens(doDia), "utf8").toString("base64") });
    }
    const nomeBanco = `banco-${hoje.dia}-${hoje.hora.replace(":", "")}`;
    const gz = copiaDoBanco(nomeBanco);
    arquivos.push({ pasta: `${hoje.ano}/${hoje.mes}`, nome: `${nomeBanco}.db.gz`, mime: "application/gzip", substituir: true, base64: gz.toString("base64") });

    const status = { quando: agora.toISOString(), motivo, mensagensHoje: total, tamanhoBanco: gz.length, arquivos: [] };
    if (!url || !segredo) {
      Object.assign(status, { ok: false, erro: "Google Drive não configurado (BACKUP_URL e BACKUP_SEGREDO). A cópia ficou só no servidor." });
    } else {
      try {
        const resposta = await enviar(url, { segredo, arquivos, retencao: { prefixo: "banco-", dias: retencaoDias } });
        Object.assign(status, { ok: true, arquivos: (resposta.arquivos || []).map(({ nome, url: link }) => ({ nome, url: link })), apagados: resposta.apagados || 0 });
      } catch (erro) {
        Object.assign(status, { ok: false, erro: `Falha ao enviar ao Google Drive: ${erro.message}` });
      }
    }
    if (!status.ok) log.error(`Backup (${motivo}): ${status.erro}`);
    ultimo = status;
    fs.mkdirSync(pastaLocal, { recursive: true });
    fs.writeFileSync(arquivoStatus, JSON.stringify(status, null, 2));
    return status;
  }

  const api = {
    configurado: Boolean(url && segredo),
    horarios,
    /** Faz um backup agora (se já houver um em andamento, espera por ele). */
    executar(motivo = "manual") {
      emAndamento ??= rodar(motivo).catch((erro) => {
        log.error("Backup falhou:", erro);
        ultimo = { quando: relogio().toISOString(), motivo, ok: false, erro: erro.message, arquivos: [] };
        return ultimo;
      }).finally(() => (emAndamento = null));
      return emAndamento;
    },
    /** Confere o relógio: dispara o backup quando chega um dos horários. */
    verificarAgenda() {
      const { dia, hora } = horarioDeBrasilia(relogio());
      const chave = `${dia} ${hora}`;
      if (horarios.includes(hora) && chave !== ultimaChaveAgendada) {
        ultimaChaveAgendada = chave;
        return api.executar(`agendado ${hora}`);
      }
      return null;
    },
    iniciar() {
      setInterval(() => api.verificarAgenda(), 20_000).unref();
      // Se o servidor ficou parado e perdeu um horário, faz um backup logo depois de ligar.
      const atrasado = !ultimo?.ok || relogio() - new Date(ultimo.quando) > 6.5 * 3600 * 1000;
      if (atrasado) setTimeout(() => api.executar("ao iniciar"), 60_000).unref();
    },
    status: () => ({ configurado: api.configurado, horarios, retencaoDias, emAndamento: Boolean(emAndamento), ultimo }),
  };
  return api;
}
