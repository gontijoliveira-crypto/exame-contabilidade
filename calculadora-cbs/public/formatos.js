// Leitura do que a pessoa digita (valores e percentuais no formato brasileiro) e formatação do que a página mostra.

/** "1.000,50", "1000,5" ou "1000.50" → "1000.50". Devolve "" quando não é um valor em reais. */
export function lerValor(texto) {
  const t = String(texto).trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  let inteiro;
  let decimal;
  const comMilhar = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(t); // 1.000 ou 1.000,50 (ponto de milhar)
  const simples = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(t); // 1000, 1000,5 ou 1000.50
  if (comMilhar) {
    inteiro = comMilhar[1].replace(/\./g, "");
    decimal = comMilhar[2] || "";
  } else if (simples) {
    inteiro = simples[1];
    decimal = simples[2] || "";
  } else {
    return "";
  }
  inteiro = inteiro.replace(/^0+(?=\d)/, "");
  return inteiro.length > 13 ? "" : `${inteiro}.${decimal.padEnd(2, "0")}`;
}

/** "8,8", "8.8" ou "8,8%" → "8.8". Devolve "" quando não é um percentual entre 0 e 100. */
export function lerPercentual(texto) {
  const m = /^(\d{1,3})(?:[.,](\d{1,4}))?$/.exec(String(texto).trim().replace(/%$/, "").trim());
  if (!m) return "";
  const v = m[2] ? `${Number(m[1])}.${m[2]}` : String(Number(m[1]));
  return Number(v) <= 100 ? v : "";
}

/** "1234.5" → "R$ 1.234,50". */
export const reais = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "0.9" → "0,90%". */
export const porcento = (v) => `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
