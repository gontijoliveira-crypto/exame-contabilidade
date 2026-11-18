import { randomUUID } from "node:crypto";

/**
 * Adaptador de testes: não conecta ao WhatsApp. As mensagens "recebidas" são
 * injetadas pelo painel (ou pelos testes) e as "enviadas" ficam guardadas em memória.
 */
export function criarSimulador() {
  let aoReceber = () => {};
  const enviadas = [];

  return {
    modo: "simulador",
    enviadas,
    aoReceberMensagem: (fn) => (aoReceber = fn),
    aoMudarEstado: () => {},
    iniciar: async () => {},
    estado: () => ({ modo: "simulador", status: "conectado", qr: null }),
    async enviarTexto(jid, texto) {
      const waId = `sim-${randomUUID()}`;
      enviadas.push({ jid, texto, waId });
      return { waId };
    },
    /** Simula a chegada de uma mensagem de cliente. */
    simularRecebimento({ chatNome, chatTipo = "grupo", autorNome, texto }) {
      const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      aoReceber({
        waId: `sim-${randomUUID()}`,
        chatJid: chatTipo === "grupo" ? `${slug(chatNome)}@g.us` : `${slug(autorNome)}@s.whatsapp.net`,
        chatNome: chatTipo === "grupo" ? chatNome : autorNome,
        chatTipo,
        autorJid: `${slug(autorNome)}@s.whatsapp.net`,
        autorNome,
        texto,
        tipo: "texto",
        criadoEm: new Date().toISOString(),
      });
    },
  };
}
