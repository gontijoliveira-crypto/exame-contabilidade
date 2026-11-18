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

## Acesso dos atendentes (login por e-mail)

1. No primeiro início, a central cria o administrador com o e-mail de `ADMIN_EMAIL` e a senha de
   `ADMIN_SENHA` (se ela ficar vazia, uma senha é gerada e mostrada uma única vez no terminal).
2. O administrador entra no painel com esse e-mail, abre **Atendentes** › **Novo atendente** e informa
   nome, e-mail, senha inicial, os **setores** que a pessoa atende e os **números de WhatsApp** a que
   ela tem acesso.
3. O atendente entra no painel com o próprio e-mail e senha.
4. Ele só vê um atendimento quando tem acesso **ao número** por onde a mensagem chegou **e ao setor**
   para onde a IA a encaminhou. O administrador vê tudo.
5. Sessão de 12 horas; 5 senhas erradas bloqueiam o e-mail por 15 minutos. Desativar um atendente
   encerra as sessões dele na hora. Troca de senha é feita pelo administrador.

## Vários números de WhatsApp

Cada número (por exemplo "WhatsApp 1" para uma carteira de clientes e "WhatsApp 2" para outra) tem a
própria conexão e o próprio QR code, e as conversas de cada um ficam separadas: um mesmo grupo com os
dois números gera atendimentos independentes, e a resposta sempre sai pelo número por onde a mensagem
chegou. Atendimentos novos só são distribuídos a atendentes que têm acesso àquele número.

Na aba **WhatsApp** do painel, o administrador:

- **Adicionar número**: cria o número e mostra o QR code para vincular.
- **Renomear**: muda o nome mostrado no painel.
- **Trocar de aparelho / Gerar novo QR code**: desvincula o celular atual e mostra um QR novo.
- **Desativar / Reativar**: o número para de receber e enviar, mas o histórico continua disponível.

### Passo a passo para vincular um número

1. Deixe o WhatsApp (de preferência o WhatsApp Business) funcionando no celular desse número.
2. No painel, aba **WhatsApp**, clique em **Adicionar número** e dê um nome (na primeira instalação já
   existe o "WhatsApp 1").
3. No celular: WhatsApp › **Configurações** › **Aparelhos conectados** › **Conectar um aparelho**, e
   aponte a câmera para o QR code do painel. Em alguns segundos o número aparece como **Conectado**.
4. Em **Atendentes**, marque quem tem acesso a esse número.
5. Adicione o número aos grupos dos clientes daquela carteira.

O celular precisa continuar com o WhatsApp ativo e com internet de tempos em tempos; se ficar muito
tempo desligado, o WhatsApp desfaz o vínculo e é preciso ler o QR de novo. Só entram as mensagens que
chegarem depois do vínculo.

## Rodando

Requer Node.js 22.13 ou mais novo.

```bash
cd central-whatsapp
npm install
cp .env.example .env     # preencha ANTHROPIC_API_KEY, ADMIN_EMAIL e ADMIN_SENHA
npm start
```

Abra `http://localhost:3000` e entre com o e-mail e a senha do administrador.

- **Modo simulador** (`WHATSAPP_MODO=simulador`, o padrão): nada é enviado ao WhatsApp. Na aba
  **WhatsApp** do painel há um formulário para simular mensagens de clientes chegando por qualquer
  número. Use para conhecer e testar.
- **Modo real** (`WHATSAPP_MODO=baileys`): cada número mostra um QR code para vincular (veja acima).

Atualizando de uma versão anterior: o banco antigo (sem e-mail e sem vários números) é guardado ao lado
com outro nome e um banco novo é criado; cadastre os atendentes de novo. O vínculo do WhatsApp também
precisa ser refeito.

`npm test` roda os testes automatizados (usam o simulador e uma IA de mentira; não gastam créditos).

## Pontos de atenção antes de usar com clientes

- **Conexão não oficial.** Para o número poder ser adicionado a grupos comuns de clientes, a conexão
  usa a biblioteca Baileys (o protocolo do WhatsApp Web). Isso não é a API oficial da Meta e contraria
  os termos do WhatsApp: existe risco de o número ser banido. A API oficial (Cloud API) não permite
  entrar em grupos já existentes. Comece com um número que possa ser substituído e evite disparos em
  massa. Cada número adicional é mais um número exposto a esse risco. O adaptador fica isolado em `src/whatsapp/`, então dá para trocar de provedor sem mexer no resto.
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
- "Esqueci minha senha" por e-mail (hoje quem redefine é o administrador).
- Avisar o atendente fora do painel (por exemplo, no WhatsApp pessoal) quando chega algo novo.
- Horário de atendimento, mensagens automáticas, relatórios e tempo médio de resposta.
- Edição de setores pelo painel (hoje é pelo arquivo de configuração).

## Estrutura

| Caminho | Papel |
|---|---|
| `src/index.js` | Inicialização: banco, WhatsApp, IA e servidor |
| `src/central.js` | Regras: triagem, abertura e continuação de atendimentos, respostas, transferências |
| `src/classificador.js` | Chamada ao Claude e instruções da triagem |
| `src/whatsapp/` | `canais.js` (uma conexão por número), `baileys.js` (real) e `simulador.js` (testes) |
| `src/servidor.js`, `src/auth.js` | API do painel, login por e-mail e permissões por setor e número |
| `src/db.js` | Banco SQLite (arquivo único em `dados/`) |
| `public/` | Painel web dos atendentes |
| `config/setores.json` | Setores do escritório e o setor padrão |
