import path from "node:path";

/**
 * Mantém uma conexão de WhatsApp por canal (número). A central fala só com este
 * gerenciador, informando o canal em cada envio.
 */
export async function criarGerenciadorDeCanais({ modo, pastaSessoes, maxArquivoBytes, log = console }) {
  let criarConexao;
  if (modo === "baileys") {
    const { criarBaileys } = await import("./baileys.js");
    criarConexao = (canalId) => criarBaileys({ pastaSessao: path.join(pastaSessoes, `canal-${canalId}`), maxArquivoBytes, log });
  } else if (modo === "simulador") {
    const { criarSimulador } = await import("./simulador.js");
    criarConexao = () => criarSimulador();
  } else {
    throw new Error(`WHATSAPP_MODO inválido: "${modo}" (use "baileys" ou "simulador")`);
  }

  const conexoes = new Map(); // canalId -> conexão
  let aoReceber = () => {};
  let aoMudar = () => {};

  const conexaoDe = (canalId) => {
    const conexao = conexoes.get(canalId);
    if (!conexao) throw new Error("Este número de WhatsApp está desativado.");
    return conexao;
  };

  return {
    modo,
    aoReceberMensagem: (fn) => (aoReceber = fn),
    aoMudarEstado: (fn) => (aoMudar = fn),

    /** Liga a conexão de um canal (no modo real, gera o QR code se ainda não estiver vinculado). */
    async iniciarCanal(canalId) {
      if (conexoes.has(canalId)) return;
      const conexao = criarConexao(canalId);
      conexao.aoReceberMensagem((msg) => aoReceber({ ...msg, canalId }));
      conexao.aoMudarEstado((estado) => aoMudar(canalId, estado));
      conexoes.set(canalId, conexao);
      await conexao.iniciar();
    },
    /** Desliga a conexão de um canal desativado, mantendo o vínculo com o celular. */
    async pararCanal(canalId) {
      const conexao = conexoes.get(canalId);
      conexoes.delete(canalId);
      await conexao?.parar();
    },
    /** Desvincula o celular e recomeça, para ler um novo QR code (trocar de aparelho ou de número). */
    async desvincularCanal(canalId) {
      const conexao = conexaoDe(canalId);
      await conexao.desvincular();
      await conexao.iniciar();
    },
    estado: (canalId) => conexoes.get(canalId)?.estado() ?? { modo, status: "desativado", qr: null, numero: null },
    enviarTexto: (canalId, jid, texto) => conexaoDe(canalId).enviarTexto(jid, texto),
    /** Só no simulador: injeta uma mensagem de cliente no canal. */
    simularRecebimento: (canalId, dados) => conexaoDe(canalId).simularRecebimento(dados),
    /** Só no simulador: mensagens "enviadas" por um canal. */
    enviadas: (canalId) => conexaoDe(canalId).enviadas,
  };
}
