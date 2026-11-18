// Google Drive / Apps Script simulados em memória, para testar apps-script/backup/Codigo.gs sem o Google.
import fs from "node:fs";
import vm from "node:vm";

export function carregarAppsScriptDeBackup({ pastaRaizId = "1PQnOw5PaiyBD0HqcrxO4w8fmf7vwTEwn", agora = () => Date.now() } = {}) {
  let seq = 0;
  const itens = new Map(); // id -> { id, nome, pasta: bool, pai, conteudo, mime, criado, lixeira }
  const novo = (dados) => { const id = `id${++seq}`; const item = { id, criado: agora(), lixeira: false, ...dados }; itens.set(id, item); return item; };
  novo({ nome: "Central de Atendimento WhatsApp", pasta: true, pai: null });
  itens.get("id1").id = pastaRaizId; itens.set(pastaRaizId, itens.get("id1")); itens.delete("id1");
  const iterador = (lista) => { let i = 0; return { hasNext: () => i < lista.length, next: () => lista[i++] }; };
  const filhos = (paiId, pasta) => [...itens.values()].filter((x) => x.pai === paiId && x.pasta === pasta && !x.lixeira);
  const arquivo = (x) => ({
    getParents: () => iterador(x.pai ? [pasta(itens.get(x.pai))] : []),
    getMimeType: () => x.mime, getBlob: () => ({ getBytes: () => [...x.conteudo] }),
    getId: () => x.id, getName: () => x.nome, getUrl: () => `https://drive.google.com/file/d/${x.id}/view`,
    getDateCreated: () => new Date(x.criado), setTrashed: (v) => { x.lixeira = v; },
  });
  const pasta = (x) => ({
    getParents: () => iterador(x.pai ? [pasta(itens.get(x.pai))] : []),
    getId: () => x.id, getName: () => x.nome, getUrl: () => `https://drive.google.com/drive/folders/${x.id}`,
    getFoldersByName: (n) => iterador(filhos(x.id, true).filter((f) => f.nome === n).map(pasta)),
    getFilesByName: (n) => iterador(filhos(x.id, false).filter((f) => f.nome === n).map(arquivo)),
    getFiles: () => iterador(filhos(x.id, false).map(arquivo)),
    getFolders: () => iterador(filhos(x.id, true).map(pasta)),
    createFolder: (n) => pasta(novo({ nome: n, pasta: true, pai: x.id })),
    createFile: (blob) => arquivo(novo({ nome: blob.nome, pasta: false, pai: x.id, conteudo: blob.bytes, mime: blob.mime })),
  });
  const props = new Map();
  const contexto = {
    DriveApp: {
      getFolderById: (id) => { const x = itens.get(id); if (!x) throw new Error("pasta não encontrada"); return pasta(x); },
      getFileById: (id) => { const x = itens.get(id); if (!x || x.pasta) throw new Error("arquivo não encontrado"); return arquivo(x); },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Decode: (b64) => [...Buffer.from(b64, "base64")],
      base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
      newBlob: (bytes, mime, nome) => ({ bytes: Buffer.from(bytes), mime, nome }),
    },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ texto: t, setMimeType() { return this; } }) },
    Logger: { log() {} },
  };
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync(new URL("../apps-script/backup/Codigo.gs", import.meta.url), "utf8"), contexto);
  const caminho = (x) => { const partes = []; for (let p = x; p && p.pai; p = itens.get(p.pai)) partes.unshift(p.nome); return partes.join("/"); };
  return {
    script: contexto,
    /** Arquivos que não estão na lixeira: { "Backups/2026/11/mensagens-...csv": item } */
    arquivos: () => Object.fromEntries([...itens.values()].filter((x) => !x.pasta && !x.lixeira).map((x) => [caminho(x), x])),
    /** Cria um arquivo solto, fora das pastas da central (para testar a recusa de leitura). */
    criarArquivoDeFora: () => novo({ nome: "contrato-particular.pdf", pasta: false, pai: null, conteudo: Buffer.from("x"), mime: "application/pdf" }).id,
    /** Faz os arquivos já criados parecerem `dias` mais antigos. */
    envelhecer: (dias) => { for (const x of itens.values()) x.criado -= dias * 864e5; },
    naLixeira: () => [...itens.values()].filter((x) => x.lixeira).map(caminho),
  };
}
