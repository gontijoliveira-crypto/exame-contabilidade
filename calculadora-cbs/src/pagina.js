/**
 * A página da calculadora, montada no servidor com o nome e a logo de config/marca.json.
 * Estilos e comportamento ficam em public/estilo.css e public/app.js (nada embutido na página).
 */
import { DATA_MAXIMA, DATA_MINIMA } from "./calculo.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const FONTES = "https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&family=Nunito+Sans:wght@400;600;700&family=JetBrains+Mono:wght@500;600&display=swap";
const TITULO = "Calculadora CBS e IBS";
const DESCRICAO = "Calcule a CBS e o IBS de uma operação com as regras da Reforma Tributária do Consumo. O cálculo é feito pela Calculadora de Tributos da Receita Federal.";

/**
 * @param {object} p
 * @param {{nome: string, subtitulo: string|null, logo: string|null, icone: string|null, cores: object}} p.marca
 * @param {string} p.urlPublica endereço público (sem barra no fim) ou "" quando não configurado
 * @param {{largura: number, altura: number}|null} p.logo dimensões da logo, para a página não "pular" ao carregar
 * @param {string|null} p.imagemCompartilhar caminho (em public/) da imagem da prévia do link
 * @param {Array<object>} p.simulacao períodos de config/simulacao.json (apoio às datas a partir de 2027)
 */
export function renderizarPagina({ marca, urlPublica = "", logo = null, imagemCompartilhar = null, simulacao = [] }) {
  const nome = esc(marca.nome);
  const tituloCompleto = `${TITULO} · ${nome}`;
  const icone = marca.icone ? `/${esc(marca.icone)}` : "/icone.svg";

  const previa = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta property="og:site_name" content="${nome}">`,
    `<meta property="og:title" content="${esc(TITULO)}">`,
    `<meta property="og:description" content="${esc(DESCRICAO)}">`,
  ];
  if (urlPublica) {
    previa.push(`<link rel="canonical" href="${esc(urlPublica)}/">`, `<meta property="og:url" content="${esc(urlPublica)}/">`);
    if (imagemCompartilhar) {
      previa.push(
        `<meta property="og:image" content="${esc(urlPublica)}/${esc(imagemCompartilhar)}">`,
        `<meta property="og:image:alt" content="${esc(TITULO)}, ${nome}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
      );
    }
  }

  const marcaNaCapa = marca.logo
    ? `<img class="logo" src="/${esc(marca.logo)}" alt="${nome}"${logo ? ` width="${logo.largura}" height="${logo.altura}"` : ""}>`
    : `<span class="logo-texto">${nome}</span>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${tituloCompleto}</title>
<meta name="description" content="${esc(DESCRICAO)}">
<meta name="theme-color" content="${esc(marca.cores.primaria)}">
<link rel="icon" href="${icone}">
<link rel="apple-touch-icon" href="${icone}">
${previa.join("\n")}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTES}">
<link rel="stylesheet" href="/estilo.css">
<link rel="stylesheet" href="/marca.css">
</head>
<body>
<a class="pular" href="#conteudo">Pular para a calculadora</a>

<header class="capa">
  <div class="in">
    <div class="marca">${marcaNaCapa}</div>
    <p class="eyebrow">Reforma Tributária do Consumo</p>
    <h1>${esc(TITULO)}</h1>
    <p class="chamada">Informe os dados da operação e veja quanto incide de CBS e de IBS. O cálculo é feito na hora pela Calculadora de Tributos da Receita Federal.</p>
    <ul class="resumo">
      <li>Regras e tabelas da Receita Federal</li>
      <li>Gratuita</li>
      <li>Sem cadastro</li>
    </ul>
  </div>
</header>

<main class="wrap" id="conteudo">
  <noscript><p class="alerta erro">Esta calculadora precisa do JavaScript ativado no navegador.</p></noscript>

  <div class="grade">
    <section class="cartao" aria-labelledby="t-dados">
      <h2 id="t-dados">Dados da operação</h2>
      <div class="alerta erro" id="erro-inicio" role="alert" hidden>
        <p id="erro-inicio-texto"></p>
        <button type="button" class="secundario" id="tentar">Tentar de novo</button>
      </div>

      <form id="form" novalidate>
        <div class="linha">
          <div class="campo">
            <label for="valor">Valor da operação (R$)</label>
            <input id="valor" name="valor" type="text" inputmode="decimal" autocomplete="off" placeholder="1.000,00" required aria-describedby="dica-valor">
            <p class="dica" id="dica-valor">É a base de cálculo dos tributos.</p>
          </div>
          <div class="campo">
            <label for="data">Data do fato gerador</label>
            <input id="data" name="data" type="date" min="${DATA_MINIMA}" max="${DATA_MAXIMA}" required aria-describedby="dica-data">
            <p class="dica" id="dica-data">Em geral, a data da venda ou do serviço.</p>
          </div>
        </div>

        <div class="linha">
          <div class="campo">
            <label for="uf">UF</label>
            <select id="uf" name="uf" required disabled><option value="">Carregando…</option></select>
          </div>
          <div class="campo">
            <label for="municipio">Município</label>
            <select id="municipio" name="municipio" required disabled><option value="">Escolha a UF</option></select>
          </div>
        </div>

        <div class="campo">
          <label for="cst">Situação tributária (CST)</label>
          <select id="cst" name="cst" required disabled aria-describedby="dica-cst"><option value="">Carregando…</option></select>
          <p class="dica" id="dica-cst">Na dúvida, a regra geral é 000 · Tributação integral.</p>
        </div>

        <div class="campo">
          <label for="cClassTrib">Classificação tributária (cClassTrib)</label>
          <select id="cClassTrib" name="cClassTrib" required disabled><option value="">Escolha o CST</option></select>
        </div>

        <div class="linha">
          <div class="campo">
            <label for="ncm">NCM da mercadoria <span class="opcional">opcional</span></label>
            <input id="ncm" name="ncm" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="8 dígitos" aria-describedby="dica-codigo">
          </div>
          <div class="campo">
            <label for="nbs">NBS do serviço <span class="opcional">opcional</span></label>
            <input id="nbs" name="nbs" type="text" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="9 dígitos" aria-describedby="dica-codigo">
          </div>
        </div>
        <p class="dica" id="dica-codigo">Algumas classificações com alíquota reduzida exigem o código do item. Se for o caso, a calculadora avisa.</p>

        <fieldset class="aliquotas" id="aliquotas" data-periodos="${esc(JSON.stringify(simulacao))}" hidden>
          <legend>Alíquotas para a simulação</legend>
          <p class="dica" id="dica-aliquotas">Para fatos geradores a partir de 2027, as alíquotas ainda não constam na base da Receita Federal. Informe as alíquotas que deseja simular.</p>
          <p class="nota" id="nota-aliquotas" hidden></p>
          <div class="linha tres">
            <div class="campo">
              <label for="aliquotaCbs">CBS (%)</label>
              <input id="aliquotaCbs" name="aliquotaCbs" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-describedby="dica-aliquotas nota-aliquotas">
            </div>
            <div class="campo">
              <label for="aliquotaIbsUf">IBS estadual (%)</label>
              <input id="aliquotaIbsUf" name="aliquotaIbsUf" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-describedby="dica-aliquotas nota-aliquotas">
            </div>
            <div class="campo">
              <label for="aliquotaIbsMun">IBS municipal (%)</label>
              <input id="aliquotaIbsMun" name="aliquotaIbsMun" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-describedby="dica-aliquotas nota-aliquotas">
            </div>
          </div>
        </fieldset>

        <div class="alerta erro" id="erro-form" role="alert" hidden></div>
        <button type="submit" class="primario" id="calcular" disabled>Calcular</button>
      </form>
    </section>

    <section class="cartao resultado" id="resultado" aria-labelledby="t-resultado" tabindex="-1">
      <h2 id="t-resultado">Resultado</h2>
      <p class="vazio" id="vazio">Preencha os dados da operação e clique em Calcular.</p>

      <div id="calculo" hidden>
        <div class="alerta aviso" id="aviso" hidden></div>
        <p class="total"><span>Total de CBS + IBS</span><b id="r-total"></b><small id="r-carga"></small></p>
        <div class="tabela">
          <table>
            <thead><tr><th scope="col">Tributo</th><th scope="col">Alíquota</th><th scope="col">Valor</th></tr></thead>
            <tbody>
              <tr><th scope="row">CBS</th><td id="r-cbs-aliquota"></td><td id="r-cbs-valor"></td></tr>
              <tr><th scope="row">IBS estadual</th><td id="r-ibsuf-aliquota"></td><td id="r-ibsuf-valor"></td></tr>
              <tr><th scope="row">IBS municipal</th><td id="r-ibsmun-aliquota"></td><td id="r-ibsmun-valor"></td></tr>
              <tr class="base"><th scope="row">Base de cálculo</th><td></td><td id="r-base"></td></tr>
            </tbody>
          </table>
        </div>
        <p class="nota" id="r-observacao" hidden></p>
        <details id="memoria" hidden>
          <summary>Memória de cálculo</summary>
          <div id="memoria-texto"></div>
        </details>
      </div>

      <p class="fonte" id="fonte" hidden></p>
    </section>
  </div>

  <section class="notas" aria-labelledby="t-notas">
    <h2 id="t-notas">Antes de usar o resultado</h2>
    <ul>
      <li>Esta página é uma simulação informativa mantida por ${nome}. Não é um serviço da Receita Federal e não substitui a análise de um contador sobre o seu caso.</li>
      <li>O cálculo é feito pela Calculadora de Tributos da Receita Federal, com as regras da Reforma Tributária do Consumo (Lei Complementar nº 214/2025).</li>
      <li>Em 2026 valem as alíquotas de teste: CBS de 0,9% e IBS de 0,1%. Quem cumpre as obrigações acessórias fica dispensado de recolher esses valores (LC 214/2025, art. 348). As alíquotas de teste não se aplicam a optantes do Simples Nacional.</li>
      <li>A partir de 2027 as alíquotas ainda não constam na base da Receita Federal. Por isso a calculadora pede as alíquotas que você quer simular e marca o resultado como simulação.</li>
      <li>Os dados da operação não são guardados por ${nome}. Eles são enviados à Calculadora da Receita Federal apenas para fazer a conta.</li>
    </ul>
  </section>
</main>

<footer>
  <div class="wrap">
    <span>${nome}</span>
    <span>Cálculo: Calculadora de Tributos, Receita Federal</span>
  </div>
</footer>

<script type="module" src="/app.js"></script>
</body>
</html>
`;
}

/** Página simples para endereços que não existem. */
export function renderizarNaoEncontrada({ marca }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Página não encontrada · ${esc(marca.nome)}</title>
<link rel="stylesheet" href="/estilo.css">
<link rel="stylesheet" href="/marca.css">
</head>
<body>
<main class="wrap perdido">
  <h1>Página não encontrada</h1>
  <p><a href="/">Ir para a ${esc(TITULO)}</a></p>
</main>
</body>
</html>
`;
}
