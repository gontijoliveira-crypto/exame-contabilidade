# Calculadora CBS e IBS · Expo Contabilidade e Consultoria

Página pública em que qualquer pessoa informa os dados de uma operação (valor, data, município e
classificação tributária) e vê quanto incide de CBS e de IBS. A conta não é feita aqui: o servidor
consulta a **Calculadora de Tributos da Receita Federal** e mostra o resultado com a identidade visual
do escritório.

```
Visitante ──► Página da calculadora (este servidor) ──► Calculadora de Tributos (Receita Federal)
                 marca da Expo, validação,                 regras e tabelas oficiais da
                 limite de uso, memória das listas          Reforma Tributária do Consumo
```

## O que a página faz

- **Listas oficiais.** UFs, municípios, situações tributárias (CST) e classificações (cClassTrib) vêm
  da própria Receita, para a data do fato gerador escolhida.
- **Resultado.** CBS, IBS estadual e IBS municipal, com alíquota, valor e a memória de cálculo
  devolvida pela Receita. Trata alíquota reduzida, alíquota zero, isenção, diferimento e redução de
  base de cálculo.
- **2026.** Usa as alíquotas vigentes na base da Receita (CBS 0,9% e IBS 0,1%).
- **2027 a 2033.** A Receita exige que as alíquotas sejam informadas, porque ainda não estão na base
  oficial. A página pede as três alíquotas e marca o resultado como simulação. O texto de apoio e as
  alíquotas sugeridas ficam em [`config/simulacao.json`](config/simulacao.json).
- **Erros da Receita.** Quando a classificação exige NCM, NBS ou outro dado, a página mostra o motivo
  e leva o cursor ao campo.

- **Crédito na subcontratação do frete (2027 em diante).** Para a transportadora que subcontrata o
  frete da operação: informa quem fez o transporte e quanto foi pago, e a página mostra o crédito e o
  saldo (débito menos crédito) de CBS e de IBS. Veja a seção abaixo.

O que ela **não** faz: Imposto Seletivo, compras governamentais, classificações que dependem do grupo
de tributação regular (suspensão, por exemplo) e operações com vários itens. Nesses casos a mensagem
da Receita é mostrada como veio.

## Rodando

Requer Node.js 22 ou mais novo. Não há dependências para instalar.

```bash
cd calculadora-cbs
npm start
```

Abra `http://localhost:3000`. `npm test` roda os testes automatizados: eles usam respostas reais da
Receita gravadas em `test/fixtures/` e não acessam a internet.

## Publicação no Railway

A calculadora é um serviço separado da Central de Atendimento, no mesmo projeto do Railway e a partir
do mesmo repositório do GitHub. O Railway deixou de aceitar arquivo de configuração (`railway.json`)
em serviços novos, então os ajustes são feitos no painel.

1. No projeto do Railway, clique no botão de criar (**New** ou **Create**, no canto superior direito
   do quadro) e escolha **GitHub Repo** › `gontijoliveira-crypto/exame-contabilidade`.
2. Clique no serviço novo e abra **Settings**:
   - **Root Directory:** `/calculadora-cbs`
   - **Branch:** a branch onde este código está (`main`, depois do merge).
   - **Watch Paths:** `/calculadora-cbs/**` (assim, mudanças em outras pastas não republicam a calculadora).
   - **Healthcheck Path:** `/saude`
3. Em **Variables**, crie `PORT` com o valor `3000`.
4. Em **Settings** › **Networking** › **Generate Domain**. Se pedir a porta, informe `3000`.
5. Clique em **Deploy** no aviso de alterações pendentes. No registro da construção deve aparecer
   "Using detected Dockerfile!"; se não aparecer, escolha **Dockerfile** como construtor nas
   configurações de build.
6. Depois que o endereço existir, publique mais uma vez (**Redeploy**). É nessa hora que o Railway
   informa o endereço ao servidor, e ele passa a aparecer na prévia do link (WhatsApp, redes sociais).

O servidor usa cerca de 70 MB de memória e quase nada de processador quando parado. Não precisa de
volume nem de banco de dados. Não ative a opção **Serverless**: a primeira visita depois de um
período parado pode dar erro.

O `Dockerfile` serve também para Render, Fly.io ou um servidor próprio com Docker.

## Configuração

Nenhuma variável é obrigatória. Veja [`.env.example`](.env.example).

| Variável | Para que serve |
|---|---|
| `PORT` ou `PORTA` | Porta do servidor (padrão `3000`). |
| `URL_PUBLICA` | Endereço público, usado na prévia do link. No Railway é detectado sozinho; preencha se usar domínio próprio. |
| `TRUST_PROXY` | Fora do Railway: número de proxies à frente do servidor (em geral `1`), para o limite de uso valer por visitante. |
| `CABECALHO_IP` | Fora do Railway: nome do cabeçalho em que a hospedagem grava o IP do visitante. No Railway (`X-Real-IP`) é detectado sozinho. |
| `RECEITA_API` | Endereço da API da Calculadora de Tributos. Veja a seção abaixo. |

Para conter abuso, cada visitante tem até 60 cálculos e 300 consultas por minuto, até 20 trocas de data
que exijam lista nova da Receita por minuto, e no máximo 2 consultas em andamento ao mesmo tempo. Depois
de um bloqueio do firewall da Receita, o servidor passa 2 minutos sem consultá-la e usa as listas
guardadas. As listas ficam na memória do servidor (de 1 a 24 horas) e continuam valendo se a Receita
ficar fora do ar por um tempo.

## De onde vem o cálculo

Por padrão, o servidor consulta a API que a Receita mantém em
`https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api`. Ela responde sem chave e traz
sempre as tabelas mais recentes, mas é um ambiente piloto: a Receita não publica garantia de
disponibilidade nem termos de uso para ele. O manual da Receita diz que não há API pública para cálculo
online.

**Na prática, ela bloqueia quem consulta muito.** Em 18/11/2026, depois de alguns milhares de consultas
de teste a partir do mesmo servidor, o firewall da Receita passou a responder "Request Rejected" aos
cálculos (as listas continuaram funcionando). A página reconhece esse bloqueio, não insiste e mostra
"A Calculadora da Receita Federal está recusando consultas no momento". Com a calculadora pública,
todos os visitantes saem pelo mesmo endereço do servidor; se o uso crescer, o bloqueio pode voltar.

O caminho de integração que a Receita indica é o componente de código aberto, publicado em
novembro de 2026 em [github.com/ReceitaFederal/calculadora-rtc-regime-regular](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular)
(Java 21, licença MIT). Ele oferece a mesma API em `http://localhost:8080/api`. Para usá-lo, rode o
componente seguindo o README da Receita e aponte a calculadora para ele:

```bash
RECEITA_API=http://localhost:8080/api npm start
```

**Este é o caminho recomendado para uso público contínuo**: sem bloqueio por volume e sem depender do
ambiente piloto. No Railway, ele seria um terceiro serviço do projeto (Java 21, porta 8080), e a
calculadora aponta para o endereço privado dele com `RECEITA_API`.

Nesse modo os dados da operação não saem do seu servidor, mas é preciso atualizar o componente quando
a Receita publicar novas tabelas. A compatibilidade foi conferida pela leitura do código da versão
1.6.1 (mesmos caminhos, formatos e cabeçalho de aviso); os testes deste projeto foram feitos contra a
API hospedada.

## Crédito na subcontratação do frete

Disponível para fatos geradores a partir de 01/01/2027. Duas situações:

| Subcontratado | Crédito da transportadora contratante | Quem calcula |
|---|---|---|
| Transportador autônomo pessoa física, não contribuinte ou MEI | Crédito presumido do art. 169 da LC 214/2025: para cada tributo, `valor pago × p ÷ (100 + p)` (Decreto 12.955/2026, art. 253), com `p` informado na tela | Esta página |
| Transportadora do regime regular | O IBS e a CBS cobrados no frete dela | Calculadora da Receita (mesma data, local e alíquotas da operação, tributação integral) |

Pontos que a página explica ao visitante:

- O crédito presumido vale só para transporte de carga, contratado e pago por contribuinte do regime
  regular, e é apropriado conforme os pagamentos ao transportador são confirmados (no CT-e, pelo
  evento de apropriação de crédito presumido, código 02).
- O crédito da CBS só abate CBS, e o do IBS só abate IBS. Não há devolução em dinheiro.
- Em 2026 não há crédito presumido: os arts. 168 a 171 só produzem efeitos a partir de 2027 (LC 214/2025,
  art. 544, III, na redação da LC 227/2026).
- **Os percentuais de 2027 ainda não foram publicados** (o ato conjunto do Ministério da Fazenda e do
  Comitê Gestor do IBS deveria sair até setembro de 2026; situação em 18/11/2026). Por isso a tela pede
  os dois percentuais e não sugere nenhum. Quando o ato sair, os percentuais podem ser colocados como
  sugestão na tela.
- Transportadora do Simples Nacional não está coberta: o crédito fica limitado ao que ela paga no
  Simples, valor que a página não tem como saber.

O saldo é uma estimativa por operação. Na apuração real, débitos e créditos são somados no período.

## Identidade visual

Nome, logo e cores ficam em [`config/marca.json`](config/marca.json), no mesmo formato usado pela
Central de Atendimento; os arquivos de imagem ficam em `public/marca/`. A configuração atual usa a
logo da Expo e as cores azul-marinho `#011433` e dourado `#D9911C`. O campo `compartilhar` é a imagem
da prévia do link (1200 × 630). Para trocar de marca, substitua os arquivos ou edite o JSON e
reinicie: as cores de texto são ajustadas sozinhas para continuarem legíveis.

## Simulação de 2027 em diante

[`config/simulacao.json`](config/simulacao.json) define, por período, as alíquotas que a tela já traz
preenchidas, as que aparecem só como exemplo e a nota explicativa. Hoje:

- **2027 e 2028:** IBS de 0,05% estadual e 0,05% municipal, já preenchido (ADCT, art. 127).
- **CBS de 2027:** aparece só como exemplo (11,2%), com a nota de que a alíquota de referência foi
  calculada pelo TCU em outubro de 2026 e ainda depende do Senado.

**Revise esse arquivo quando o Senado fixar a alíquota** e sempre que a legislação mudar.

## Privacidade

O servidor não grava os dados das operações nem os escreve nos registros. Eles são repassados à
Calculadora da Receita Federal apenas para o cálculo. A página carrega as fontes do Google Fonts,
como as demais páginas do escritório, e guarda no navegador do visitante apenas a última UF e o
último município escolhidos.

## Estrutura

| Caminho | Papel |
|---|---|
| `src/index.js` | Inicialização do servidor |
| `src/servidor.js` | Rotas, arquivos da página, cabeçalhos de segurança e limite de uso |
| `src/receita.js` | Chamadas à Calculadora de Tributos: tentativas, tempo limite e memória das listas |
| `src/calculo.js` | Validação do pedido, montagem da operação e resumo da resposta |
| `src/pagina.js`, `src/marca.js` | Página montada com a marca e cores derivadas |
| `src/config.js` | Variáveis de ambiente, `marca.json` e `simulacao.json` |
| `public/` | Estilo, comportamento da página e imagens da marca |
| `test/` | Testes automatizados e respostas reais da Receita usadas neles |
