#!/usr/bin/env node
/**
 * Linha de comando da integração com a Apuração Assistida da CBS.
 * Uso: node src/cli.js <comando> [argumentos]   (veja `ajuda`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONSULTAS, ErroDaApi, ErroDeCota, criarCliente } from "./cliente.js";
import { resumirRecolhimentos, textoDoResumo } from "./resumo.js";
import { ErroDeEntrada } from "./validacao.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arquivoEnv = path.join(raiz, ".env");
if (fs.existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);

const AJUDA = `Integração com a Apuração Assistida da CBS (Receita Federal)

Consultas (assíncronas; até 4 por tipo, por dia e por credencial):
  consultar <tipo> <cnpj>        abre a consulta, espera concluir e salva o arquivo em dados/
                                 tipos: ${Object.keys(CONSULTAS).join(", ")}
  situacao <tíquete>             situação de uma consulta aberta
  baixar <tíquete>               baixa o arquivo de uma consulta concluída
  cota                           consultas que ainda restam hoje

Recolhimento pelo adquirente (RAD):
  resumo-rad <arquivo.json>      total por fornecedor e período de um arquivo de recolhimentos
  darf-rad <cnpj> <chave>[:valor] [<chave>[:valor] ...]
                                 gera DARF de RAD por documento fiscal (com :valor, pagamento parcial)

Pagamento como contribuinte (PCONT):
  darf-pcont <cnpj> <MM/AAAA> [valor]   gera DARF do período (com valor, pagamento parcial)

Credencial: RECEITA_CLIENT_ID e RECEITA_CLIENT_SECRET no ambiente ou no arquivo .env.`;

const pastaDados = path.resolve(raiz, process.env.PASTA_DADOS || "./dados");

/** Uso diário da cota gravado em dados/cota.json (para não estourar as 4 chamadas da Receita). */
function cotaEmArquivo() {
  const arquivo = path.join(pastaDados, "cota.json");
  return {
    ler: () => {
      try {
        return JSON.parse(fs.readFileSync(arquivo, "utf8"));
      } catch {
        return {};
      }
    },
    gravar: (dados) => {
      fs.mkdirSync(pastaDados, { recursive: true });
      fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
    },
  };
}

function salvar(nome, dados) {
  fs.mkdirSync(pastaDados, { recursive: true });
  const arquivo = path.join(pastaDados, nome);
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
  return arquivo;
}

const carimbo = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const exigir = (valor, nome) => {
  if (!valor) throw new ErroDeEntrada(`Falta ${nome}. Use "ajuda" para ver os comandos.`);
  return valor;
};

export async function executar(args, { cliente: clienteInformado, escrever = console.log } = {}) {
  const [comando, ...resto] = args;
  if (!comando || comando === "ajuda" || comando === "--help" || comando === "-h") return escrever(AJUDA);

  if (comando === "resumo-rad") {
    const arquivo = JSON.parse(fs.readFileSync(exigir(resto[0], "o arquivo de recolhimentos"), "utf8"));
    return escrever(textoDoResumo(resumirRecolhimentos(arquivo)));
  }

  const cliente =
    clienteInformado ||
    criarCliente({
      clientId: process.env.RECEITA_CLIENT_ID,
      clientSecret: process.env.RECEITA_CLIENT_SECRET,
      base: process.env.RECEITA_API_BASE || undefined,
      cota: cotaEmArquivo(),
    });

  switch (comando) {
    case "consultar": {
      const tipo = exigir(resto[0], "o tipo de consulta");
      const cnpj = exigir(resto[1], "o CNPJ");
      const { tiquete, arquivo } = await cliente.consultar(tipo, cnpj, {
        aoMudar: (s) => escrever(s.situacao === "ABERTA" ? `Consulta aberta. Tíquete ${s.tiquete} (estimativa: ${s.segundosEstimados >= 0 ? `${s.segundosEstimados} s` : "sem estimativa"}).` : `Situação: ${s.situacao}`),
      });
      const salvo = salvar(`${tipo}-${String(cnpj).replace(/\D/g, "").slice(0, 8)}-${carimbo()}.json`, arquivo);
      escrever(`Arquivo salvo em ${salvo} (tíquete ${tiquete}).`);
      if (tipo === "recolhimentos") escrever(textoDoResumo(resumirRecolhimentos(arquivo)));
      return;
    }
    case "situacao": {
      const s = await cliente.situacao(exigir(resto[0], "o tíquete"));
      return escrever(`Situação: ${s.situacao}${s.mensagemErro ? ` (${s.codigoErro}: ${s.mensagemErro})` : ""}`);
    }
    case "baixar": {
      const t = exigir(resto[0], "o tíquete");
      const arquivo = await cliente.baixar(t);
      return escrever(`Arquivo salvo em ${salvar(`retorno-${t.replace(/[^\w.-]/g, "_")}.json`, arquivo)}.`);
    }
    case "cota": {
      const restante = cliente.cotaRestante();
      return escrever(Object.entries(restante).map(([tipo, n]) => `${tipo}: ${n} de 4 restantes hoje`).join("\n"));
    }
    case "darf-rad": {
      const cnpj = exigir(resto[0], "o CNPJ do adquirente");
      const itens = resto.slice(1).map((a) => {
        const [chave, valorParcial] = a.split(":");
        return { chave, valorParcial };
      });
      const resultados = await cliente.gerarDarfRad(cnpj, itens);
      for (const r of resultados) {
        if (r.erro) escrever(`${r.chave}: não gerado. ${r.erro}`);
        else escrever(`${r.chave}: DARF de ${r.pagamento.valorDarfTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}, pagar até ${r.pagamento.dataMaximaPagamento}. PDF: ${r.darf.linkDarfPDF}`);
      }
      return salvar(`darf-rad-${carimbo()}.json`, resultados);
    }
    case "darf-pcont": {
      const r = await cliente.gerarDarfPcont(exigir(resto[0], "o CNPJ"), { pa: exigir(resto[1], "o período (MM/AAAA)"), valorParcial: resto[2] });
      escrever(`DARF de ${r.pagamento.valorDarfTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}, pagar até ${r.pagamento.dataMaximaPagamento}. PDF: ${r.darf.linkDarfPDF}`);
      return salvar(`darf-pcont-${carimbo()}.json`, r);
    }
    default:
      throw new ErroDeEntrada(`Comando desconhecido: "${comando}". Use "ajuda" para ver os comandos.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("/cli.js")) {
  executar(process.argv.slice(2)).catch((erro) => {
    const conhecido = erro instanceof ErroDeEntrada || erro instanceof ErroDaApi || erro instanceof ErroDeCota;
    console.error(conhecido ? erro.message : erro);
    process.exitCode = 1;
  });
}
