---
name: configurar-a-partir-de-reel
description: Use quando o usuário mandar um link de reel/post do Instagram (ou outro vídeo curto) pedindo para "ler e fazer as configurações" ou "analisar a ferramenta" mostrada. Descobre a ferramenta, avalia se vale a pena e aplica a configuração no repositório e no Claude Code, parando em cada ponto de decisão.
---

# Configurar a partir de um reel do Instagram

## Preferências do usuário (sempre)
- Responder em português do Brasil, em linguagem simples (o usuário não é desenvolvedor).
- **Parar em cada ponto de decisão** e apresentar opções numeradas (1, 2, 3), com uma recomendada. O usuário responde só com o número.
- Quando o usuário disser que não consegue ler, entregar também em **áudio com voz feminina** (skill `audio-resumo-pt`).
- Mesclar pull requests só quando o usuário pedir ("pode mesclar"). Ele prefere poucas mesclagens (uma por dia ou quando houver muita coisa).

## Passo 1: ler o conteúdo do reel
O Claude não assiste vídeos. Para ler a legenda:
1. `WebFetch` em `https://www.instagram.com/reel/<ID>/embed/captioned/` (funciona melhor que a URL normal, que costuma voltar vazia).
2. Se só houver o nome da ferramenta, pesquisar com `WebSearch` (`"<ferramenta>" Claude Code GitHub install`).
3. Confirmar o repositório oficial no GitHub (estrelas, licença, comandos de instalação). Há muitos projetos com nomes iguais; avisar o usuário quando a identificação vier só do nome.
4. Posts que dizem "comente X para receber o link" não trazem os comandos; buscar no repositório oficial.

## Passo 2: avaliar antes de instalar
- Verificar o tamanho do repositório. O `exame-contabilidade` é um site estático de um único `index.html`, publicado direto do repositório (`.nojekyll` + `CNAME`), então **arquivos de configuração commitados ficam acessíveis publicamente** pelo endereço do site. Nunca commitar dados sensíveis ou nomes de clientes ali.
- Ferramentas de "mapa do código" (Graft, Understand Anything) quase não ajudam num repositório de uma página. Dizer isso e recomendar, mas deixar o usuário decidir.
- Ver se a ferramenta repete algo já instalado (skill `ferramentas-mapa-de-codigo`).

## Passo 3: aplicar (depois da autorização)
- Sempre rodar primeiro com `--dry-run` (ou equivalente) e mostrar o que será escrito.
- Desligar telemetria quando a ferramenta tiver (ex.: `graft telemetry disable`).
- Preferir modo de time/projeto (arquivos no repositório) e `--no-global`, porque a pasta `~/.claude` da sessão na nuvem é descartada.
- Revisar as permissões automáticas que a ferramenta adiciona em `.claude/settings.json` e remover as desnecessárias.
- Commitar no branch de trabalho, fazer push e abrir pull request só quando o usuário pedir.
- Para que a ferramenta funcione em sessões novas na nuvem, ela precisa ser instalada pelo script de setup do ambiente (já existe o ambiente "exame-contabilidade" que instala o Graft).

## Bloqueios já vistos
- `yt-dlp` para baixar o vídeo foi negado pelas permissões da sessão; não insistir.
- Instalação global via npm pode ser negada até o usuário autorizar explicitamente naquela conversa.
- Tarefas agendadas criadas pela sessão não recebem o repositório anexado e falham com HTTP 403 no GitHub; o usuário precisa adicionar o repositório como fonte pela interface do claude.ai/code.
