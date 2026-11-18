---
name: ferramentas-mapa-de-codigo
description: Use quando o assunto for Graft/Trail-code, Understand Anything ou outra ferramenta que "mapeia o projeto" para o Claude Code; quando o usuário perguntar o que já está instalado, o que cada uma faz, prós e contras, ou sobre a tarefa diária de mesclagem.
---

# Ferramentas de mapa de código: o que já foi decidido

## Estado atual (novembro de 2026)
- **Graft (`@nanonets/graft`, agora Trail-code)** está configurado neste repositório (mesclado no `main` pelo PR #1): `.mcp.json`, `.claude/settings.json` (hooks, statusline), `.claude/helpers/`, `.claude/skills/graft/`, `.gitignore`, `.ignore`. Telemetria desligada. O mapa sai com 0 nós porque só existe o `index.html`. `graft upgrade` adiciona o comando `trail`.
- **Ambiente de nuvem "exame-contabilidade"** (pessoal): o script de setup instala o Graft e desliga a telemetria. Rede limitada (gerenciadores de pacotes e conectores). Não tem as variáveis do Google do ambiente "Default".
- **Tarefa agendada "Mesclagem diária exame-contabilidade"** (18h47, horário de Brasília): **pausada**. O teste falhou com HTTP 403 porque a tarefa não tem o repositório anexado. Para reativar, o usuário adiciona o repositório como fonte em claude.ai/code e liga a tarefa. Custo estimado: cerca de US$ 0,17 por execução.
- **Understand Anything**: analisado, **não instalado**. Recomendação: não usar neste site; testar no Claude Code do computador do usuário, em um único projeto maior (painéis).

## Graft em uma frase
Cria um mapa do projeto para o **Claude** consultar antes de trabalhar, gastando menos passos e tokens. Benefício só aparece em projetos com bastante código. Os números de ganho divulgados vêm do próprio fabricante.

## Understand Anything: análise
Plugin gratuito (MIT, ~93 mil estrelas), repositório oficial `Egonex-AI/Understand-Anything`.

Instalação no Claude Code:
```
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```
Comandos: `/understand-anything:understand` (analisa e gera `.ua/knowledge-graph.json`) e `/understand-anything:dashboard` (painel local em `http://127.0.0.1:8888`).

**Benefícios:** visão geral da arquitetura numa tela; tour guiado; prévia do impacto antes de alterar; ajuda o usuário a entender e manter o que o Claude construiu; atualizações incrementais baratas.

**Problemas e como contornar:**
| Problema | Como contornar |
|---|---|
| 1ª análise cara (teste da Better Stack: ~30 min e ~200 mil tokens num projeto médio) | Começar por uma pasta; rodar uma vez |
| ~135 issues abertas, quase todas de leitura de código (TS, Python, Vue, SQL, C++) | Usar o mapa como guia, não como verdade |
| Painel imaturo (filtros, busca, layout em telas menores) | Usar em tela grande; acompanhar versões |
| Mapa é retrato do momento | Rodar de novo após mudanças grandes |
| Explicações geradas por IA podem errar em código complexo | Conferir trechos sensíveis (cálculos tributários) |
| Explicações em inglês por padrão | Escolher português na primeira execução |
| Repete o Graft | Usar um só: Understand Anything para o usuário ler, Graft para o Claude trabalhar |
| Painel não abre a partir da sessão na nuvem | Instalar no Claude Code do computador |

Fontes: github.com/Egonex-AI/Understand-Anything (README e issues), betterstack.com/community/guides/ai/understand-anything/
