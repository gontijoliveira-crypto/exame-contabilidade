import { criarAuth, gerarHash, gerarSenha } from "./auth.js";
import { Central } from "./central.js";
import { criarClassificador } from "./classificador.js";
import { carregarSetores, config } from "./config.js";
import { abrirBanco } from "./db.js";
import { criarServidor } from "./servidor.js";

const banco = abrirBanco(config.arquivoBanco);
const { setores, setorPadrao } = carregarSetores();
banco.sincronizarSetores(setores);

// Primeiro acesso: cria o administrador.
if (banco.contarAtendentes() === 0) {
  const senha = config.adminSenha || gerarSenha();
  banco.criarAtendente({ nome: "Administrador", usuario: config.adminUsuario, senhaHash: gerarHash(senha), admin: true });
  console.log(`\nAdministrador criado. Usuário: ${config.adminUsuario}`);
  if (!config.adminSenha) console.log(`Senha gerada (anote, ela não será mostrada de novo): ${senha}`);
}

let whatsapp;
if (config.whatsappModo === "baileys") {
  const { criarBaileys } = await import("./whatsapp/baileys.js");
  whatsapp = criarBaileys({ pastaSessao: config.pastaSessaoWhatsapp });
} else if (config.whatsappModo === "simulador") {
  const { criarSimulador } = await import("./whatsapp/simulador.js");
  whatsapp = criarSimulador();
} else {
  throw new Error(`WHATSAPP_MODO inválido: "${config.whatsappModo}" (use "baileys" ou "simulador")`);
}

const classificar = criarClassificador({ modelo: config.claudeModelo, setores });
if (!classificar) {
  console.warn("\nAVISO: ANTHROPIC_API_KEY não definida. Sem triagem por IA, toda mensagem vai para o setor padrão.");
}

const central = new Central({
  banco,
  whatsapp,
  classificar,
  setorPadrao,
  esperaMs: config.esperaTriagemMs,
  assinarRespostas: config.assinarRespostas,
});
central.setMaxListeners(0); // um ouvinte por painel aberto

whatsapp.aoReceberMensagem((msg) => central.receberMensagem(msg));
whatsapp.aoMudarEstado((estado) => central.emit("mudou", { whatsapp: estado.status }));

const app = criarServidor({
  banco,
  central,
  auth: criarAuth(banco),
  whatsapp,
  raiz: config.raiz,
  cookieSeguro: process.env.NODE_ENV === "production",
});

const servidor = app.listen(config.porta, () => {
  console.log(`\nPainel da central: http://localhost:${config.porta}  (WhatsApp: modo ${config.whatsappModo})`);
});

await whatsapp.iniciar();

async function encerrar() {
  console.log("\nEncerrando...");
  servidor.close();
  await central.processarTudo(); // não perde mensagens que aguardavam a triagem
  banco.fechar();
  process.exit(0);
}
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
