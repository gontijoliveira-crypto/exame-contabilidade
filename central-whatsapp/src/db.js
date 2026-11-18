import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS setores (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS atendentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  admin INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS atendente_setor (
  atendente_id INTEGER NOT NULL REFERENCES atendentes(id),
  setor_id TEXT NOT NULL REFERENCES setores(id),
  PRIMARY KEY (atendente_id, setor_id)
);
CREATE TABLE IF NOT EXISTS canais (       -- cada número de WhatsApp conectado à central
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS atendente_canal (
  atendente_id INTEGER NOT NULL REFERENCES atendentes(id),
  canal_id INTEGER NOT NULL REFERENCES canais(id),
  PRIMARY KEY (atendente_id, canal_id)
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  atendente_id INTEGER NOT NULL REFERENCES atendentes(id),
  expira_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS redefinicoes_senha (
  token_hash TEXT PRIMARY KEY,   -- só o hash do link fica guardado
  atendente_id INTEGER NOT NULL REFERENCES atendentes(id),
  expira_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canal_id INTEGER NOT NULL REFERENCES canais(id),
  jid TEXT NOT NULL,
  tipo TEXT NOT NULL,            -- grupo | privado
  nome TEXT NOT NULL DEFAULT '',
  UNIQUE (canal_id, jid)
);
CREATE TABLE IF NOT EXISTS atendimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id),
  setor_id TEXT NOT NULL REFERENCES setores(id),
  atendente_id INTEGER REFERENCES atendentes(id),
  status TEXT NOT NULL DEFAULT 'aberto',   -- aberto | em_atendimento | resolvido
  urgencia TEXT NOT NULL DEFAULT 'normal', -- baixa | normal | alta
  resumo TEXT NOT NULL DEFAULT '',
  motivo TEXT NOT NULL DEFAULT '',         -- por que a IA escolheu este setor
  pendente INTEGER NOT NULL DEFAULT 1,     -- 1 = cliente aguardando resposta
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_atendimentos_chat ON atendimentos(chat_id, status);
CREATE INDEX IF NOT EXISTS idx_atendimentos_setor ON atendimentos(setor_id, status);
CREATE TABLE IF NOT EXISTS mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT,
  chat_id INTEGER NOT NULL REFERENCES chats(id),
  atendimento_id INTEGER REFERENCES atendimentos(id),
  direcao TEXT NOT NULL,          -- entrada | saida
  autor_jid TEXT NOT NULL DEFAULT '',
  autor_nome TEXT NOT NULL DEFAULT '',
  atendente_id INTEGER REFERENCES atendentes(id),
  tipo TEXT NOT NULL DEFAULT 'texto',
  texto TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  UNIQUE (chat_id, wa_id)
);
CREATE INDEX IF NOT EXISTS idx_mensagens_chat ON mensagens(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_mensagens_atendimento ON mensagens(atendimento_id, id);
`;

const VERSAO_ESQUEMA = 2;
const agora = () => new Date().toISOString();

const SELECT_ATENDIMENTO = `
  SELECT a.*, s.nome AS setor_nome, c.nome AS chat_nome, c.tipo AS chat_tipo, c.jid AS chat_jid,
    c.canal_id, n.nome AS canal_nome, t.nome AS atendente_nome,
    (SELECT texto FROM mensagens m WHERE m.atendimento_id = a.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem
  FROM atendimentos a
  JOIN setores s ON s.id = a.setor_id
  JOIN chats c ON c.id = a.chat_id
  JOIN canais n ON n.id = c.canal_id
  LEFT JOIN atendentes t ON t.id = a.atendente_id`;

export function abrirBanco(arquivo) {
  if (arquivo !== ":memory:") fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  let db = new DatabaseSync(arquivo);
  const versao = db.prepare("PRAGMA user_version").get().user_version;
  const temDados = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'atendentes'").get().n > 0;
  if (temDados && versao !== VERSAO_ESQUEMA) {
    // Banco de uma versão anterior (antes dos múltiplos números): guarda uma cópia e começa do zero.
    db.close();
    const copia = `${arquivo}.v${versao}-${Date.now()}`;
    fs.renameSync(arquivo, copia);
    for (const sufixo of ["-wal", "-shm"]) fs.rmSync(arquivo + sufixo, { force: true });
    console.warn(`Banco de versão anterior guardado em ${copia}; um banco novo foi criado.`);
    db = new DatabaseSync(arquivo);
  }
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(ESQUEMA);
  db.exec(`PRAGMA user_version = ${VERSAO_ESQUEMA}`);

  const um = (sql, ...p) => db.prepare(sql).get(...p);
  const todos = (sql, ...p) => db.prepare(sql).all(...p);
  const exec = (sql, ...p) => db.prepare(sql).run(...p);

  function comSetores(atendente) {
    if (!atendente) return null;
    const setores = todos("SELECT setor_id FROM atendente_setor WHERE atendente_id = ?", atendente.id).map((l) => l.setor_id);
    const canais = todos("SELECT canal_id FROM atendente_canal WHERE atendente_id = ?", atendente.id).map((l) => l.canal_id);
    return { ...atendente, admin: !!atendente.admin, ativo: !!atendente.ativo, setores, canais };
  }

  function definirCanaisDoAtendente(id, canais) {
    exec("DELETE FROM atendente_canal WHERE atendente_id = ?", id);
    for (const canalId of new Set(canais || [])) {
      exec("INSERT INTO atendente_canal (atendente_id, canal_id) VALUES (?, ?)", id, canalId);
    }
  }

  function definirSetoresDoAtendente(id, setores) {
    exec("DELETE FROM atendente_setor WHERE atendente_id = ?", id);
    for (const setorId of new Set(setores || [])) {
      exec("INSERT INTO atendente_setor (atendente_id, setor_id) VALUES (?, ?)", id, setorId);
    }
  }

  return {
    fechar: () => db.close(),

    // ---------- setores ----------
    sincronizarSetores(lista) {
      exec("UPDATE setores SET ativo = 0");
      for (const s of lista) {
        exec(
          `INSERT INTO setores (id, nome, descricao, ativo) VALUES (?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, descricao = excluded.descricao, ativo = 1`,
          s.id, s.nome, s.descricao || "",
        );
      }
    },
    listarSetores: () => todos("SELECT id, nome, descricao FROM setores WHERE ativo = 1 ORDER BY nome"),

    // ---------- atendentes ----------
    contarAtendentes: () => um("SELECT COUNT(*) AS n FROM atendentes").n,
    criarAtendente({ nome, email, senhaHash, admin = false, setores = [], canais = [] }) {
      const r = exec(
        "INSERT INTO atendentes (nome, email, senha_hash, admin) VALUES (?, ?, ?, ?)",
        nome, email, senhaHash, admin ? 1 : 0,
      );
      const id = Number(r.lastInsertRowid);
      definirSetoresDoAtendente(id, setores);
      definirCanaisDoAtendente(id, canais);
      return id;
    },
    atualizarAtendente(id, { nome, email, senhaHash, admin, ativo, setores, canais }) {
      if (email !== undefined) exec("UPDATE atendentes SET email = ? WHERE id = ?", email, id);
      if (canais !== undefined) definirCanaisDoAtendente(id, canais);
      if (nome !== undefined) exec("UPDATE atendentes SET nome = ? WHERE id = ?", nome, id);
      if (senhaHash !== undefined) exec("UPDATE atendentes SET senha_hash = ? WHERE id = ?", senhaHash, id);
      if (admin !== undefined) exec("UPDATE atendentes SET admin = ? WHERE id = ?", admin ? 1 : 0, id);
      if (ativo !== undefined) {
        exec("UPDATE atendentes SET ativo = ? WHERE id = ?", ativo ? 1 : 0, id);
        if (!ativo) exec("DELETE FROM sessoes WHERE atendente_id = ?", id);
      }
      if (setores !== undefined) definirSetoresDoAtendente(id, setores);
    },
    buscarAtendente: (id) => comSetores(um("SELECT * FROM atendentes WHERE id = ?", id)),
    buscarAtendentePorEmail: (email) => comSetores(um("SELECT * FROM atendentes WHERE email = ?", email)),
    listarAtendentes: () => todos("SELECT * FROM atendentes ORDER BY nome").map(comSetores),
    contarAdminsAtivos: () => um("SELECT COUNT(*) AS n FROM atendentes WHERE admin = 1 AND ativo = 1").n,

    /** Atendente ativo, do setor e com acesso ao número, com menos atendimentos em aberto. */
    atendenteMenosOcupado(setorId, canalId) {
      const linha = um(
        `SELECT t.id,
           (SELECT COUNT(*) FROM atendimentos a WHERE a.atendente_id = t.id AND a.status != 'resolvido') AS carga
         FROM atendentes t
         JOIN atendente_setor x ON x.atendente_id = t.id
         JOIN atendente_canal k ON k.atendente_id = t.id
         WHERE x.setor_id = ? AND k.canal_id = ? AND t.ativo = 1
         ORDER BY carga ASC, t.id ASC LIMIT 1`,
        setorId, canalId,
      );
      return linha?.id ?? null;
    },

    // ---------- canais (números de WhatsApp) ----------
    criarCanal: (nome) => Number(exec("INSERT INTO canais (nome) VALUES (?)", nome).lastInsertRowid),
    atualizarCanal(id, { nome, ativo }) {
      if (nome !== undefined) exec("UPDATE canais SET nome = ? WHERE id = ?", nome, id);
      if (ativo !== undefined) exec("UPDATE canais SET ativo = ? WHERE id = ?", ativo ? 1 : 0, id);
    },
    buscarCanal: (id) => um("SELECT * FROM canais WHERE id = ?", id),
    listarCanais: ({ inativos = false } = {}) =>
      todos(`SELECT * FROM canais ${inativos ? "" : "WHERE ativo = 1"} ORDER BY id`).map((c) => ({ ...c, ativo: !!c.ativo })),

    // ---------- sessões do painel ----------
    criarSessao: (token, atendenteId, expiraEm) =>
      exec("INSERT INTO sessoes (token, atendente_id, expira_em) VALUES (?, ?, ?)", token, atendenteId, expiraEm),
    buscarSessao(token) {
      exec("DELETE FROM sessoes WHERE expira_em < ?", agora());
      return um("SELECT * FROM sessoes WHERE token = ?", token);
    },
    apagarSessao: (token) => exec("DELETE FROM sessoes WHERE token = ?", token),
    apagarSessoesDoAtendente: (id) => exec("DELETE FROM sessoes WHERE atendente_id = ?", id),

    // ---------- redefinição de senha ----------
    /** Guarda um novo link de redefinição, invalidando os anteriores do mesmo atendente. */
    criarRedefinicao(tokenHash, atendenteId, expiraEm) {
      exec("DELETE FROM redefinicoes_senha WHERE atendente_id = ?", atendenteId);
      exec("INSERT INTO redefinicoes_senha (token_hash, atendente_id, expira_em) VALUES (?, ?, ?)", tokenHash, atendenteId, expiraEm);
    },
    buscarRedefinicao(tokenHash, agoraIso) {
      exec("DELETE FROM redefinicoes_senha WHERE expira_em < ?", agoraIso);
      return um("SELECT * FROM redefinicoes_senha WHERE token_hash = ?", tokenHash);
    },
    apagarRedefinicoes: (atendenteId) => exec("DELETE FROM redefinicoes_senha WHERE atendente_id = ?", atendenteId),

    // ---------- chats e mensagens ----------
    /** Cria ou atualiza o chat daquele número e devolve o id. */
    salvarChat({ canalId, jid, tipo, nome }) {
      exec(
        `INSERT INTO chats (canal_id, jid, tipo, nome) VALUES (?, ?, ?, ?)
         ON CONFLICT(canal_id, jid) DO UPDATE SET nome = CASE WHEN excluded.nome != '' THEN excluded.nome ELSE chats.nome END`,
        canalId, jid, tipo, nome || "",
      );
      return um("SELECT id FROM chats WHERE canal_id = ? AND jid = ?", canalId, jid).id;
    },
    buscarChat: (id) => um("SELECT * FROM chats WHERE id = ?", id),

    /** Devolve o id da mensagem, ou null se ela já existia (mesmo wa_id). */
    inserirMensagem(m) {
      const r = exec(
        `INSERT OR IGNORE INTO mensagens
           (wa_id, chat_id, atendimento_id, direcao, autor_jid, autor_nome, atendente_id, tipo, texto, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        m.waId ?? null, m.chatId, m.atendimentoId ?? null, m.direcao, m.autorJid || "", m.autorNome || "",
        m.atendenteId ?? null, m.tipo || "texto", m.texto || "", m.criadoEm || agora(),
      );
      return r.changes ? Number(r.lastInsertRowid) : null;
    },
    /** Corrige a autoria de uma mensagem de saída já registrada (eco do WhatsApp chegou antes). */
    atribuirMensagem(chatId, waId, { atendimentoId, atendenteId, autorNome, texto }) {
      exec(
        "UPDATE mensagens SET atendimento_id = ?, atendente_id = ?, autor_nome = ?, texto = ? WHERE chat_id = ? AND wa_id = ?",
        atendimentoId, atendenteId, autorNome, texto, chatId, waId,
      );
    },
    buscarMensagens(ids) {
      if (!ids.length) return [];
      return todos(`SELECT * FROM mensagens WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ...ids);
    },
    ultimasMensagensDoChat: (chatId, limite, antesDoId) =>
      todos(
        "SELECT * FROM mensagens WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
        chatId, antesDoId ?? Number.MAX_SAFE_INTEGER, limite,
      ).reverse(),
    mensagensDoAtendimento: (id) =>
      todos(
        `SELECT m.*, t.nome AS atendente_nome FROM mensagens m LEFT JOIN atendentes t ON t.id = m.atendente_id
         WHERE m.atendimento_id = ? ORDER BY m.id`,
        id,
      ),
    vincularMensagens(ids, atendimentoId) {
      for (const id of ids) exec("UPDATE mensagens SET atendimento_id = ? WHERE id = ?", atendimentoId, id);
    },

    // ---------- backup ----------
    /** Mensagens desde uma data, com o número, o chat, o setor e o atendente, para a planilha de backup. */
    mensagensDesde: (desdeIso) =>
      todos(
        `SELECT m.id, m.criado_em, m.direcao, m.autor_nome, m.autor_jid, m.tipo, m.texto, m.atendimento_id,
           c.nome AS chat_nome, c.tipo AS chat_tipo, c.jid AS chat_jid, n.nome AS canal_nome,
           t.nome AS atendente_nome, s.nome AS setor_nome, a.status AS atendimento_status
         FROM mensagens m
         JOIN chats c ON c.id = m.chat_id
         JOIN canais n ON n.id = c.canal_id
         LEFT JOIN atendentes t ON t.id = m.atendente_id
         LEFT JOIN atendimentos a ON a.id = m.atendimento_id
         LEFT JOIN setores s ON s.id = a.setor_id
         WHERE m.criado_em >= ? ORDER BY m.id`,
        desdeIso,
      ),
    /** Cópia consistente do banco inteiro num arquivo novo (pode rodar com a central em uso). */
    copiarPara(arquivo) {
      db.exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`);
    },

    // ---------- atendimentos ----------
    criarAtendimento({ chatId, setorId, atendenteId, urgencia, resumo, motivo }) {
      const r = exec(
        `INSERT INTO atendimentos (chat_id, setor_id, atendente_id, urgencia, resumo, motivo, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        chatId, setorId, atendenteId ?? null, urgencia || "normal", resumo || "", motivo || "", agora(), agora(),
      );
      return Number(r.lastInsertRowid);
    },
    atualizarAtendimento(id, campos) {
      const permitidos = ["setor_id", "atendente_id", "status", "urgencia", "resumo", "motivo", "pendente"];
      for (const [campo, valor] of Object.entries(campos)) {
        if (!permitidos.includes(campo)) throw new Error(`campo inválido: ${campo}`);
        exec(`UPDATE atendimentos SET ${campo} = ? WHERE id = ?`, valor, id);
      }
      exec("UPDATE atendimentos SET atualizado_em = ? WHERE id = ?", agora(), id);
    },
    buscarAtendimento: (id) => um(`${SELECT_ATENDIMENTO} WHERE a.id = ?`, id),
    atendimentosAbertosDoChat: (chatId) =>
      todos(`${SELECT_ATENDIMENTO} WHERE a.chat_id = ? AND a.status != 'resolvido' ORDER BY a.atualizado_em DESC, a.id DESC`, chatId),
    /** setores/canais = null significa "todos" (administrador). */
    listarAtendimentos({ setores = null, canais = null, atendenteId = null, resolvidos = false, limite = 200 }) {
      const filtros = [resolvidos ? "a.status = 'resolvido'" : "a.status != 'resolvido'"];
      const params = [];
      if (setores) {
        if (!setores.length) return [];
        filtros.push(`a.setor_id IN (${setores.map(() => "?").join(",")})`);
        params.push(...setores);
      }
      if (canais) {
        if (!canais.length) return [];
        filtros.push(`c.canal_id IN (${canais.map(() => "?").join(",")})`);
        params.push(...canais);
      }
      if (atendenteId) {
        filtros.push("a.atendente_id = ?");
        params.push(atendenteId);
      }
      return todos(
        `${SELECT_ATENDIMENTO} WHERE ${filtros.join(" AND ")}
         ORDER BY ${resolvidos ? "a.atualizado_em DESC" : "a.pendente DESC, (a.urgencia = 'alta') DESC, a.atualizado_em DESC"}
         LIMIT ?`,
        ...params, limite,
      );
    },
  };
}
