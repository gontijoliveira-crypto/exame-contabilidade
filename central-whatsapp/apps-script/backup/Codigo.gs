/**
 * Backup — Central de Atendimento WhatsApp (Expo Contabilidade e Consultoria).
 *
 * Também guarda os arquivos recebidos pelo WhatsApp (fotos, documentos, vídeos e áudios) em
 * "Central de Atendimento WhatsApp › Arquivos › <grupo ou contato> › AAAA-MM" e os devolve à central
 * quando alguém abre um arquivo antigo pelo painel.
 *
 * Recebe da central, 4 vezes por dia, a planilha de mensagens do dia e a cópia do banco, e grava em
 * "Central de Atendimento WhatsApp › Backups › AAAA › MM" no Google Drive. Cópias do banco mais antigas
 * que o prazo combinado vão para a lixeira; as planilhas ficam para sempre.
 *
 * Instalação (uma vez):
 *  1. Executar → configurar   (autoriza o acesso ao Drive e mostra o SEGREDO no registro de execução)
 *  2. Implantar → Nova implantação → App da Web: executar como "Eu", acesso "Qualquer pessoa"
 *  3. Na central: BACKUP_URL = endereço do app da Web (termina em /exec) e BACKUP_SEGREDO = o segredo
 */
const PASTA_RAIZ = '1PQnOw5PaiyBD0HqcrxO4w8fmf7vwTEwn'; // pasta "Central de Atendimento WhatsApp"
const NOME_BACKUPS = 'Backups';
const NOME_ARQUIVOS = 'Arquivos';

function doPost(e) {
  try {
    const dados = JSON.parse(e.postData.contents);
    const segredo = PropertiesService.getScriptProperties().getProperty('SEGREDO');
    if (!segredo || dados.segredo !== segredo) return resposta_({ ok: false, erro: 'segredo inválido' });
    if (dados.ler) return resposta_(ler_(String(dados.ler)));
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const raiz = pastaBackups_();
      const arquivos = (dados.arquivos || []).map((a) => salvar_(a.raiz === NOME_ARQUIVOS ? pastaArquivos_() : raiz, a));
      const apagados = dados.retencao ? limpar_(raiz, dados.retencao) : 0;
      return resposta_({ ok: true, arquivos, apagados });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return resposta_({ ok: false, erro: String((err && err.message) || err) });
  }
}

/** Abrir o endereço no navegador só confirma que o serviço está no ar (não mostra dados). */
function doGet() {
  return resposta_({ ok: true, servico: 'Backup da Central de Atendimento WhatsApp' });
}

/** Rode uma vez no editor: autoriza o Drive, cria a pasta Backups e mostra o segredo. */
function configurar() {
  const props = PropertiesService.getScriptProperties();
  let segredo = props.getProperty('SEGREDO');
  if (!segredo) {
    segredo = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SEGREDO', segredo);
  }
  const pasta = pastaBackups_();
  Logger.log('Pasta de backups: ' + pasta.getUrl());
  Logger.log('Pasta de arquivos: ' + pastaArquivos_().getUrl());
  Logger.log('BACKUP_SEGREDO = ' + segredo);
  return segredo;
}

/** Gera um segredo novo (use se o atual vazar) e mostra no registro. Atualize BACKUP_SEGREDO na central. */
function trocarSegredo() {
  PropertiesService.getScriptProperties().deleteProperty('SEGREDO');
  return configurar();
}

function pastaBackups_() {
  return subpasta_(DriveApp.getFolderById(PASTA_RAIZ), NOME_BACKUPS);
}

function pastaArquivos_() {
  return subpasta_(DriveApp.getFolderById(PASTA_RAIZ), NOME_ARQUIVOS);
}

/** Devolve um arquivo guardado, desde que esteja dentro da pasta "Arquivos" da central. */
function ler_(id) {
  const f = DriveApp.getFileById(id);
  if (!dentroDe_(f, pastaArquivos_().getId())) return { ok: false, erro: 'arquivo fora da pasta da central' };
  return { ok: true, nome: f.getName(), mime: f.getMimeType(), base64: Utilities.base64Encode(f.getBlob().getBytes()) };
}

function dentroDe_(item, pastaId) {
  const pais = item.getParents();
  while (pais.hasNext()) {
    const p = pais.next();
    if (p.getId() === pastaId || dentroDe_(p, pastaId)) return true;
  }
  return false;
}

function subpasta_(pai, nome) {
  const it = pai.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}

function salvar_(raiz, a) {
  let pasta = raiz;
  String(a.pasta || '').split('/').filter(String).forEach((n) => { pasta = subpasta_(pasta, n); });
  const nome = String(a.nome || 'arquivo').replace(/[\\/]/g, '-');
  if (a.substituir) {
    const it = pasta.getFilesByName(nome);
    while (it.hasNext()) it.next().setTrashed(true);
  }
  const blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime || 'application/octet-stream', nome);
  const f = pasta.createFile(blob);
  return { nome, id: f.getId(), url: f.getUrl() };
}

/** Manda para a lixeira as cópias do banco (nome começando com o prefixo) mais antigas que r.dias. */
function limpar_(raiz, r) {
  const limite = Date.now() - Number(r.dias || 30) * 864e5;
  const prefixo = String(r.prefixo || 'banco-');
  let n = 0;
  const visitar = (pasta) => {
    const arquivos = pasta.getFiles();
    while (arquivos.hasNext()) {
      const f = arquivos.next();
      if (f.getName().indexOf(prefixo) === 0 && f.getDateCreated().getTime() < limite) { f.setTrashed(true); n++; }
    }
    const subpastas = pasta.getFolders();
    while (subpastas.hasNext()) visitar(subpastas.next());
  };
  visitar(raiz);
  return n;
}

function resposta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
