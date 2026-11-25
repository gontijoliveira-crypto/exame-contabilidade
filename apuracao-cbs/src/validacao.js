/** Conferência dos dados enviados às APIs da Apuração Assistida da CBS. */

export class ErroDeEntrada extends Error {}

const soDigitos = (v) => String(v ?? "").replace(/[.\-/\s]/g, "");

/** Confere os dígitos verificadores de um CNPJ numérico de 14 dígitos. */
export function cnpjValido(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digito = (base) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const c of base) {
      soma += Number(c) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = digito(cnpj.slice(0, 12));
  const d2 = digito(cnpj.slice(0, 12) + d1);
  return cnpj.endsWith(`${d1}${d2}`);
}

/** CNPJ completo (14 dígitos, com dígitos verificadores corretos). Aceita pontuação. */
export function cnpjCompleto(valor) {
  const cnpj = soDigitos(valor);
  if (!cnpjValido(cnpj)) throw new ErroDeEntrada(`CNPJ inválido: "${valor}". Informe os 14 dígitos.`);
  return cnpj;
}

/** CNPJ base (8 dígitos), usado nas consultas. Aceita o CNPJ completo e tira a raiz. */
export function cnpjBase(valor) {
  const cnpj = soDigitos(valor);
  if (/^\d{8}$/.test(cnpj)) return cnpj;
  return cnpjCompleto(cnpj).slice(0, 8);
}

/** Chave do documento fiscal eletrônico (só dígitos, até 100 caracteres; a da NF-e e do CT-e tem 44). */
export function chaveDfe(valor) {
  const chave = soDigitos(valor);
  if (!/^\d{44,100}$/.test(chave)) throw new ErroDeEntrada(`Chave do documento fiscal inválida: "${valor}".`);
  return chave;
}

/** Valor em reais com até 2 casas, maior que zero: "1.500,75", "1500,75", "1500.75" ou 1500.75 → 1500.75. */
export function valorEmReais(valor) {
  const t = typeof valor === "number" ? String(valor) : String(valor ?? "").trim().replace(/^R\$\s*/i, "");
  let normal = null;
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(t)) normal = t.replace(/\./g, "").replace(",", "."); // 1.500,75
  else if (/^\d+(\.\d{1,2})?$/.test(t)) normal = t; // 1500.75
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, ""); // 1.500
  const numero = normal === null ? NaN : Number(normal);
  if (!(numero > 0) || numero >= 1e16) throw new ErroDeEntrada(`Valor inválido: "${valor}".`);
  return Math.round(numero * 100) / 100;
}

/** Período de apuração no formato MM/AAAA. */
export function periodo(valor) {
  const pa = String(valor ?? "").trim();
  const m = /^(0[1-9]|1[0-2])\/(20\d\d)$/.exec(pa);
  if (!m) throw new ErroDeEntrada(`Período de apuração inválido: "${valor}". Use MM/AAAA, por exemplo 08/2026.`);
  return pa;
}

/** Endereço do webhook: HTTPS ou vazio (sem webhook, acompanha-se pela consulta de situação). */
export function urlRetorno(valor) {
  const url = String(valor ?? "").trim();
  if (!url) return "";
  let u;
  try {
    u = new URL(url);
  } catch {
    u = null;
  }
  if (!u || u.protocol !== "https:") throw new ErroDeEntrada("O endereço de retorno (webhook) deve ser HTTPS.");
  return u.href;
}

/** Tíquete de solicitação devolvido pela API assíncrona. */
export function tiquete(valor) {
  const t = String(valor ?? "").trim();
  if (!/^[\w.\-]{6,120}$/.test(t)) throw new ErroDeEntrada(`Tíquete de solicitação inválido: "${valor}".`);
  return t;
}
