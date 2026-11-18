import assert from "node:assert/strict";
import { test } from "node:test";
import { criarAuth, gerarHash } from "../src/auth.js";
import { Central } from "../src/central.js";
import { carregarSetores } from "../src/config.js";
import { abrirBanco } from "../src/db.js";
import { criarGerenciadorDeCanais } from "../src/whatsapp/canais.js";

const silencioso = { error() {}, warn() {}, info() {} };

/** Monta uma central em memória. `decisoes` são as respostas que a "IA" dará, em ordem. */
async function montar({ decisoes = [], comIA = true } = {}) {
  const banco = abrirBanco(":memory:");
  const { setores, setorPadrao } = carregarSetores();
  banco.sincronizarSetores(setores);
  const whatsapp = await criarGerenciadorDeCanais({ modo: "simulador" });
  const canal1 = banco.criarCanal("WhatsApp 1");
  const canal2 = banco.criarCanal("WhatsApp 2");
  await whatsapp.iniciarCanal(canal1);
  await whatsapp.iniciarCanal(canal2);
  const chamadas = [];
  const classificar = comIA
    ? async (contexto) => {
        chamadas.push(contexto);
        const d = decisoes.shift();
        if (d instanceof Error) throw d;
        return d;
      }
    : null;
  const central = new Central({ banco, whatsapp, classificar, setorPadrao, esperaMs: 60_000, log: silencioso });
  whatsapp.aoReceberMensagem((m) => central.receberMensagem(m));
  const atendente = (nome, setoresDoAtendente, canais = [canal1]) => {
    const id = banco.criarAtendente({ nome, email: `${nome.toLowerCase()}@expo.test`, senhaHash: gerarHash("senha-de-teste"), setores: setoresDoAtendente, canais });
    return banco.buscarAtendente(id);
  };
  const cliente = (texto, chatNome = "Padaria x Expo", canalId = canal1) => whatsapp.simularRecebimento(canalId, { chatNome, autorNome: "Marcos", texto });
  return { banco, whatsapp, central, chamadas, atendente, cliente, canal1, canal2 };
}

const novo = (setor_id, extra = {}) => ({ acao: "novo", atendimento_id: null, setor_id, urgencia: "normal", resumo: "resumo", motivo: "motivo", ...extra });

test("mensagem nova abre atendimento no setor escolhido pela IA e vai para o atendente do setor", async () => {
  const c = await montar({ decisoes: [novo("fiscal", { urgencia: "alta", resumo: "Quer a guia do DAS de outubro" })] });
  const ana = c.atendente("Ana", ["fiscal"]);
  c.atendente("Bruno", ["pessoal"]);

  c.cliente("Bom dia, preciso da guia do DAS de outubro, vence amanhã");
  await c.central.processarTudo();

  const [a] = c.banco.listarAtendimentos({});
  assert.equal(a.setor_id, "fiscal");
  assert.equal(a.atendente_id, ana.id);
  assert.equal(a.urgencia, "alta");
  assert.equal(a.pendente, 1);
  assert.equal(c.banco.mensagensDoAtendimento(a.id).length, 1);
});

test("mensagens seguidas do mesmo chat viram uma única triagem", async () => {
  const c = await montar({ decisoes: [novo("pessoal")] });
  c.cliente("Oi");
  c.cliente("Preciso admitir um funcionário");
  c.cliente("Começa segunda");
  await c.central.processarTudo();

  assert.equal(c.chamadas.length, 1);
  assert.equal(c.chamadas[0].novas.length, 3);
  const [a] = c.banco.listarAtendimentos({});
  assert.equal(c.banco.mensagensDoAtendimento(a.id).length, 3);
});

test("a IA recebe os atendimentos em aberto e pode continuar um deles", async () => {
  const c = await montar({ decisoes: [novo("fiscal")] });
  c.cliente("Preciso da guia do DAS");
  await c.central.processarTudo();
  const [a] = c.banco.listarAtendimentos({});
  c.banco.atualizarAtendimento(a.id, { pendente: 0 });

  c.central.classificar = async (contexto) => {
    assert.deepEqual(contexto.abertos.map((x) => x.id), [a.id]);
    assert.equal(contexto.historico.length, 1);
    return { acao: "continuar", atendimento_id: a.id, setor_id: "fiscal", urgencia: "normal", resumo: "Guia do DAS de outubro", motivo: "" };
  };
  c.cliente("É a de outubro");
  await c.central.processarTudo();

  const lista = c.banco.listarAtendimentos({});
  assert.equal(lista.length, 1);
  assert.equal(lista[0].pendente, 1);
  assert.equal(lista[0].resumo, "Guia do DAS de outubro");
  assert.equal(c.banco.mensagensDoAtendimento(a.id).length, 2);
});

test("assuntos de setores diferentes no mesmo grupo geram atendimentos separados", async () => {
  const c = await montar({ decisoes: [novo("fiscal"), novo("pessoal")] });
  c.cliente("Preciso da guia do DAS");
  await c.central.processarTudo();
  c.cliente("E também quero demitir um funcionário");
  await c.central.processarTudo();
  assert.deepEqual(c.banco.listarAtendimentos({}).map((a) => a.setor_id).sort(), ["fiscal", "pessoal"]);
});

test("'ignorar' guarda a mensagem sem abrir atendimento", async () => {
  const c = await montar({ decisoes: [{ acao: "ignorar", atendimento_id: null, setor_id: "atendimento", urgencia: "baixa", resumo: "", motivo: "saudação" }] });
  c.cliente("Bom dia a todos!");
  await c.central.processarTudo();
  assert.equal(c.banco.listarAtendimentos({}).length, 0);
  assert.equal(c.banco.ultimasMensagensDoChat(1, 10).length, 1);
});

test("decisão inválida da IA é corrigida: 'continuar' com id inexistente vira atendimento novo", async () => {
  const c = await montar({ decisoes: [{ acao: "continuar", atendimento_id: 999, setor_id: "contabil", urgencia: "normal", resumo: "Balancete", motivo: "" }] });
  c.cliente("Me manda o balancete?");
  await c.central.processarTudo();
  const [a] = c.banco.listarAtendimentos({});
  assert.equal(a.setor_id, "contabil");
});

test("se a IA falhar, a mensagem não se perde: vai para o setor padrão", async () => {
  const c = await montar({ decisoes: [new Error("API fora do ar")] });
  c.cliente("Preciso de ajuda com uma nota fiscal");
  await c.central.processarTudo();
  const [a] = c.banco.listarAtendimentos({});
  assert.equal(a.setor_id, "atendimento");
  assert.match(a.motivo, /indisponível/);
  assert.match(a.resumo, /nota fiscal/);
});

test("sem IA configurada, tudo vai para o setor padrão", async () => {
  const c = await montar({ comIA: false });
  c.cliente("Olá");
  await c.central.processarTudo();
  assert.equal(c.banco.listarAtendimentos({})[0].setor_id, "atendimento");
});

test("distribuição equilibrada: o atendente com menos atendimentos em aberto recebe o próximo", async () => {
  const c = await montar({ decisoes: [novo("fiscal"), novo("fiscal"), novo("fiscal")] });
  const ana = c.atendente("Ana", ["fiscal"]);
  const bia = c.atendente("Bia", ["fiscal", "contabil"]);
  for (const grupo of ["Grupo A", "Grupo B", "Grupo C"]) {
    c.cliente("Preciso de uma guia", grupo);
    await c.central.processarTudo();
  }
  const donos = c.banco.listarAtendimentos({}).map((a) => a.atendente_id).sort();
  assert.deepEqual(donos, [ana.id, ana.id, bia.id].sort());
});

test("resposta do atendente é enviada ao grupo com assinatura e registrada no atendimento", async () => {
  const c = await montar({ decisoes: [novo("fiscal")] });
  const ana = c.atendente("Ana", ["fiscal"]);
  c.cliente("Preciso da guia do DAS");
  await c.central.processarTudo();
  const [a] = c.banco.listarAtendimentos({});

  await c.central.responder(a.id, ana, "Segue a guia em anexo.");

  assert.deepEqual(c.whatsapp.enviadas(c.canal1).map((e) => [e.jid, e.texto]), [["padaria-x-expo@g.us", "*Ana (Fiscal):*\nSegue a guia em anexo."]]);
  const depois = c.banco.buscarAtendimento(a.id);
  assert.equal(depois.status, "em_atendimento");
  assert.equal(depois.pendente, 0);
  const msgs = c.banco.mensagensDoAtendimento(a.id);
  assert.equal(msgs.at(-1).direcao, "saida");
  assert.equal(msgs.at(-1).texto, "Segue a guia em anexo.");
  assert.equal(msgs.at(-1).atendente_nome, "Ana");
});

test("transferir muda o setor e redistribui para um atendente do novo setor", async () => {
  const c = await montar({ decisoes: [novo("fiscal")] });
  c.atendente("Ana", ["fiscal"]);
  const bruno = c.atendente("Bruno", ["pessoal"]);
  c.cliente("Quero dar férias para a Joana");
  await c.central.processarTudo();
  const [a] = c.banco.listarAtendimentos({});

  c.central.transferir(a.id, "pessoal");

  const depois = c.banco.buscarAtendimento(a.id);
  assert.equal(depois.setor_id, "pessoal");
  assert.equal(depois.atendente_id, bruno.id);
  assert.equal(c.banco.listarAtendimentos({ setores: ["fiscal"] }).length, 0);
});

test("mensagem repetida pelo WhatsApp (mesmo id) não é duplicada", async () => {
  const c = await montar({ decisoes: [novo("fiscal")] });
  const msg = { canalId: c.canal1, waId: "ABC", chatJid: "1@g.us", chatNome: "Grupo", chatTipo: "grupo", autorJid: "x", autorNome: "X", texto: "Oi, preciso de uma guia" };
  c.central.receberMensagem(msg);
  c.central.receberMensagem(msg);
  await c.central.processarTudo();
  assert.equal(c.chamadas[0].novas.length, 1);
});

test("login: senha errada é recusada, conta inativa não entra e há bloqueio após várias falhas", async () => {
  const c = await montar();
  const ana = c.atendente("Ana", ["fiscal"]);
  const auth = criarAuth(c.banco);

  const { token } = auth.entrar("ana@expo.test", "senha-de-teste");
  assert.equal(auth.atendenteDaSessao(token).id, ana.id);
  assert.equal(auth.atendenteDaSessao("token-qualquer"), null);

  c.banco.atualizarAtendente(ana.id, { ativo: false });
  assert.equal(auth.atendenteDaSessao(token), null);
  assert.throws(() => auth.entrar("ana@expo.test", "senha-de-teste"), /incorretos/);
  c.banco.atualizarAtendente(ana.id, { ativo: true });

  for (let i = 0; i < 5; i++) assert.throws(() => auth.entrar("ana@expo.test", "errada"));
  assert.throws(() => auth.entrar("ana@expo.test", "senha-de-teste"), /Muitas tentativas/);
});

test("números separados: o atendimento só vai para quem tem acesso ao número por onde chegou", async () => {
  const c = await montar({ decisoes: [novo("fiscal"), novo("fiscal")] });
  const ana = c.atendente("Ana", ["fiscal"], [c.canal1]);
  const bia = c.atendente("Bia", ["fiscal"], [c.canal2]);

  c.cliente("Preciso de uma guia", "Grupo do número 1", c.canal1);
  c.cliente("Preciso de uma nota", "Grupo do número 2", c.canal2);
  await c.central.processarTudo();

  const daAna = c.banco.listarAtendimentos({ setores: ana.setores, canais: ana.canais });
  const daBia = c.banco.listarAtendimentos({ setores: bia.setores, canais: bia.canais });
  assert.deepEqual(daAna.map((a) => [a.canal_nome, a.atendente_id]), [["WhatsApp 1", ana.id]]);
  assert.deepEqual(daBia.map((a) => [a.canal_nome, a.atendente_id]), [["WhatsApp 2", bia.id]]);

  // A resposta sai pelo mesmo número por onde a mensagem chegou.
  await c.central.responder(daBia[0].id, bia, "Segue a nota.");
  assert.equal(c.whatsapp.enviadas(c.canal1).length, 0);
  assert.equal(c.whatsapp.enviadas(c.canal2).length, 1);
});

test("o mesmo grupo em dois números são conversas independentes", async () => {
  const c = await montar({ decisoes: [novo("fiscal"), novo("fiscal")] });
  c.cliente("Preciso de uma guia", "Mesmo Grupo", c.canal1);
  c.cliente("Preciso de uma guia", "Mesmo Grupo", c.canal2);
  await c.central.processarTudo();
  assert.equal(c.chamadas.length, 2);
  assert.equal(c.banco.listarAtendimentos({}).length, 2);
});

test("sem atendente com acesso ao número, o atendimento fica na fila sem responsável", async () => {
  const c = await montar({ decisoes: [novo("fiscal")] });
  c.atendente("Ana", ["fiscal"], [c.canal1]);
  c.cliente("Preciso de uma guia", "Grupo", c.canal2);
  await c.central.processarTudo();
  assert.equal(c.banco.listarAtendimentos({})[0].atendente_id, null);
});

test("esqueci minha senha: o link troca a senha uma única vez e encerra as sessões abertas", async () => {
  const c = await montar();
  const ana = c.atendente("Ana", ["fiscal"]);
  let agora = Date.parse("2026-11-18T10:00:00Z");
  const auth = criarAuth(c.banco, { relogio: () => agora });

  const { token: sessao } = auth.entrar("ana@expo.test", "senha-de-teste");
  const pedido = auth.pedirRedefinicao("ana@expo.test");
  assert.equal(pedido.atendente.id, ana.id);

  auth.redefinirSenha(pedido.token, "nova-senha-123");
  assert.equal(auth.atendenteDaSessao(sessao), null, "sessões antigas são encerradas");
  assert.throws(() => auth.entrar("ana@expo.test", "senha-de-teste"), /incorretos/);
  assert.ok(auth.entrar("ana@expo.test", "nova-senha-123").token);
  assert.throws(() => auth.redefinirSenha(pedido.token, "outra-senha-123"), /inválido ou expirou/, "o link vale uma vez só");
  assert.throws(() => auth.redefinirSenha("token-inventado", "outra-senha-123"), /inválido ou expirou/);

  // Novo pedido invalida o anterior; o link expira em 1 hora.
  const primeiro = auth.pedirRedefinicao("ana@expo.test");
  const segundo = auth.pedirRedefinicao("ana@expo.test");
  assert.throws(() => auth.redefinirSenha(primeiro.token, "outra-senha-123"), /inválido/);
  agora += 61 * 60 * 1000;
  assert.throws(() => auth.redefinirSenha(segundo.token, "outra-senha-123"), /expirou/);
});

test("esqueci minha senha: e-mail desconhecido ou inativo não gera link, e há limite de pedidos", async () => {
  const c = await montar();
  const ana = c.atendente("Ana", ["fiscal"]);
  const auth = criarAuth(c.banco);
  assert.equal(auth.pedirRedefinicao("ninguem@expo.test"), null);

  c.banco.atualizarAtendente(ana.id, { ativo: false });
  assert.equal(auth.pedirRedefinicao("ana@expo.test"), null);
  c.banco.atualizarAtendente(ana.id, { ativo: true });

  for (let i = 0; i < 3; i++) assert.ok(auth.pedirRedefinicao("ana@expo.test"));
  assert.equal(auth.pedirRedefinicao("ana@expo.test"), null, "no máximo 3 pedidos por hora");
});

test("e-mail de redefinição tem o link e escapa o nome no HTML", async () => {
  const { mensagemDeRedefinicao } = await import("../src/email.js");
  const marca = { nome: "Expo Contabilidade", cores: { primaria: "#011433", destaque: "#D9911C" } };
  const m = mensagemDeRedefinicao({ nome: "Ana <b>", link: "https://central.exemplo/#redefinir=abc", validadeMinutos: 60, marca });
  assert.match(m.texto, /https:\/\/central\.exemplo\/#redefinir=abc/);
  assert.match(m.html, /Ana &lt;b&gt;/);
  assert.match(m.assunto, /Expo Contabilidade/);
});

test("tela de entrada: lê os indicadores da fonte, guarda cache e mantém o último dado se a fonte falhar", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { criarFonteDeEntrada } = await import("../src/entrada.js");
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "entrada-"));
  const fonte = path.join(pasta, "indicadores.json");
  const cache = path.join(pasta, "cache", "entrada.json");
  fs.writeFileSync(fonte, JSON.stringify({ indicadores: { selic: { nome: "Selic", valor: 13.75 } }, noticias: { itens: [] } }));
  const cliente = { id: "expo", nome: "Expo Contabilidade" };
  const silencio = { warn() {} };

  const f = criarFonteDeEntrada({ fonte, cliente, arquivoCache: cache, log: silencio });
  assert.equal(f.dados(), null);
  await f.atualizar();
  assert.equal(f.dados().indicadores.selic.valor, 13.75);
  assert.equal(f.dados().cliente.nome, "Expo Contabilidade");

  fs.writeFileSync(fonte, "<html>login do Google</html>");
  await f.atualizar();
  assert.equal(f.dados().indicadores.selic.valor, 13.75, "mantém o último dado bom");

  // Ao reiniciar, usa o cache enquanto a fonte não responde.
  const g = criarFonteDeEntrada({ fonte: path.join(pasta, "nao-existe.json"), cliente, arquivoCache: cache, log: silencio });
  await g.iniciar();
  assert.equal(g.dados().indicadores.selic.valor, 13.75);
  fs.rmSync(pasta, { recursive: true, force: true });
});
