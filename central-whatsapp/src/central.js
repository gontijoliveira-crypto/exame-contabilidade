import { EventEmitter } from "node:events";

const HISTORICO_PARA_TRIAGEM = 15;

/**
 * Núcleo da central: recebe as mensagens do WhatsApp, pede a triagem à IA,
 * abre/continua atendimentos por setor e envia as respostas dos atendentes.
 *
 * Emite "mudou" sempre que algo que o painel mostra foi alterado.
 */
export class Central extends EventEmitter {
  constructor({ banco, whatsapp, classificar, setorPadrao, esperaMs = 8000, assinarRespostas = true, arquivos = null, log = console }) {
    super();
    this.banco = banco;
    this.whatsapp = whatsapp;
    this.classificar = classificar; // pode ser null (sem IA configurada)
    this.setorPadrao = setorPadrao;
    this.esperaMs = esperaMs;
    this.assinarRespostas = assinarRespostas;
    this.arquivos = arquivos; // guarda fotos, documentos, vídeos e áudios (pode ser null)
    this.log = log;
    this.pendentes = new Map(); // chatId -> { ids: number[], timer }
    this.filas = new Map(); // chatId -> Promise (uma triagem por chat de cada vez)
  }

  /**
   * Entrada de uma mensagem vinda do WhatsApp.
   * `arquivo` (opcional): { nome, mime, buffer } de uma foto, documento, vídeo ou áudio.
   * msg: { canalId, waId, chatJid, chatNome, chatTipo, autorJid, autorNome, texto, tipo, criadoEm, enviadaPorNos }
   */
  receberMensagem(msg) {
    const chatId = this.banco.salvarChat({ canalId: msg.canalId, jid: msg.chatJid, tipo: msg.chatTipo, nome: msg.chatNome });
    const { arquivo, ...semArquivo } = msg;
    msg = { ...semArquivo, chatId };
    const guardarArquivo = (mensagemId) => {
      if (!mensagemId || !arquivo?.buffer || !this.arquivos) return;
      try {
        this.arquivos.guardar({ mensagemId, criadoEm: msg.criadoEm, tipo: msg.tipo, arquivo });
      } catch (erro) {
        this.log.error("Não foi possível guardar o arquivo da mensagem", mensagemId, erro.message);
      }
    };

    // Mensagem enviada pelo próprio número fora do painel (pelo celular do escritório):
    // fica registrada no atendimento mais recente do chat, sem passar pela triagem.
    if (msg.enviadaPorNos) {
      const aberto = this.banco.atendimentosAbertosDoChat(chatId)[0];
      const id = this.banco.inserirMensagem({ ...msg, direcao: "saida", autorNome: "Escritório (celular)", atendimentoId: aberto?.id });
      guardarArquivo(id);
      if (id && aberto) {
        this.banco.atualizarAtendimento(aberto.id, { pendente: 0 });
        this.emit("mudou", { atendimentoId: aberto.id });
      }
      return;
    }

    const id = this.banco.inserirMensagem({ ...msg, direcao: "entrada" });
    if (!id) return; // duplicada
    guardarArquivo(id);

    // Junta mensagens seguidas do mesmo chat numa única triagem.
    const p = this.pendentes.get(chatId) || { ids: [], timer: null };
    p.ids.push(id);
    clearTimeout(p.timer);
    p.timer = setTimeout(() => this.processarChat(chatId), this.esperaMs);
    this.pendentes.set(chatId, p);
  }

  /** Faz a triagem das mensagens acumuladas de um chat. Devolve quando terminar. */
  processarChat(chatId) {
    const p = this.pendentes.get(chatId);
    if (!p) return this.filas.get(chatId) || Promise.resolve();
    clearTimeout(p.timer);
    this.pendentes.delete(chatId);

    const anterior = this.filas.get(chatId) || Promise.resolve();
    const atual = anterior
      .then(() => this.#triar(chatId, p.ids))
      .catch((erro) => this.log.error("Falha ao processar chat", chatId, erro));
    this.filas.set(chatId, atual);
    return atual;
  }

  /** Processa tudo o que estiver aguardando (usado nos testes e ao encerrar). */
  async processarTudo() {
    await Promise.all([...this.pendentes.keys()].map((id) => this.processarChat(id)));
    await Promise.all(this.filas.values());
  }

  async #triar(chatId, ids) {
    const chat = this.banco.buscarChat(chatId);
    const novas = this.banco.buscarMensagens(ids);
    const abertos = this.banco.atendimentosAbertosDoChat(chatId);
    const setores = this.banco.listarSetores();
    const decisao = await this.#decidir({ chat, novas, abertos, setores });

    if (decisao.acao === "ignorar") return;

    let atendimentoId;
    if (decisao.acao === "continuar") {
      atendimentoId = decisao.atendimento_id;
      const campos = { pendente: 1 };
      if (decisao.resumo) campos.resumo = decisao.resumo;
      if (decisao.urgencia === "alta") campos.urgencia = "alta";
      this.banco.atualizarAtendimento(atendimentoId, campos);
    } else {
      atendimentoId = this.banco.criarAtendimento({
        chatId,
        setorId: decisao.setor_id,
        atendenteId: this.banco.atendenteMenosOcupado(decisao.setor_id, chat.canal_id),
        urgencia: decisao.urgencia,
        resumo: decisao.resumo,
        motivo: decisao.motivo,
      });
    }
    this.banco.vincularMensagens(ids, atendimentoId);
    this.emit("mudou", { atendimentoId, novo: decisao.acao === "novo" });
  }

  /** Consulta a IA e garante que a decisão é aplicável; sem IA (ou com erro), usa o setor padrão. */
  async #decidir({ chat, novas, abertos, setores }) {
    const reserva = (motivo) =>
      abertos.length
        ? { acao: "continuar", atendimento_id: abertos[0].id, setor_id: abertos[0].setor_id, urgencia: "normal", resumo: "", motivo }
        : {
            acao: "novo",
            atendimento_id: null,
            setor_id: this.setorPadrao,
            urgencia: "normal",
            resumo: novas.map((m) => m.texto).join(" ").slice(0, 140),
            motivo,
          };

    if (!this.classificar) return reserva("Triagem por IA não configurada: encaminhado ao setor padrão.");

    let d;
    try {
      const historico = this.banco.ultimasMensagensDoChat(chat.id, HISTORICO_PARA_TRIAGEM, novas[0].id);
      d = await this.classificar({ chat, novas, historico, abertos, setores });
    } catch (erro) {
      this.log.error("Triagem por IA falhou:", erro.message);
      return reserva("Triagem por IA indisponível no momento: encaminhado para revisão manual.");
    }

    if (d.acao === "continuar" && !abertos.some((a) => a.id === d.atendimento_id)) d = { ...d, acao: "novo" };
    if (!setores.some((s) => s.id === d.setor_id)) d = { ...d, setor_id: this.setorPadrao };
    return d;
  }

  /** Resposta de um atendente pelo painel: envia ao chat e registra no atendimento. */
  async responder(atendimentoId, atendente, texto) {
    const a = this.banco.buscarAtendimento(atendimentoId);
    if (!a) throw new Error("Atendimento não encontrado");
    const enviado = this.assinarRespostas ? `*${atendente.nome} (${a.setor_nome}):*\n${texto}` : texto;

    const { waId } = await this.whatsapp.enviarTexto(a.canal_id, a.chat_jid, enviado);
    const registro = { atendimentoId, autorNome: atendente.nome, atendenteId: atendente.id, texto };
    const inserida = this.banco.inserirMensagem({ ...registro, waId, chatId: a.chat_id, direcao: "saida" });
    if (!inserida) this.banco.atribuirMensagem(a.chat_id, waId, registro);
    this.banco.atualizarAtendimento(atendimentoId, {
      pendente: 0,
      status: "em_atendimento",
      atendente_id: a.atendente_id ?? atendente.id,
    });
    this.emit("mudou", { atendimentoId });
  }

  assumir(atendimentoId, atendente) {
    this.banco.atualizarAtendimento(atendimentoId, { atendente_id: atendente.id, status: "em_atendimento" });
    this.emit("mudou", { atendimentoId });
  }

  /** Corrige o encaminhamento: muda de setor e redistribui (ou entrega a um atendente específico). */
  transferir(atendimentoId, setorId, atendenteId = null) {
    const a = this.banco.buscarAtendimento(atendimentoId);
    this.banco.atualizarAtendimento(atendimentoId, {
      setor_id: setorId,
      atendente_id: atendenteId ?? this.banco.atendenteMenosOcupado(setorId, a.canal_id),
      status: "aberto",
    });
    this.emit("mudou", { atendimentoId });
  }

  definirStatus(atendimentoId, status) {
    this.banco.atualizarAtendimento(atendimentoId, status === "resolvido" ? { status, pendente: 0 } : { status });
    this.emit("mudou", { atendimentoId });
  }
}
