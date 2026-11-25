/** Resumos dos arquivos devolvidos pela Receita, para conferência pelo escritório. */

const centavos = (v) => Math.round(Number(v || 0) * 100);
const reais = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Recolhimentos como adquirente (RAD): total por fornecedor e por período de apuração.
 * Contas em centavos inteiros, para não haver erro de arredondamento.
 */
export function resumirRecolhimentos(arquivo) {
  const porFornecedor = new Map();
  let total = 0;
  let itens = 0;
  for (const dia of arquivo?.apuracao || []) {
    for (const pagamento of dia.pagamentos || []) {
      for (const item of pagamento.composicao || []) {
        const chave = `${item.niFornecedor}|${item.pa}`;
        const atual = porFornecedor.get(chave) || { fornecedor: item.niFornecedor, pa: item.pa, documentos: 0, principal: 0, multa: 0, juros: 0, total: 0 };
        atual.documentos += 1;
        atual.principal += centavos(item.principal);
        atual.multa += centavos(item.multa);
        atual.juros += centavos(item.juros);
        atual.total += centavos(item.total);
        porFornecedor.set(chave, atual);
        total += centavos(item.total);
        itens += 1;
      }
    }
  }
  const linhas = [...porFornecedor.values()].sort((a, b) => a.pa.localeCompare(b.pa) || b.total - a.total);
  return { geradoEm: arquivo?.geradoEm || null, itens, total, linhas };
}

/** Texto do resumo para o terminal. */
export function textoDoResumo(resumo) {
  if (!resumo.itens) return "Nenhum recolhimento como adquirente no período devolvido pela Receita.";
  const cnpj = (n) => String(n).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  const linhas = resumo.linhas.map((l) => `  ${l.pa}  ${cnpj(l.fornecedor)}  ${String(l.documentos).padStart(4)} doc.  principal ${reais(l.principal)}  multa ${reais(l.multa)}  juros ${reais(l.juros)}  total ${reais(l.total)}`);
  return [`Recolhimentos como adquirente (RAD): ${resumo.itens} documento(s), total ${reais(resumo.total)}`, ...linhas].join("\n");
}
