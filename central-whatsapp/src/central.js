import { EventEmitter } from "node:events";

const HISTORICO_PARA_TRIAGEM = 15;

/**
 * Núcleo da central: recebe as mensagens do WhatsApp, pede a triagem à IA,
 * abre/continua atendimentos por setor e envia as respostas dos atendentes.
 *
 * Emite "mudou" sempre que algo que o painel mostra foi alterado.
 */
export class Central extends EventEmitter {
  constructor({ banco, whatsapp, classificar, setorPadrao, esperaMs = 8000, assinarRespostas = true, log = console }) {
    super();
    this.banco = banco;
    this.whatsapp = whatsapp;
    this.classificar = classificar; // pode ser null (sem IA configurada)
    this.setorPadrao = setorPadrao;
    this.esperaMs = esperaMs;
    this.assinarRespostas = assinarRespostas;
    this.log = log;
    this.pendentes = new Map(); // chatJid -> { ids: number[], timer }
    this.filas = new Map(); // chatJid -> Promise (uma triagem por chat de cada vez)
  }

  /**
   * Entrada de uma mensagem vinda do WhatsApp.
   * msg: { waId, chatJid, chatNome, chatTipo, autorJid, autorNome, texto, tipo, criadoEm, enviadaPorNos }
   */
  receberMensagem(msg) {
    this.banco.salvarChat({ jid: msg.chatJid, tipo: msg.chatTipo, nome: msg.chatNome });

    // Mensagem enviada pelo próprio número fora do painel (pelo celular do escritório):
    // fica registrada no atendimento mais recente do chat, sem passar pela triagem.
    if (msg.enviadaPorNos) {
      const aberto = this.banco.atendimentosAbertosDoChat(msg.chatJid)[0];
      const id = this.banco.inserirMensagem({ ...msg, direcao: "saida", autorNome: "Escritório (celular)", atendimentoId: aberto?.id });
      if (id && aberto) {
        this.banco.atualizarAtendimento(aberto.id, { pendente: 0 });
        this.emit("mudou", { atendimentoId: aberto.id });
      }
      return;
    }

    const id = this.banco.inserirMensagem({ ...msg, direcao: "entrada" });
    if (!id) return; // duplicada

    // Junta mensagens seguidas do mesmo chat numa única triagem.
    const p = this.pendentes.get(msg.chatJid) || { ids: [], timer: null };
    p.ids.push(id);
    clearTimeout(p.timer);
    p.timer = setTimeout(() => this.processarChat(msg.chatJid), this.esperaMs);
    this.pendentes.set(msg.chatJid, p);
  }

  /** Faz a triagem das mensagens acumuladas de um chat. Devolve quando terminar. */
  processarChat(chatJid) {
    const p = this.pendentes.get(chatJid);
    if (!p) return this.filas.get(chatJid) || Promise.resolve();
    clearTimeout(p.timer);
    this.pendentes.delete(chatJid);

    const anterior = this.filas.get(chatJid) || Promise.resolve();
    const atual = anterior
      .then(() => this.#triar(chatJid, p.ids))
      .catch((erro) => this.log.error("Falha ao processar chat", chatJid, erro));
    this.filas.set(chatJid, atual);
    return atual;
  }

  /** Processa tudo o que estiver aguardando (usado nos testes e ao encerrar). */
  async processarTudo() {
    await Promise.all([...this.pendentes.keys()].map((jid) => this.processarChat(jid)));
    await Promise.all(this.filas.values());
  }

  async #triar(chatJid, ids) {
    const chat = this.banco.buscarChat(chatJid);
    const novas = this.banco.buscarMensagens(ids);
    const abertos = this.banco.atendimentosAbertosDoChat(chatJid);
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
        chatJid,
        setorId: decisao.setor_id,
        atendenteId: this.banco.atendenteMenosOcupado(decisao.setor_id),
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
      const historico = this.banco.ultimasMensagensDoChat(chat.jid, HISTORICO_PARA_TRIAGEM, novas[0].id);
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

    const { waId } = await this.whatsapp.enviarTexto(a.chat_jid, enviado);
    const registro = { atendimentoId, autorNome: atendente.nome, atendenteId: atendente.id, texto };
    const inserida = this.banco.inserirMensagem({ ...registro, waId, chatJid: a.chat_jid, direcao: "saida" });
    if (!inserida) this.banco.atribuirMensagem(waId, registro);
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
    this.banco.atualizarAtendimento(atendimentoId, {
      setor_id: setorId,
      atendente_id: atendenteId ?? this.banco.atendenteMenosOcupado(setorId),
      status: "aberto",
    });
    this.emit("mudou", { atendimentoId });
  }

  definirStatus(atendimentoId, status) {
    this.banco.atualizarAtendimento(atendimentoId, status === "resolvido" ? { status, pendente: 0 } : { status });
    this.emit("mudou", { atendimentoId });
  }
}
