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
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  admin INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS atendente_setor (
  atendente_id INTEGER NOT NULL REFERENCES atendentes(id),
  setor_id TEXT NOT NULL REFERENCES setores(id),
  PRIMARY KEY (atendente_id, setor_id)
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  atendente_id INTEGER NOT NULL REFERENCES atendentes(id),
  expira_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,            -- grupo | privado
  nome TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS atendimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT NOT NULL REFERENCES chats(jid),
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
CREATE INDEX IF NOT EXISTS idx_atendimentos_chat ON atendimentos(chat_jid, status);
CREATE INDEX IF NOT EXISTS idx_atendimentos_setor ON atendimentos(setor_id, status);
CREATE TABLE IF NOT EXISTS mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT UNIQUE,
  chat_jid TEXT NOT NULL REFERENCES chats(jid),
  atendimento_id INTEGER REFERENCES atendimentos(id),
  direcao TEXT NOT NULL,          -- entrada | saida
  autor_jid TEXT NOT NULL DEFAULT '',
  autor_nome TEXT NOT NULL DEFAULT '',
  atendente_id INTEGER REFERENCES atendentes(id),
  tipo TEXT NOT NULL DEFAULT 'texto',
  texto TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mensagens_chat ON mensagens(chat_jid, id);
CREATE INDEX IF NOT EXISTS idx_mensagens_atendimento ON mensagens(atendimento_id, id);
`;

const agora = () => new Date().toISOString();

const SELECT_ATENDIMENTO = `
  SELECT a.*, s.nome AS setor_nome, c.nome AS chat_nome, c.tipo AS chat_tipo, t.nome AS atendente_nome,
    (SELECT texto FROM mensagens m WHERE m.atendimento_id = a.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem
  FROM atendimentos a
  JOIN setores s ON s.id = a.setor_id
  JOIN chats c ON c.jid = a.chat_jid
  LEFT JOIN atendentes t ON t.id = a.atendente_id`;

export function abrirBanco(arquivo) {
  if (arquivo !== ":memory:") fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(ESQUEMA);

  const um = (sql, ...p) => db.prepare(sql).get(...p);
  const todos = (sql, ...p) => db.prepare(sql).all(...p);
  const exec = (sql, ...p) => db.prepare(sql).run(...p);

  function comSetores(atendente) {
    if (!atendente) return null;
    const setores = todos("SELECT setor_id FROM atendente_setor WHERE atendente_id = ?", atendente.id).map((l) => l.setor_id);
    return { ...atendente, admin: !!atendente.admin, ativo: !!atendente.ativo, setores };
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
    criarAtendente({ nome, usuario, senhaHash, admin = false, setores = [] }) {
      const r = exec(
        "INSERT INTO atendentes (nome, usuario, senha_hash, admin) VALUES (?, ?, ?, ?)",
        nome, usuario, senhaHash, admin ? 1 : 0,
      );
      const id = Number(r.lastInsertRowid);
      definirSetoresDoAtendente(id, setores);
      return id;
    },
    atualizarAtendente(id, { nome, senhaHash, admin, ativo, setores }) {
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
    buscarAtendentePorUsuario: (usuario) => comSetores(um("SELECT * FROM atendentes WHERE usuario = ?", usuario)),
    listarAtendentes: () => todos("SELECT * FROM atendentes ORDER BY nome").map(comSetores),
    contarAdminsAtivos: () => um("SELECT COUNT(*) AS n FROM atendentes WHERE admin = 1 AND ativo = 1").n,

    /** Atendente ativo do setor com menos atendimentos em aberto (distribuição equilibrada). */
    atendenteMenosOcupado(setorId) {
      const linha = um(
        `SELECT t.id,
           (SELECT COUNT(*) FROM atendimentos a WHERE a.atendente_id = t.id AND a.status != 'resolvido') AS carga
         FROM atendentes t JOIN atendente_setor x ON x.atendente_id = t.id
         WHERE x.setor_id = ? AND t.ativo = 1
         ORDER BY carga ASC, t.id ASC LIMIT 1`,
        setorId,
      );
      return linha?.id ?? null;
    },

    // ---------- sessões do painel ----------
    criarSessao: (token, atendenteId, expiraEm) =>
      exec("INSERT INTO sessoes (token, atendente_id, expira_em) VALUES (?, ?, ?)", token, atendenteId, expiraEm),
    buscarSessao(token) {
      exec("DELETE FROM sessoes WHERE expira_em < ?", agora());
      return um("SELECT * FROM sessoes WHERE token = ?", token);
    },
    apagarSessao: (token) => exec("DELETE FROM sessoes WHERE token = ?", token),

    // ---------- chats e mensagens ----------
    salvarChat({ jid, tipo, nome }) {
      exec(
        `INSERT INTO chats (jid, tipo, nome) VALUES (?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET nome = CASE WHEN excluded.nome != '' THEN excluded.nome ELSE chats.nome END`,
        jid, tipo, nome || "",
      );
    },
    buscarChat: (jid) => um("SELECT * FROM chats WHERE jid = ?", jid),

    /** Devolve o id da mensagem, ou null se ela já existia (mesmo wa_id). */
    inserirMensagem(m) {
      const r = exec(
        `INSERT OR IGNORE INTO mensagens
           (wa_id, chat_jid, atendimento_id, direcao, autor_jid, autor_nome, atendente_id, tipo, texto, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        m.waId ?? null, m.chatJid, m.atendimentoId ?? null, m.direcao, m.autorJid || "", m.autorNome || "",
        m.atendenteId ?? null, m.tipo || "texto", m.texto || "", m.criadoEm || agora(),
      );
      return r.changes ? Number(r.lastInsertRowid) : null;
    },
    /** Corrige a autoria de uma mensagem de saída já registrada (eco do WhatsApp chegou antes). */
    atribuirMensagem(waId, { atendimentoId, atendenteId, autorNome, texto }) {
      exec(
        "UPDATE mensagens SET atendimento_id = ?, atendente_id = ?, autor_nome = ?, texto = ? WHERE wa_id = ?",
        atendimentoId, atendenteId, autorNome, texto, waId,
      );
    },
    buscarMensagens(ids) {
      if (!ids.length) return [];
      return todos(`SELECT * FROM mensagens WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ...ids);
    },
    ultimasMensagensDoChat: (jid, limite, antesDoId) =>
      todos(
        "SELECT * FROM mensagens WHERE chat_jid = ? AND id < ? ORDER BY id DESC LIMIT ?",
        jid, antesDoId ?? Number.MAX_SAFE_INTEGER, limite,
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

    // ---------- atendimentos ----------
    criarAtendimento({ chatJid, setorId, atendenteId, urgencia, resumo, motivo }) {
      const r = exec(
        `INSERT INTO atendimentos (chat_jid, setor_id, atendente_id, urgencia, resumo, motivo, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        chatJid, setorId, atendenteId ?? null, urgencia || "normal", resumo || "", motivo || "", agora(), agora(),
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
    atendimentosAbertosDoChat: (jid) =>
      todos(`${SELECT_ATENDIMENTO} WHERE a.chat_jid = ? AND a.status != 'resolvido' ORDER BY a.atualizado_em DESC`, jid),
    /** setores = null lista de todos os setores (admin). */
    listarAtendimentos({ setores = null, atendenteId = null, resolvidos = false, limite = 200 }) {
      const filtros = [resolvidos ? "a.status = 'resolvido'" : "a.status != 'resolvido'"];
      const params = [];
      if (setores) {
        if (!setores.length) return [];
        filtros.push(`a.setor_id IN (${setores.map(() => "?").join(",")})`);
        params.push(...setores);
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
