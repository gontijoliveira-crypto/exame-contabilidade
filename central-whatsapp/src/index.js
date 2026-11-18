import { criarAuth, gerarHash, gerarSenha } from "./auth.js";
import { Central } from "./central.js";
import { criarClassificador } from "./classificador.js";
import { carregarEntrada, carregarMarca, carregarSetores, config } from "./config.js";
import { criarFonteDeEntrada } from "./entrada.js";
import { criarArquivos } from "./arquivos.js";
import { criarBackup } from "./backup.js";
import { criarEnviadorDeEmail } from "./email.js";
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

const whatsapp = await criarGerenciadorDeCanais({
  modo: config.whatsappModo,
  pastaSessoes: config.pastaSessoesWhatsapp,
  maxArquivoBytes: config.arquivos.maxArquivoBytes,
});
const arquivos = criarArquivos({
  banco,
  pastaLocal: config.arquivos.pastaLocal,
  maxLocalBytes: config.arquivos.maxLocalBytes,
  url: config.backup.url,
  segredo: config.backup.segredo,
});
arquivos.iniciar();

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
  arquivos,
});
central.setMaxListeners(0); // um ouvinte por painel aberto

whatsapp.aoReceberMensagem((msg) => central.receberMensagem(msg));
whatsapp.aoMudarEstado((canalId, estado) => central.emit("mudou", { canalId, whatsapp: estado.status }));

const email = criarEnviadorDeEmail({ smtp: config.smtp });
if (!email.configurado) {
  console.warn("AVISO: SMTP não configurado. Os e-mails de \"esqueci minha senha\" serão mostrados no terminal, não enviados.");
}

const cfgEntrada = carregarEntrada();
const entrada = criarFonteDeEntrada({
  fonte: cfgEntrada.fonte,
  cliente: cfgEntrada.cliente,
  arquivoCache: cfgEntrada.arquivoCache,
  intervaloMs: (cfgEntrada.atualizarMinutos || 60) * 60 * 1000,
});
entrada.iniciar(); // sem esperar: a tela de entrada funciona mesmo sem os indicadores

const backup = criarBackup({ banco, ...config.backup });
backup.iniciar();
if (!backup.configurado) console.warn("AVISO: backup no Google Drive não configurado (BACKUP_URL e BACKUP_SEGREDO). As cópias ficam só no servidor.");

const app = criarServidor({
  banco,
  central,
  auth: criarAuth(banco),
  whatsapp,
  raiz: config.raiz,
  marca: carregarMarca(),
  email,
  urlPainel: config.urlPainel,
  entrada,
  backup,
  arquivos,
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
