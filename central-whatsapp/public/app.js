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
  atendentes: [],
  whatsapp: null,
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
const ROTULO_WHATSAPP = { conectado: "WhatsApp conectado", aguardando_qr: "WhatsApp: ler QR code", desconectado: "WhatsApp desconectado" };

function chipsDoAtendimento(a) {
  return [
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
  if (estado.aba === "whatsapp") estado.whatsapp = await api("/whatsapp");
  desenhar();
}

async function iniciar() {
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
    if (evento.whatsapp) estado.eu.whatsapp.status = evento.whatsapp;
    // Não refaz a tela enquanto alguém preenche um formulário da administração.
    const preenchendo = estado.aba === "atendentes" || (estado.aba === "whatsapp" && estado.eu.whatsapp.modo === "simulador");
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
function telaLogin() {
  const erro = el("div", { class: "erro", role: "alert" });
  const usuario = el("input", { id: "usuario", autocomplete: "username", required: true });
  const senha = el("input", { id: "senha", type: "password", autocomplete: "current-password", required: true });
  const botao = el("button", { class: "primario", type: "submit" }, "Entrar");
  return el("div", { class: "login" },
    el("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        botao.disabled = true;
        try {
          await api("/login", { usuario: usuario.value, senha: senha.value });
          await iniciar();
        } catch (falha) {
          erro.textContent = falha.message;
          botao.disabled = false;
        }
      },
    },
      el("h1", {}, "Central de Atendimento"),
      el("p", {}, "Exame Contabilidade e Consultoria"),
      el("div", { class: "campo" }, el("label", { for: "usuario" }, "Usuário"), usuario),
      el("div", { class: "campo" }, el("label", { for: "senha" }, "Senha"), senha),
      erro,
      botao,
    ),
  );
}

function topo() {
  const { atendente, whatsapp } = estado.eu;
  const abas = [["atendimentos", "Atendimentos"]];
  if (atendente.admin) abas.push(["atendentes", "Atendentes"], ["whatsapp", "WhatsApp"]);
  return el("header", { class: "topo" },
    el("span", { class: "marca" }, "Central de Atendimento"),
    el("nav", {}, abas.map(([id, nome]) =>
      el("button", {
        "aria-current": estado.aba === id ? "page" : null,
        onclick: () => { estado.aba = id; atualizar(); },
      }, nome))),
    el("span", { class: `chip ${whatsapp.status === "conectado" ? "ok" : "aviso"}` },
      whatsapp.modo === "simulador" ? "Modo simulador" : ROTULO_WHATSAPP[whatsapp.status]),
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
      colegas.filter((c) => c.setores.includes(s.id)).map((c) => el("option", { value: `${s.id}|${c.id}` }, c.nome)),
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
  const { setores } = estado.eu;
  const nomeSetor = (id) => setores.find((s) => s.id === id)?.nome || id;

  function formulario(existente) {
    const erro = el("div", { class: "erro", role: "alert" });
    const nome = el("input", { id: "f-nome", value: existente?.nome || "", required: true });
    const usuario = el("input", { id: "f-usuario", value: existente?.usuario || "", disabled: !!existente, required: true, autocomplete: "off" });
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
          setores: caixas.filter((c) => c.checked).map((c) => c.value),
          admin: admin.checked,
          ativo: ativo.checked,
        };
        if (senha.value) corpo.senha = senha.value;
        try {
          if (existente) await api(`/atendentes/${existente.id}`, corpo, "PUT");
          else await api("/atendentes", { ...corpo, usuario: usuario.value });
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
        el("div", { class: "campo" }, el("label", { for: "f-usuario" }, "Usuário de acesso"), usuario),
        el("div", { class: "campo" }, el("label", { for: "f-senha" }, existente ? "Nova senha (deixe em branco para manter)" : "Senha (mínimo de 8 caracteres)"), senha),
      ),
      el("div", { class: "campo" }, el("label", {}, "Setores que atende"),
        el("div", { class: "marcar" }, setores.map((s, i) => el("label", {}, caixas[i], s.nome)))),
      el("div", { class: "campo marcar" },
        el("label", {}, admin, "Administrador (vê todos os setores e gerencia atendentes)"),
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
        el("thead", {}, el("tr", {}, ["Nome", "Usuário", "Setores", "Situação", ""].map((t) => el("th", {}, t)))),
        el("tbody", {}, estado.atendentes.map((t) => el("tr", {},
          el("td", {}, t.nome, t.admin && el("span", { class: "chip setor", style: "margin-left:6px" }, "Admin")),
          el("td", {}, t.usuario),
          el("td", {}, t.setores.map(nomeSetor).join(", ") || "—"),
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
  const w = estado.whatsapp || {};
  const blocos = [el("h2", {}, "Conexão com o WhatsApp")];

  if (w.modo === "simulador") {
    const erro = el("div", { class: "erro", role: "alert" });
    const grupo = el("input", { id: "s-grupo", value: "Padaria Pão Quente x Exame", required: true });
    const autor = el("input", { id: "s-autor", value: "Marcos (Padaria)", required: true });
    const texto = el("textarea", { id: "s-texto", rows: 3, required: true });
    blocos.push(
      el("p", {}, "A central está em modo simulador: nada é enviado ou recebido pelo WhatsApp de verdade. Use o formulário para simular a mensagem de um cliente e ver a triagem funcionando."),
      el("form", {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await api("/simulador/mensagem", { chatNome: grupo.value, autorNome: autor.value, texto: texto.value });
            texto.value = "";
            erro.textContent = "Mensagem simulada. Ela aparece em Atendimentos após a triagem.";
          } catch (falha) {
            erro.textContent = falha.message;
          }
        },
      },
        el("div", { class: "grade" },
          el("div", { class: "campo" }, el("label", { for: "s-grupo" }, "Grupo"), grupo),
          el("div", { class: "campo" }, el("label", { for: "s-autor" }, "Quem escreve"), autor)),
        el("div", { class: "campo" }, el("label", { for: "s-texto" }, "Mensagem"), texto),
        erro,
        el("button", { class: "primario", type: "submit" }, "Simular recebimento"),
      ),
    );
  } else if (w.status === "conectado") {
    blocos.push(el("p", {}, el("span", { class: "chip ok" }, "Conectado"), " O número do escritório está recebendo mensagens."));
  } else if (w.status === "aguardando_qr" && w.qr) {
    blocos.push(
      el("p", {}, "No celular do escritório, abra o WhatsApp, toque em Aparelhos conectados › Conectar um aparelho e leia o código:"),
      el("img", { class: "qr", src: w.qr, alt: "QR code para conectar o WhatsApp", width: 320, height: 320 }),
      el("p", {}, "O código muda a cada poucos segundos; esta página se atualiza sozinha."),
    );
  } else {
    blocos.push(el("p", {}, el("span", { class: "chip aviso" }, "Desconectado"), " Tentando reconectar. Se continuar assim, verifique a internet do servidor."));
  }
  return el("main", { class: "pagina" }, el("div", { class: "cartao" }, blocos));
}

function desenhar() {
  // Preserva o foco/texto do campo de resposta quando a tela é refeita por um evento.
  const ativo = document.activeElement;
  const focoNaResposta = ativo?.matches?.(".responder textarea");
  const cursor = focoNaResposta ? ativo.selectionStart : null;
  const rolagemLista = raiz.querySelector(".itens")?.scrollTop;

  if (!estado.eu) return raiz.replaceChildren(telaLogin());

  const telas = { atendimentos: telaAtendimentos, atendentes: telaAtendentes, whatsapp: telaWhatsapp };
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
  if (estado.eu && estado.aba === "whatsapp" && estado.whatsapp?.modo !== "simulador") atualizar();
}, 5000);

iniciar();
