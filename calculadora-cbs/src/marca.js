/**
 * Cores da marca (config/marca.json) aplicadas à página: a folha /marca.css define as três cores do
 * escritório e as variações de texto que continuam legíveis sobre cada fundo, no tema claro e no escuro.
 */

const BRANCO = "#FFFFFF";
const PAINEL_ESCURO = "#111C33"; // fundo dos cartões no tema escuro (estilo.css)
const TEXTO_ESCURO = "#1A1200";

const canais = (cor) => [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));
const emHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

/** Luminância relativa (WCAG 2). */
function luminancia(cor) {
  const [r, g, b] = canais(cor).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste entre duas cores (WCAG 2), de 1 a 21. */
export function contraste(a, b) {
  const [clara, escura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + 0.05) / (escura + 0.05);
}

/** A cor de texto (clara ou escura) que mais contrasta com o fundo. */
export function textoSobre(fundo) {
  return contraste(BRANCO, fundo) >= contraste(TEXTO_ESCURO, fundo) ? BRANCO : TEXTO_ESCURO;
}

/** Aproxima a cor do preto ou do branco até ela ter contraste suficiente para texto sobre o fundo. */
export function legivelSobre(cor, fundo, minimo = 4.5) {
  const alvo = canais(contraste(BRANCO, fundo) >= contraste("#000000", fundo) ? BRANCO : "#000000");
  const origem = canais(cor);
  for (let passo = 0; passo <= 20; passo++) {
    const t = passo / 20;
    const tentativa = emHex(origem.map((v, i) => v + (alvo[i] - v) * t));
    if (contraste(tentativa, fundo) >= minimo) return tentativa;
  }
  return emHex(alvo);
}

/** Folha de estilo com as cores da marca. As cores já foram validadas (#RRGGBB) em carregarMarca. */
export function cssDaMarca(cores) {
  const { primaria, primariaClara, destaque } = cores;
  return [
    ":root {",
    `  --azul: ${primaria};`,
    `  --azul-claro: ${primariaClara};`,
    `  --amarelo: ${destaque};`,
    `  --sobre-azul: ${textoSobre(primaria)};`,
    `  --sobre-amarelo: ${textoSobre(destaque)};`,
    `  --amarelo-no-azul: ${legivelSobre(destaque, primaria)};`,
    `  --amarelo-texto: ${legivelSobre(destaque, BRANCO)};`,
    `  --azul-texto: ${legivelSobre(primariaClara, BRANCO)};`,
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    `    --amarelo-texto: ${legivelSobre(destaque, PAINEL_ESCURO)};`,
    `    --azul-texto: ${legivelSobre(primariaClara, PAINEL_ESCURO)};`,
    "  }",
    "}",
    "",
  ].join("\n");
}

/** Ícone da aba quando não há arquivo de ícone: a inicial do escritório sobre a cor principal. */
export function iconeDaMarca(marca) {
  const inicial = (marca.nome.match(/[\p{L}\p{N}]/u)?.[0] || "?").toLocaleUpperCase("pt-BR"); // só letra ou número: nada que precise de escape
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" rx="14" fill="${marca.cores.primaria}"/>` +
    `<rect x="10" y="44" width="36" height="5" rx="2.5" fill="${marca.cores.destaque}"/>` +
    `<text x="28" y="37" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="bold" fill="${textoSobre(marca.cores.primaria)}">${inicial}</text></svg>`
  );
}
