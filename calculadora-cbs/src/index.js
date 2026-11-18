import http from "node:http";
import { carregarMarca, carregarSimulacao, lerConfig } from "./config.js";
import { criarReceita } from "./receita.js";
import { criarServidor } from "./servidor.js";

const config = lerConfig();
const marca = carregarMarca();
const receita = criarReceita({ base: config.receitaApi });

const servidor = http.createServer(
  criarServidor({ marca, receita, raiz: config.raiz, urlPublica: config.urlPublica, origemDoIp: config.origemDoIp, simulacao: carregarSimulacao() }),
);
// Pedidos lentos demais são encerrados: a página só troca mensagens curtas com o servidor.
servidor.headersTimeout = 10_000;
servidor.requestTimeout = 15_000;

servidor.listen(config.porta, () => {
  console.log(`Calculadora CBS e IBS · ${marca.nome}: http://localhost:${config.porta}`);
  if (config.urlPublica) console.log(`Endereço público: ${config.urlPublica}`);
  const { cabecalhoIp, proxies } = config.origemDoIp;
  console.log(`Limite por visitante: IP lido ${cabecalhoIp ? `do cabeçalho ${cabecalhoIp}` : proxies ? "do X-Forwarded-For" : "da conexão (sem proxy à frente)"}.`);
  // Adianta a lista de UFs, para a primeira visita já encontrá-la pronta.
  receita.ufs().catch((erro) => console.warn(`Não foi possível adiantar a lista de UFs: ${erro.message}`));
});

for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.on(sinal, () => {
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
