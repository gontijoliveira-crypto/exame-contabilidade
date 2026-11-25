# Apuração Assistida da CBS · Expo Contabilidade e Consultoria

Ferramenta interna do escritório para usar as APIs da Apuração Assistida da CBS, da Receita Federal
([documentação oficial](https://docs.receitafederal.gov.br/apuracao-cbs/)):

- consultar **débitos**, **créditos**, **pagamentos** e **recolhimentos como adquirente (RAD)** de uma empresa;
- **resumir o RAD** por fornecedor e período;
- gerar **DARF de RAD** (recolhimento pelo adquirente, por documento fiscal) e **DARF de PCONT**
  (pagamento como contribuinte, por período).

Não é uma página pública: usa a credencial da empresa (ou do escritório com procuração) e lida com dados
fiscais dos clientes.

## Antes de usar

1. **Credencial.** Gere a credencial da aplicação (ClientID e Secret) no portal **Receita Integra**. O
   acesso exige certificado digital (e-CNPJ da empresa ou procuração eletrônica do representante). O
   manual está em arquivos.receitafederal.gov.br › Documentos › Técnicos › Receita Integra.
2. Copie `.env.example` para `.env` e preencha `RECEITA_CLIENT_ID` e `RECEITA_CLIENT_SECRET`. O `.env`
   nunca vai para o repositório.
3. Requer Node.js 22 ou mais novo. Não há dependências para instalar.

A credencial vale para o **estabelecimento matriz**. Para consultar um cliente, a credencial usada
precisa estar autorizada para o CNPJ dele (a Receita responde `NAO_AUTORIZADO: consumidor não autorizado
para este NI` quando não está).

## Comandos

```bash
cd apuracao-cbs
node src/cli.js ajuda

# Consultas (assíncronas): abre, espera concluir (até 30 min) e salva o arquivo em dados/
node src/cli.js consultar recolhimentos 63.334.737/0001-60
node src/cli.js consultar debitos 63334737
node src/cli.js consultar creditos 63334737
node src/cli.js consultar pagamentos 63334737

# Se a consulta passar de 30 minutos, acompanhe depois pelo tíquete
node src/cli.js situacao <tíquete>
node src/cli.js baixar <tíquete>

# Quantas consultas ainda restam hoje
node src/cli.js cota

# Resumo de um arquivo de recolhimentos (RAD) por fornecedor e período
node src/cli.js resumo-rad dados/recolhimentos-63334737-....json

# DARF de RAD: uma chave por documento; com ":valor", pagamento parcial
node src/cli.js darf-rad 63.334.737/0001-60 35260912345678000123550010000000011000000010
node src/cli.js darf-rad 63.334.737/0001-60 3526...0010:1500,75 3526...0011

# DARF de PCONT do período (com valor, pagamento parcial)
node src/cli.js darf-pcont 63.334.737/0001-60 08/2026
node src/cli.js darf-pcont 63.334.737/0001-60 08/2026 1500,75
```

Os arquivos da Receita e os DARF gerados ficam em `dados/` (fora do repositório).

## Regras da Receita que a ferramenta respeita

- **Cota:** cada consulta (débitos, créditos, pagamentos, recolhimentos) aceita **4 chamadas por dia,
  por credencial**, reiniciando à meia-noite. A ferramenta conta o uso em `dados/cota.json` e recusa a
  5ª antes de chamar a Receita. A geração de DARF não entra nessa cota.
- **Janela:** cada consulta devolve o que mudou desde a última consulta concluída, limitado aos últimos
  8 dias. Sem consulta concluída nos últimos 3 meses, começa no 1º dia do mês. Por isso, consulte com
  regularidade (por exemplo, uma vez por semana) para não perder movimentos.
- **Processamento:** até 4 horas. A ferramenta acompanha a situação a cada 30 segundos (não usa
  webhook, que exigiria um endereço HTTPS público).
- **Arquivo:** fica disponível por 48 horas; o link de download (URL assinada) é tratado como segredo e
  nunca é exibido nem gravado.
- **Token:** OAuth2 *client credentials* em `https://api.receitafederal.gov.br/token`, guardado e
  renovado um minuto antes de vencer.

## Situação e pontos a confirmar

- **Não foi testada contra a Receita.** Ainda não há credencial, e a API do RAD foi publicada só como
  documentação em 17/11/2026, sem data para produção. Os testes automáticos (`npm test`) usam uma Receita
  de mentira que segue exatamente os exemplos da documentação.
- **CNPJ no endereço do DARF.** A documentação de RAD e PCONT pede o CNPJ com 14 dígitos, mas um dos
  exemplos usa 8. A ferramenta envia os 14 dígitos; se a Receita recusar, é só trocar em `src/cliente.js`.
- **Resposta do DARF de RAD.** A documentação mostra um objeto de resposta, embora o pedido aceite
  vários documentos. A ferramenta aceita as duas formas.
- **Autenticação do token.** A ferramenta envia ClientID e Secret em `Authorization: Basic`, o padrão
  OAuth2. Confirme no manual do Receita Integra ao gerar a credencial.
- **Homologação:** para testar sem afetar a produção, use `RECEITA_API_BASE=https://h-api.receitafederal.gov.br`.

## Estrutura

| Caminho | Papel |
|---|---|
| `src/cliente.js` | Token, cota, consultas assíncronas, download e DARF |
| `src/validacao.js` | CNPJ (com dígito verificador), chave do documento, valores e período |
| `src/resumo.js` | Resumo dos recolhimentos (RAD) por fornecedor e período |
| `src/cli.js` | Comandos de linha de comando |
| `test/` | Testes com os exemplos da documentação oficial |
