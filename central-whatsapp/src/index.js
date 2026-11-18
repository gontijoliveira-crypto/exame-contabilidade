import { criarAuth, gerarHash, gerarSenha } from "./auth.js";
import { Central } from "./central.js";
import { criarClassificador } from "./classificador.js";
import { carregarSetores, config } from "./config.js";
import { abrirBanco } from "./db.js";
import { criarServidor } from "./servidor.js";
import { criarGerenciadorDeCanais } from "./whatsapp/canais.js";

const banco = abrirBanco(config.arquivoBanco);
const { setores, setorPadrao } = carregarSetores();
banco.sincronizarSetores(setores);

// Primeiro acesso: cria o administrador.
if (banco.contarAtendentes() === 0) {
  const senha = config.adminSenha || gerarSenha();
  banco.criarAtendente({ nome: "Administrador", email: config.adminEmail, senhaHash: gerarHash(senha), admin: true });
  console.log(`\nAdministrador criado. E-mail de acesso: ${config.adminEmail}`);
  if (!config.adminSenha) console.log(`Senha gerada (anote, ela não será mostrada de novo): ${senha}`);
}

// Primeiro uso: já deixa um número cadastrado, pronto para ler o QR code.
if (banco.listarCanais({ inativos: true }).length === 0) banco.criarCanal("WhatsApp 1");

const whatsapp = await criarGerenciadorDeCanais({ modo: config.whatsappModo, pastaSessoes: config.pastaSessoesWhatsapp });

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
whatsapp.aoMudarEstado((canalId, estado) => central.emit("mudou", { canalId, whatsapp: estado.status }));

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

for (const canal of banco.listarCanais()) {
  whatsapp.iniciarCanal(canal.id).catch((erro) => console.error(`Falha ao iniciar o número "${canal.nome}":`, erro.message));
}

async function encerrar() {
  console.log("\nEncerrando...");
  servidor.close();
  await central.processarTudo(); // não perde mensagens que aguardavam a triagem
  banco.fechar();
  process.exit(0);
}
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
