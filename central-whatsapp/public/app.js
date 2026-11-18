// Painel dos atendentes. Sem framework: o estado fica em `estado` e `desenhar()` refaz a tela.

const raiz = document.getElementById("app");

const estado = {
  eu: null, // resposta de /api/eu
  aba: "atendimentos",
  escopo: "meus", // meus | todos | resolvidos
  lista: [],
  abertoId: null,
  aberto: null, // { atendimento, mensagens }
  rascunhos: new Map(), // atendimentoId -> texto digitado
  acesso: "entrar", // tela sem login: entrar | esqueci | redefinir
  tokenRedefinicao: null,
  avisoAcesso: "", // mensagem mostrada na tela de entrada (ex.: senha alterada)
  atendentes: [],
  canais: [], // números de WhatsApp, com estado e QR code (só administrador)
};

// ---------- utilitários ----------
function el(tag, props = {}, ...filhos) {
  const no = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (valor === false || valor == null) continue;
    if (chave.startsWith("on")) no.addEventListener(chave.slice(2), valor);
    else if (chave === "class") no.className = valor;
    else if (chave in no && chave !== "list") no[chave] = valor;
    else no.setAttribute(chave, valor);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) no.append(f);
  return no;
}

// Marca do escritório (config/marca.json): logo em imagem, ou o nome em texto enquanto não houver logo.
let marca = { nome: "", subtitulo: "", logo: null };

function logo(classe) {
  const conteudo = marca.logo
    ? el("img", { class: "imagem", src: marca.logo, alt: marca.nome })
    : el("span", { class: "palavra" }, marca.nome);
  return el("span", { class: `logo ${classe}` }, conteudo, marca.subtitulo && el("span", { class: "sub" }, marca.subtitulo));
}

async function api(caminho, corpo, metodo) {
  const resposta = await fetch(`/api${caminho}`, {
    method: metodo || (corpo ? "POST" : "GET"),
    headers: corpo ? { "Content-Type": "application/json" } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401 && estado.eu) {
    estado.eu = null;
    desenhar();
  }
  if (!resposta.ok) throw new Error(dados.erro || "Não foi possível concluir. Tente novamente.");
  return dados;
}

function quando(iso) {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const ROTULO_STATUS = { aberto: "Aguardando", em_atendimento: "Em atendimento", resolvido: "Resolvido" };
const ROTULO_CONEXAO = { conectado: "Conectado", aguardando_qr: "Aguardando leitura do QR code", desconectado: "Desconectado", desativado: "Desativado" };

function chipsDoAtendimento(a) {
  return [
    estado.eu.canais.length > 1 && el("span", { class: "chip canal" }, a.canal_nome),
    el("span", { class: "chip setor" }, a.setor_nome),
    a.urgencia === "alta" && el("span", { class: "chip alta" }, "Urgente"),
    el("span", { class: "chip neutro" }, a.atendente_nome || "Sem responsável"),
    el("span", { class: `chip ${a.status === "resolvido" ? "ok" : "neutro"}` }, ROTULO_STATUS[a.status]),
  ];
}

// ---------- dados ----------
async function carregarLista() {
  const consulta = estado.escopo === "resolvidos" ? "escopo=todos&resolvidos=1" : `escopo=${estado.escopo}`;
  estado.lista = await api(`/atendimentos?${consulta}`);
}

async function carregarAberto() {
  if (!estado.abertoId) return (estado.aberto = null);
  try {
    estado.aberto = await api(`/atendimentos/${estado.abertoId}`);
  } catch {
    estado.abertoId = estado.aberto = null; // transferido para outro setor, por exemplo
  }
}

async function atualizar() {
  if (!estado.eu) return;
  await Promise.all([carregarLista(), carregarAberto()]);
  if (estado.aba === "atendentes") estado.atendentes = await api("/atendentes");
  if (estado.aba === "whatsapp") estado.canais = await api("/canais");
  if (estado.aba === "backup") estado.backup = await api("/backup");
  desenhar();
}

/**
 * Link do e-mail de redefinição: /#redefinir=<token>. Mostra a tela de nova senha e tira o token
 * da barra de endereço. Devolve true se havia um link.
 */
function abrirLinkDeRedefinicao() {
  const pedido = location.hash.match(/^#redefinir=([\w-]+)$/);
  if (!pedido) return false;
  estado.tokenRedefinicao = pedido[1];
  estado.eu = null; // a troca de senha encerra as sessões abertas
  history.replaceState(null, "", location.pathname);
  irPara("redefinir");
  return true;
}
// Link aberto numa aba que já estava no painel (só o trecho depois do # muda).
window.addEventListener("hashchange", abrirLinkDeRedefinicao);

async function iniciar() {
  if (abrirLinkDeRedefinicao()) return;
  try {
    estado.eu = await api("/eu");
  } catch {
    estado.eu = null;
    return desenhar();
  }
  await atualizar();
  const eventos = new EventSource("/api/eventos");
  eventos.onmessage = async (e) => {
    const evento = JSON.parse(e.data);
    if (evento.canalId) estado.eu = await api("/eu"); // mudou a conexão ou o cadastro de um número
    // Não refaz a tela enquanto alguém preenche um formulário da administração.
    const preenchendo = estado.aba === "atendentes" || estado.aba === "backup" || (estado.aba === "whatsapp" && estado.eu.modo === "simulador");
    if (!preenchendo) await atualizar();
  };
}

/** Executa uma ação do atendimento aberto e mostra o erro, se houver. */
async function acao(caminho, corpo = {}) {
  try {
    await api(`/atendimentos/${estado.abertoId}/${caminho}`, corpo);
    await atualizar();
  } catch (erro) {
    alert(erro.message);
  }
}

// ---------- telas ----------
/*
 * Telas sem login (entrar, esqueci, nova senha) no mesmo padrão dos painéis da Central de Painéis:
 * à esquerda, indicadores e notícias do mercado; à direita, um MacBook com o formulário na tela.
 * O desenho vem do bloco ENTRADA-INDICADORES da Central (public/entrada/). Sem os indicadores,
 * fica o cartão simples sobre o fundo azul.
 */
let entradaDados; // undefined = ainda não buscou; null = indisponível
const entradaPronta = fetch("/api/entrada")
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
  .then((d) => (entradaDados = d && d.indicadores && Object.keys(d.indicadores).length ? d : null));

/** Mensagem do formulário (erro em vermelho claro, confirmação em verde claro). */
function mensagem(texto = "", ok = false) {
  return el("div", { id: "lg-msg", class: `erro${ok ? " ok" : ""}`, role: ok ? "status" : "alert" }, texto);
}
function mostrar(msg, texto, ok = false) {
  msg.textContent = texto;
  msg.className = `erro${ok ? " ok" : ""}`;
}

/** Monta a tela: o formulário (com a logo) dentro do MacBook, ao lado dos indicadores. */
function telaDeAcesso(formulario) {
  const login = el("div", { class: "login", id: "login" }, logo("grande"), formulario);
  if (entradaDados && window.IXL_render) montarMesa(login, formulario, entradaDados);
  else if (entradaDados === undefined) entradaPronta.then(() => entradaDados && !estado.eu && desenhar());
  return login;
}

function montarMesa(login, formulario, dados) {
  const C = dados.cliente || {};
  const cor = C.cor || "#C9962B";
  const aside = el("aside", { class: "ixl ixl-claro", "aria-label": "Indicadores do mercado" });
  const relogio = el("div", { class: "ixl-ck" }, el("div", { class: "d" }), el("div", { class: "t" }));
  const hora = el("span", { class: "ixl-hr" });
  const tela = el("div", { class: "ixl-scr" },
    el("div", { class: "ixl-notch" }),
    el("div", { class: "ixl-mb" }, el("span", { class: "ixl-nm" }, C.nome || marca.nome), hora),
    relogio,
    formulario);
  const sombra = (hex, a) => {
    const n = parseInt(hex.slice(1), 16), c = (x) => Math.max(0, Math.min(255, x));
    return "#" + ((1 << 24) | (c((n >> 16) + a) << 16) | (c(((n >> 8) & 255) + a) << 8) | c((n & 255) + a)).toString(16).slice(1);
  };
  tela.style.background =
    `radial-gradient(120% 90% at 15% 10%,${sombra(cor, 40)} 0%,transparent 55%),radial-gradient(90% 80% at 90% 20%,${cor} 0%,transparent 60%),` +
    `radial-gradient(100% 90% at 70% 100%,${sombra(cor, -60)} 0%,transparent 60%),linear-gradient(160deg,${sombra(cor, -90)},#0a1f2e)`;
  const direita = el("div", { class: "ixl-dir" },
    el("div", { class: "ixl-mac" }, el("div", { class: "ixl-lid" }, tela), el("div", { class: "ixl-base" })),
    el("p", { class: "ixl-hint" }, "Entre com seu e-mail e senha. Se esqueceu a senha, use \"Esqueci minha senha\"."),
    el("div", { class: "ixl-foot" }, el("span", {}, "Central de Atendimento"), el("span", {}, "Acesso privado"), el("span", {}, marca.nome || C.nome)));
  const tick = () => {
    const n = new Date(), d = n.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    relogio.firstChild.textContent = d.charAt(0).toUpperCase() + d.slice(1);
    relogio.lastChild.textContent = n.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    hora.textContent = n.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }) + " " + relogio.lastChild.textContent;
  };
  tick();
  clearInterval(montarMesa.relogio);
  montarMesa.relogio = setInterval(() => (document.contains(relogio) ? tick() : clearInterval(montarMesa.relogio)), 20000);
  login.replaceChildren(aside, direita);
  login.classList.add("ixl-on");
  window.IXL_render(aside, dados);
}

/** Formulário de acesso: logo, título e os campos do passo atual. */
function formularioDeAcesso(titulo, aoEnviar, ...campos) {
  const logoImg = marca.logo && el("img", { class: "logo-form", src: marca.logo, alt: marca.nome });
  return el("form", { class: "cartao-acesso", onsubmit: (e) => { e.preventDefault(); aoEnviar(); } },
    logoImg,
    el("h1", {}, titulo),
    el("p", { class: "sub" }, "Atendimento por WhatsApp"),
    ...campos);
}

function irPara(acesso, aviso = "") {
  estado.acesso = acesso;
  estado.avisoAcesso = aviso;
  desenhar();
}

function telaLogin() {
  const msg = mensagem(estado.avisoAcesso, !!estado.avisoAcesso);
  const email = el("input", { id: "lg-email", type: "email", autocomplete: "username", required: true });
  const senha = el("input", { id: "lg-senha", type: "password", autocomplete: "current-password", required: true });
  const botao = el("button", { class: "primario ent", type: "submit", id: "lg-entrar" }, "Entrar");
  try { email.value = localStorage.getItem("central_email") || ""; } catch { /* sem armazenamento */ }
  queueMicrotask(() => (email.value ? senha : email).focus());
  return telaDeAcesso(formularioDeAcesso("Central de Atendimento", async () => {
    botao.disabled = true;
    mostrar(msg, "Conferindo…", true);
    try {
      await api("/login", { email: email.value, senha: senha.value });
      try { localStorage.setItem("central_email", email.value.trim()); } catch { /* sem armazenamento */ }
      estado.avisoAcesso = "";
      await iniciar();
    } catch (falha) {
      mostrar(msg, falha.message);
      botao.disabled = false;
    }
  },
    el("label", {}, "E-mail", email),
    el("label", {}, "Senha", senha),
    msg,
    botao,
    el("button", { class: "link lk", type: "button", id: "lg-esqueci", onclick: () => irPara("esqueci") }, "Esqueci minha senha"),
  ));
}

function telaEsqueci() {
  const msg = mensagem();
  const email = el("input", { id: "lg-email", type: "email", autocomplete: "username", required: true });
  try { email.value = localStorage.getItem("central_email") || ""; } catch { /* sem armazenamento */ }
  const botao = el("button", { class: "primario ent", type: "submit" }, "Enviar link por e-mail");
  queueMicrotask(() => email.focus());
  return telaDeAcesso(formularioDeAcesso("Esqueci minha senha", async () => {
    botao.disabled = true;
    try {
      await api("/senha/esqueci", { email: email.value });
      mostrar(msg, `Se ${email.value.trim()} estiver cadastrado, o link para criar uma nova senha chega em instantes (veja também o spam). Ele vale por 1 hora.`, true);
    } catch (falha) {
      mostrar(msg, falha.message);
      botao.disabled = false;
    }
  },
    el("p", { class: "dica" }, "Informe o e-mail que você usa para entrar. Vamos enviar um link para você criar uma nova senha."),
    el("label", {}, "E-mail", email),
    msg,
    botao,
    el("button", { class: "link lk", type: "button", id: "lg-voltar", onclick: () => irPara("entrar") }, "Voltar"),
  ));
}

function telaRedefinir() {
  const msg = mensagem();
  const senha = el("input", { id: "lg-nova", type: "password", autocomplete: "new-password", required: true, minLength: 8 });
  const repetir = el("input", { id: "lg-nova2", type: "password", autocomplete: "new-password", required: true, minLength: 8 });
  const botao = el("button", { class: "primario ent", type: "submit", id: "lg-definir" }, "Salvar nova senha");
  queueMicrotask(() => senha.focus());
  return telaDeAcesso(formularioDeAcesso("Criar nova senha", async () => {
    if (senha.value !== repetir.value) return mostrar(msg, "As duas senhas não são iguais.");
    botao.disabled = true;
    try {
      await api("/senha/redefinir", { token: estado.tokenRedefinicao, senha: senha.value });
      estado.tokenRedefinicao = null;
      irPara("entrar", "Senha alterada. Entre com a nova senha.");
    } catch (falha) {
      mostrar(msg, falha.message);
      botao.disabled = false;
    }
  },
    el("label", {}, "Nova senha (mínimo de 8 caracteres)", senha),
    el("label", {}, "Repita a nova senha", repetir),
    msg,
    botao,
    el("button", { class: "link lk", type: "button", id: "lg-voltar", onclick: () => irPara("esqueci") }, "Pedir um novo link"),
  ));
}

function topo() {
  const { atendente, modo } = estado.eu;
  const ativos = estado.eu.canais.filter((c) => c.ativo);
  const conectados = ativos.filter((c) => c.status === "conectado").length;
  const conexao =
    modo === "simulador" ? "Modo simulador"
    : ativos.length === 0 ? "Nenhum número de WhatsApp"
    : ativos.length === 1 ? (conectados ? "WhatsApp conectado" : "WhatsApp desconectado")
    : `${conectados} de ${ativos.length} números conectados`;
  const abas = [["atendimentos", "Atendimentos"]];
  if (atendente.admin) abas.push(["atendentes", "Atendentes"], ["whatsapp", "WhatsApp"], ["backup", "Backup"]);
  return el("header", { class: "topo" },
    logo("barra"),
    el("span", { class: "marca" }, "Central de Atendimento"),
    el("nav", {}, abas.map(([id, nome]) =>
      el("button", {
        "aria-current": estado.aba === id ? "page" : null,
        onclick: () => { estado.aba = id; atualizar(); },
      }, nome))),
    el("span", { class: `chip ${ativos.length && conectados === ativos.length ? "ok" : "aviso"}` }, conexao),
    el("span", { class: "quem" }, atendente.nome),
    el("button", { class: "sair", onclick: async () => { await api("/logout", {}); location.reload(); } }, "Sair"),
  );
}

function telaAtendimentos() {
  const admin = estado.eu.atendente.admin;
  const filtros = [["meus", "Meus"], ["todos", admin ? "Todos" : "Do meu setor"], ["resolvidos", "Resolvidos"]];

  const lista = el("aside", { class: "lista" },
    el("div", { class: "filtros" }, filtros.map(([id, nome]) =>
      el("button", {
        "aria-pressed": String(estado.escopo === id),
        onclick: () => { estado.escopo = id; atualizar(); },
      }, nome))),
    el("div", { class: "itens" },
      estado.lista.length === 0 && el("p", { class: "vazio" },
        estado.escopo === "meus" ? "Nenhum atendimento em aberto com você." : "Nenhum atendimento aqui."),
      estado.lista.map((a) =>
        el("button", {
          class: `item${a.id === estado.abertoId ? " ativo" : ""}${a.pendente ? " pendente" : ""}`,
          onclick: () => { estado.abertoId = a.id; atualizar(); },
        },
          el("div", { class: "linha" },
            el("span", { class: "chat" }, a.chat_nome || "Contato sem nome"),
            el("span", { class: "hora" }, quando(a.atualizado_em))),
          el("div", { class: "resumo" }, a.resumo || a.ultima_mensagem || ""),
          el("div", { class: "chips" }, chipsDoAtendimento(a)),
        )),
    ),
  );

  return el("main", { class: `corpo${estado.aberto ? " aberto" : ""}` }, lista, conversa());
}

/** Foto, áudio, vídeo ou documento de uma mensagem, aberto pelo próprio painel. */
function anexo(m) {
  if (!m.arquivo_nome) return null;
  const tamanho = m.arquivo_tamanho >= 1048576
    ? `${(m.arquivo_tamanho / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(m.arquivo_tamanho / 1024))} KB`;
  if (!m.arquivo_disponivel) return el("span", { class: "anexo indisponivel" }, `${m.arquivo_nome} (arquivo não está mais disponível)`);
  const url = `/api/arquivos/${m.id}`;
  const abrir = el("a", { class: "anexo-link", href: url, target: "_blank", rel: "noopener" }, `Abrir ${m.arquivo_nome}`, el("small", {}, ` · ${tamanho}`));
  if (m.arquivo_mostra && m.arquivo_mime.startsWith("image/")) {
    return el("span", { class: "anexo" },
      el("a", { href: url, target: "_blank", rel: "noopener" }, el("img", { src: url, alt: `Imagem enviada por ${m.autor_nome}`, loading: "lazy" })), abrir);
  }
  if (m.arquivo_mostra && m.arquivo_mime.startsWith("audio/")) return el("span", { class: "anexo" }, el("audio", { controls: true, preload: "none", src: url }), abrir);
  if (m.arquivo_mostra && m.arquivo_mime.startsWith("video/")) return el("span", { class: "anexo" }, el("video", { controls: true, preload: "metadata", src: url }), abrir);
  return el("span", { class: "anexo" }, abrir);
}

function conversa() {
  if (!estado.aberto) {
    return el("section", { class: "conversa" }, el("p", { class: "vazio" }, "Selecione um atendimento para ver a conversa."));
  }
  const { atendimento: a, mensagens } = estado.aberto;
  const { atendente, setores, colegas } = estado.eu;
  const resolvido = a.status === "resolvido";

  // Transferência: escolher setor e, opcionalmente, o colega.
  const seletor = el("select", { "aria-label": "Transferir para" },
    el("option", { value: "" }, "Transferir para…"),
    setores.map((s) => el("optgroup", { label: s.nome },
      el("option", { value: `${s.id}|` }, `${s.nome} (distribuir)`),
      colegas.filter((c) => c.setores.includes(s.id) && c.canais.includes(a.canal_id)).map((c) => el("option", { value: `${s.id}|${c.id}` }, c.nome)),
    )),
  );
  seletor.addEventListener("change", () => {
    if (!seletor.value) return;
    const [setorId, atendenteId] = seletor.value.split("|");
    acao("transferir", { setor_id: setorId, atendente_id: atendenteId ? Number(atendenteId) : null });
  });

  const caixaMensagens = el("div", { class: "mensagens" }, mensagens.map((m) =>
    el("div", { class: `msg ${m.direcao}` },
      el("span", { class: "autor" }, m.direcao === "saida" ? m.atendente_nome || m.autor_nome : m.autor_nome),
      anexo(m),
      m.texto,
      el("span", { class: "quando" }, quando(m.criado_em)),
    )));

  const texto = el("textarea", {
    placeholder: `Responder em "${a.chat_nome}"…`,
    "aria-label": "Resposta",
    rows: 2,
    value: estado.rascunhos.get(a.id) || "",
    oninput: () => estado.rascunhos.set(a.id, texto.value),
    onkeydown: (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar(); },
  });
  const botaoEnviar = el("button", { class: "primario", onclick: () => enviar() }, "Enviar");
  async function enviar() {
    if (!texto.value.trim()) return;
    botaoEnviar.disabled = true;
    try {
      await api(`/atendimentos/${a.id}/responder`, { texto: texto.value });
      estado.rascunhos.delete(a.id);
      await atualizar();
    } catch (erro) {
      alert(erro.message);
      botaoEnviar.disabled = false;
    }
  }

  const secao = el("section", { class: "conversa" },
    el("div", { class: "cabecalho" },
      el("button", { class: "voltar", onclick: () => { estado.abertoId = null; atualizar(); } }, "← Voltar"),
      el("h2", {}, a.chat_nome || "Contato sem nome"),
      el("p", { class: "resumo" }, a.resumo),
      a.motivo && el("p", { class: "motivo" }, `Triagem: ${a.motivo}`),
      el("div", { class: "chips" }, chipsDoAtendimento(a)),
      el("div", { class: "acoes" },
        !resolvido && a.atendente_id !== atendente.id && el("button", { onclick: () => acao("assumir") }, "Assumir"),
        !resolvido && seletor,
        resolvido
          ? el("button", { onclick: () => acao("reabrir") }, "Reabrir")
          : el("button", { onclick: () => acao("resolver") }, "Marcar como resolvido"),
      ),
    ),
    caixaMensagens,
    !resolvido && el("div", { class: "responder" }, texto, botaoEnviar),
  );
  queueMicrotask(() => (caixaMensagens.scrollTop = caixaMensagens.scrollHeight));
  return secao;
}

function telaAtendentes() {
  const { setores, canais } = estado.eu;
  const nomeCanal = (id) => canais.find((c) => c.id === id)?.nome || id;
  const nomeSetor = (id) => setores.find((s) => s.id === id)?.nome || id;

  function formulario(existente) {
    const erro = el("div", { class: "erro", role: "alert" });
    const nome = el("input", { id: "f-nome", value: existente?.nome || "", required: true });
    const email = el("input", { id: "f-email", type: "email", value: existente?.email || "", required: true, autocomplete: "off" });
    const caixasCanais = canais.map((c) => el("input", { type: "checkbox", value: c.id, checked: !!existente?.canais.includes(c.id) }));
    const senha = el("input", { id: "f-senha", type: "password", autocomplete: "new-password", required: !existente, minLength: 8 });
    const caixas = setores.map((s) => el("input", { type: "checkbox", value: s.id, checked: !!existente?.setores.includes(s.id) }));
    const admin = el("input", { type: "checkbox", checked: !!existente?.admin });
    const ativo = el("input", { type: "checkbox", checked: existente ? existente.ativo : true });

    return el("form", {
      class: "cartao",
      onsubmit: async (e) => {
        e.preventDefault();
        const corpo = {
          nome: nome.value,
          email: email.value,
          canais: caixasCanais.filter((c) => c.checked).map((c) => Number(c.value)),
          setores: caixas.filter((c) => c.checked).map((c) => c.value),
          admin: admin.checked,
          ativo: ativo.checked,
        };
        if (senha.value) corpo.senha = senha.value;
        try {
          if (existente) await api(`/atendentes/${existente.id}`, corpo, "PUT");
          else await api("/atendentes", corpo);
          estado.editando = undefined;
          estado.eu = await api("/eu");
          await atualizar();
        } catch (falha) {
          erro.textContent = falha.message;
        }
      },
    },
      el("h3", {}, existente ? `Editar ${existente.nome}` : "Novo atendente"),
      el("div", { class: "grade" },
        el("div", { class: "campo" }, el("label", { for: "f-nome" }, "Nome (aparece na assinatura das respostas)"), nome),
        el("div", { class: "campo" }, el("label", { for: "f-email" }, "E-mail (usado para entrar no painel)"), email),
        el("div", { class: "campo" }, el("label", { for: "f-senha" }, existente ? "Nova senha (deixe em branco para manter)" : "Senha (mínimo de 8 caracteres)"), senha),
      ),
      el("div", { class: "campo" }, el("label", {}, "Setores que atende"),
        el("div", { class: "marcar" }, setores.map((s, i) => el("label", {}, caixas[i], s.nome)))),
      el("div", { class: "campo" }, el("label", {}, "Números de WhatsApp a que tem acesso"),
        el("div", { class: "marcar" }, canais.map((c, i) => el("label", {}, caixasCanais[i], c.ativo ? c.nome : `${c.nome} (desativado)`)))),
      el("p", { class: "dica" }, "O atendente só vê um atendimento quando tem acesso ao número por onde ele chegou e ao setor para onde foi encaminhado."),
      el("div", { class: "campo marcar" },
        el("label", {}, admin, "Administrador (vê todos os setores e números e gerencia a central)"),
        el("label", {}, ativo, "Ativo")),
      erro,
      el("div", { class: "acoes" },
        el("button", { class: "primario", type: "submit" }, "Salvar"),
        el("button", { type: "button", onclick: () => { estado.editando = undefined; desenhar(); } }, "Cancelar")),
    );
  }

  return el("main", { class: "pagina" },
    el("div", { class: "cartao" },
      el("h2", {}, "Atendentes"),
      el("div", { class: "tabela" }, el("table", {},
        el("thead", {}, el("tr", {}, ["Nome", "E-mail", "Setores", "Números", "Situação", ""].map((t) => el("th", {}, t)))),
        el("tbody", {}, estado.atendentes.map((t) => el("tr", {},
          el("td", {}, t.nome, t.admin && el("span", { class: "chip setor", style: "margin-left:6px" }, "Admin")),
          el("td", {}, t.email),
          el("td", {}, t.admin ? "Todos" : t.setores.map(nomeSetor).join(", ") || "—"),
          el("td", {}, t.admin ? "Todos" : t.canais.map(nomeCanal).join(", ") || "—"),
          el("td", {}, el("span", { class: `chip ${t.ativo ? "ok" : "neutro"}` }, t.ativo ? "Ativo" : "Inativo")),
          el("td", {}, el("button", { onclick: () => { estado.editando = t; desenhar(); } }, "Editar")),
        ))),
      )),
      estado.editando === undefined &&
        el("div", { class: "acoes", style: "margin-top:14px" },
          el("button", { class: "primario", onclick: () => { estado.editando = null; desenhar(); } }, "Novo atendente")),
    ),
    estado.editando !== undefined && formulario(estado.editando),
  );
}

function telaWhatsapp() {
  const simulador = estado.eu.modo === "simulador";

  /** Executa uma ação de administração dos números e atualiza a tela. */
  async function administrar(caminho, corpo, metodo) {
    try {
      await api(caminho, corpo, metodo);
      estado.eu = await api("/eu");
      await atualizar();
    } catch (erro) {
      alert(erro.message);
    }
  }
  const pedirNome = (atual) => (prompt("Nome deste número (ex.: WhatsApp 1, Clientes Simples Nacional):", atual || "") || "").trim();

  function cartaoDoCanal(c) {
    const conectado = c.status === "conectado";
    return el("div", { class: "cartao" },
      el("div", { class: "linha-canal" },
        el("h3", {}, c.nome),
        el("span", { class: `chip ${conectado ? "ok" : c.ativo ? "aviso" : "neutro"}` }, simulador && c.ativo ? "Simulado" : ROTULO_CONEXAO[c.status]),
        c.numero && el("span", { class: "numero" }, `+${c.numero}`)),
      !simulador && c.status === "aguardando_qr" && c.qr && el("div", {},
        el("p", {}, "No celular deste número, abra o WhatsApp, toque em Configurações › Aparelhos conectados › Conectar um aparelho e leia o código:"),
        el("img", { class: "qr", src: c.qr, alt: `QR code para conectar ${c.nome}`, width: 280, height: 280 }),
        el("p", { class: "dica" }, "O código muda a cada poucos segundos; esta página se atualiza sozinha.")),
      !simulador && c.ativo && c.status === "desconectado" && el("p", {}, "Tentando conectar. Se continuar assim, verifique a internet do servidor."),
      !c.ativo && el("p", { class: "dica" }, "Número desativado: não recebe nem envia mensagens. O histórico de atendimentos continua disponível."),
      el("div", { class: "acoes" },
        el("button", { onclick: () => { const nome = pedirNome(c.nome); if (nome) administrar(`/canais/${c.id}`, { nome }, "PUT"); } }, "Renomear"),
        !simulador && c.ativo && el("button", {
          onclick: () => confirm(`Desvincular o aparelho de "${c.nome}"? Será preciso ler um novo QR code.`) && administrar(`/canais/${c.id}/desvincular`, {}),
        }, conectado ? "Trocar de aparelho" : "Gerar novo QR code"),
        c.ativo
          ? el("button", { onclick: () => confirm(`Desativar "${c.nome}"? Ele deixa de receber e enviar mensagens.`) && administrar(`/canais/${c.id}`, { ativo: false }, "PUT") }, "Desativar")
          : el("button", { onclick: () => administrar(`/canais/${c.id}`, { ativo: true }, "PUT") }, "Reativar"),
      ),
    );
  }

  function formularioSimulador() {
    const ativos = estado.canais.filter((c) => c.ativo);
    const erro = el("div", { class: "erro", role: "alert" });
    const canal = el("select", { id: "s-canal" }, ativos.map((c) => el("option", { value: c.id }, c.nome)));
    const grupo = el("input", { id: "s-grupo", value: "Padaria Pão Quente x Expo", required: true });
    const autor = el("input", { id: "s-autor", value: "Marcos (Padaria)", required: true });
    const texto = el("textarea", { id: "s-texto", rows: 3 });
    const arquivo = el("input", { id: "s-arquivo", type: "file" });
    const lerArquivo = (f) => new Promise((ok, falha) => {
      const leitor = new FileReader();
      leitor.onload = () => ok({ nome: f.name, mime: f.type, base64: String(leitor.result).split(",")[1] });
      leitor.onerror = () => falha(new Error("Não foi possível ler o arquivo."));
      leitor.readAsDataURL(f);
    });
    return el("form", {
      class: "cartao",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const f = arquivo.files[0];
          if (f && f.size > 8 * 1048576) throw new Error("No simulador, use um arquivo de até 8 MB.");
          await api("/simulador/mensagem", { canalId: Number(canal.value), chatNome: grupo.value, autorNome: autor.value, texto: texto.value, arquivo: f ? await lerArquivo(f) : null });
          arquivo.value = "";
          texto.value = "";
          erro.textContent = "Mensagem simulada. Ela aparece em Atendimentos após a triagem.";
        } catch (falha) {
          erro.textContent = falha.message;
        }
      },
    },
      el("h3", {}, "Simular mensagem de cliente"),
      el("p", { class: "dica" }, "A central está em modo simulador: nada é enviado ou recebido pelo WhatsApp de verdade."),
      el("div", { class: "grade" },
        el("div", { class: "campo" }, el("label", { for: "s-canal" }, "Chega pelo número"), canal),
        el("div", { class: "campo" }, el("label", { for: "s-grupo" }, "Grupo"), grupo),
        el("div", { class: "campo" }, el("label", { for: "s-autor" }, "Quem escreve"), autor)),
      el("div", { class: "campo" }, el("label", { for: "s-texto" }, "Mensagem"), texto),
      el("div", { class: "campo" }, el("label", { for: "s-arquivo" }, "Arquivo (opcional): foto, PDF, áudio ou vídeo"), arquivo),
      erro,
      el("button", { class: "primario", type: "submit" }, "Simular recebimento"),
    );
  }

  return el("main", { class: "pagina" },
    el("div", { class: "cartao" },
      el("h2", {}, "Números de WhatsApp"),
      el("p", {}, "Cada número tem a sua própria conexão. Em Atendentes, você escolhe quem tem acesso a cada um."),
      el("button", { class: "primario", onclick: () => { const nome = pedirNome(); if (nome) administrar("/canais", { nome }); } }, "Adicionar número")),
    estado.canais.map(cartaoDoCanal),
    simulador && formularioSimulador(),
  );
}

function telaBackup() {
  const b = estado.backup || {};
  const u = b.ultimo;
  const quando = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const botao = el("button", {
    class: "primario",
    onclick: async () => {
      botao.disabled = true;
      botao.textContent = "Fazendo backup…";
      try {
        await api("/backup/agora", {});
      } catch (erro) {
        alert(erro.message);
      }
      estado.backup = await api("/backup");
      desenhar();
    },
  }, "Fazer backup agora");
  return el("main", { class: "pagina" },
    el("div", { class: "cartao" },
      el("h2", {}, "Backup das mensagens"),
      el("p", {}, `Todos os dias, às ${(b.horarios || []).join(", ")} (horário de Brasília), a central grava no Google Drive, na pasta "Central de Atendimento WhatsApp › Backups":`),
      el("ul", {},
        el("li", {}, "uma planilha com as mensagens de cada dia (mensagens-AAAA-MM-DD.csv), atualizada a cada backup;"),
        el("li", {}, `uma cópia completa do banco (banco-AAAA-MM-DD-HHMM.db.gz), guardada por ${b.retencaoDias || 30} dias, para restaurar a central se precisar.`)),
      !b.configurado && el("p", { class: "faixa-aviso" }, "O envio ao Google Drive ainda não foi configurado (BACKUP_URL e BACKUP_SEGREDO). Enquanto isso, as cópias ficam só no servidor."),
      el("div", { class: "acoes" }, botao)),
    el("div", { class: "cartao" },
      el("h3", {}, "Último backup"),
      !u ? el("p", { class: "dica" }, "Nenhum backup feito ainda.") : el("div", {},
        el("p", {},
          el("span", { class: `chip ${u.ok ? "ok" : "alta"}` }, u.ok ? "Concluído" : "Com problema"), " ",
          `${quando(u.quando)} · ${u.motivo}` + (u.mensagensHoje != null ? ` · ${u.mensagensHoje} ${u.mensagensHoje === 1 ? "mensagem" : "mensagens"} hoje` : "") + (u.tamanhoBanco ? ` · banco com ${kb(u.tamanhoBanco)}` : "")),
        u.erro && el("p", { class: "erro" }, u.erro),
        u.arquivos?.length > 0 && el("ul", {}, u.arquivos.map((a) =>
          el("li", {}, a.url ? el("a", { href: a.url, target: "_blank", rel: "noopener" }, a.nome) : a.nome))))),
  );
}

function desenhar() {
  // Preserva o foco/texto do campo de resposta quando a tela é refeita por um evento.
  const ativo = document.activeElement;
  const focoNaResposta = ativo?.matches?.(".responder textarea");
  const cursor = focoNaResposta ? ativo.selectionStart : null;
  const rolagemLista = raiz.querySelector(".itens")?.scrollTop;

  if (!estado.eu) {
    const telasDeAcesso = { entrar: telaLogin, esqueci: telaEsqueci, redefinir: telaRedefinir };
    return raiz.replaceChildren(telasDeAcesso[estado.acesso]());
  }

  const telas = { atendimentos: telaAtendimentos, atendentes: telaAtendentes, whatsapp: telaWhatsapp, backup: telaBackup };
  raiz.replaceChildren(el("div", { class: "tela" },
    topo(),
    !estado.eu.iaAtiva && el("div", { class: "faixa" }, "Triagem por IA desligada (chave da API não configurada): todas as mensagens vão para o setor padrão."),
    telas[estado.aba](),
  ));

  if (rolagemLista) raiz.querySelector(".itens")?.scrollTo(0, rolagemLista);
  if (focoNaResposta) {
    const novo = raiz.querySelector(".responder textarea");
    novo?.focus();
    novo?.setSelectionRange(cursor, cursor);
  }
}

// O QR code expira rápido: enquanto a aba WhatsApp estiver aberta, busca o estado periodicamente.
setInterval(() => {
  if (estado.eu && estado.aba === "whatsapp" && estado.eu.modo !== "simulador") atualizar();
}, 5000);

fetch("/api/marca")
  .then((r) => r.json())
  .then((dados) => {
    marca = dados;
    document.title = `Central de Atendimento · ${marca.nome}`;
  })
  .catch(() => {})
  .finally(iniciar);
