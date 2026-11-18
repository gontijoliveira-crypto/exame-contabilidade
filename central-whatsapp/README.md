# Central de Atendimento via WhatsApp

Um único número de WhatsApp do escritório, vários atendentes. O número participa dos grupos com os
clientes (e de conversas privadas); cada mensagem recebida é lida por uma IA, que identifica o assunto
e abre um atendimento no setor responsável. Cada atendente vê e responde, por um painel web, apenas os
atendimentos dos seus setores, e a resposta sai pelo número do escritório, assinada com nome e setor.

```
Cliente (grupo/privado) ──► WhatsApp do escritório ──► Triagem por IA (Claude)
                                                           │  setor, urgência, resumo
                                                           ▼
                            Fila do setor ──► atendente com menos atendimentos em aberto
                                                           │
Cliente ◄── resposta assinada "Ana (Fiscal):" ◄── Painel web do atendente
```

## Como funciona

1. **Recebimento.** Mensagens seguidas do mesmo chat são agrupadas por alguns segundos
   (`ESPERA_TRIAGEM_SEGUNDOS`) e triadas juntas.
2. **Triagem.** A IA recebe as mensagens novas, o histórico recente do chat e os atendimentos em
   aberto ali, e decide: abrir um atendimento **novo** em um setor, **continuar** um atendimento
   existente ou **ignorar** (saudações soltas, agradecimentos). Um mesmo grupo pode ter vários
   atendimentos em paralelo, de setores diferentes.
3. **Distribuição.** O atendimento vai para o atendente ativo do setor com menos atendimentos em
   aberto. Sem ninguém no setor, fica na fila do setor, visível ao administrador.
4. **Atendimento.** No painel, o atendente responde, assume, transfere para outro setor ou colega
   (corrigindo a IA quando ela errar) e marca como resolvido. A tela se atualiza sozinha.
5. **Se a IA falhar** ou não estiver configurada, nenhuma mensagem se perde: ela vai para o setor
   padrão (`Atendimento Geral`) para triagem manual.

Os setores e suas descrições (é por elas que a IA decide) ficam em [`config/setores.json`](config/setores.json).
Para ajustar o encaminhamento, edite as descrições e reinicie.

## Rodando

Requer Node.js 22.13 ou mais novo.

```bash
cd central-whatsapp
npm install
cp .env.example .env     # preencha ANTHROPIC_API_KEY e ADMIN_SENHA
npm start
```

Abra `http://localhost:3000` e entre com o administrador. Em **Atendentes**, cadastre a equipe e marque
os setores de cada um.

- **Modo simulador** (`WHATSAPP_MODO=simulador`, o padrão): nada é enviado ao WhatsApp. Na aba
  **WhatsApp** do painel há um formulário para simular mensagens de clientes. Use para conhecer e testar.
- **Modo real** (`WHATSAPP_MODO=baileys`): na aba **WhatsApp** aparece um QR code. Leia-o com o celular
  do escritório (Aparelhos conectados › Conectar um aparelho), como no WhatsApp Web. Depois é só
  adicionar o número aos grupos dos clientes.

`npm test` roda os testes automatizados (usam o simulador e uma IA de mentira; não gastam créditos).

## Pontos de atenção antes de usar com clientes

- **Conexão não oficial.** Para o número poder ser adicionado a grupos comuns de clientes, a conexão
  usa a biblioteca Baileys (o protocolo do WhatsApp Web). Isso não é a API oficial da Meta e contraria
  os termos do WhatsApp: existe risco de o número ser banido. A API oficial (Cloud API) não permite
  entrar em grupos já existentes. Comece com um número que possa ser substituído e evite disparos em
  massa. O adaptador fica isolado em `src/whatsapp/`, então dá para trocar de provedor sem mexer no resto.
- **Dados de clientes (LGPD).** As conversas ficam em `dados/central.db` e o texto das mensagens é
  enviado à API da Anthropic para a triagem. Avalie informar os clientes, restringir o acesso ao
  servidor e fazer backup dessa pasta. `dados/` e `.env` nunca devem ir para o repositório.
- **Acesso ao painel.** Publique sempre atrás de HTTPS (com `NODE_ENV=production` o cookie de sessão
  exige HTTPS) e, de preferência, só na rede do escritório ou por VPN.
- **Custo da IA.** O modelo padrão é `claude-opus-5-5`. A triagem é uma tarefa simples; se o volume
  for alto, um modelo menor (`CLAUDE_MODELO=claude-haiku-5-5`) custa bem menos. Vale testar a qualidade.

## O que ainda não faz

- Mídia: áudios, imagens e documentos aparecem como marcadores (`[áudio]`, `[documento: nota.pdf]`);
  o arquivo em si não é baixado nem transcrito, e o painel só envia texto.
- Avisar o atendente fora do painel (por exemplo, no WhatsApp pessoal) quando chega algo novo.
- Horário de atendimento, mensagens automáticas, relatórios e tempo médio de resposta.
- Edição de setores pelo painel (hoje é pelo arquivo de configuração).

## Estrutura

| Caminho | Papel |
|---|---|
| `src/index.js` | Inicialização: banco, WhatsApp, IA e servidor |
| `src/central.js` | Regras: triagem, abertura e continuação de atendimentos, respostas, transferências |
| `src/classificador.js` | Chamada ao Claude e instruções da triagem |
| `src/whatsapp/` | Adaptadores: `baileys.js` (real) e `simulador.js` (testes) |
| `src/servidor.js`, `src/auth.js` | API do painel, login e permissões por setor |
| `src/db.js` | Banco SQLite (arquivo único em `dados/`) |
| `public/` | Painel web dos atendentes |
| `config/setores.json` | Setores do escritório e o setor padrão |
