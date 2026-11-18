import fs from "node:fs";
import path from "node:path";

/**
 * Dados públicos da tela de entrada (indicadores econômicos e notícias), os mesmos que a
 * Central de Painéis mostra nos outros painéis. A fonte é o indicadores.json da Central,
 * atualizado por ela todo dia; aqui ele é lido de tempos em tempos e guardado em cache.
 *
 * `fonte` pode ser um endereço http(s) ou um caminho de arquivo local.
 */
export function criarFonteDeEntrada({ fonte, cliente, arquivoCache, intervaloMs = 60 * 60 * 1000, log = console }) {
  let atual = null; // { indicadores, noticias }
  let avisouFalha = false;

  const valido = (d) => d && typeof d.indicadores === "object" && Object.keys(d.indicadores).length > 0;

  function lerCache() {
    try {
      const d = JSON.parse(fs.readFileSync(arquivoCache, "utf8"));
      if (valido(d)) atual = d;
    } catch {
      /* sem cache ainda */
    }
  }

  async function baixar() {
    if (/^https?:\/\//.test(fonte)) {
      const r = await fetch(fonte, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const texto = await r.text();
      try {
        return JSON.parse(texto);
      } catch {
        // O Drive devolve uma página de login quando o arquivo não está compartilhado por link.
        throw new Error("a resposta não é JSON (o arquivo está compartilhado como \"qualquer pessoa com o link\"?)");
      }
    }
    return JSON.parse(fs.readFileSync(fonte, "utf8"));
  }

  async function atualizar() {
    if (!fonte) return;
    try {
      const d = await baixar();
      if (!valido(d)) throw new Error("arquivo sem indicadores");
      atual = { indicadores: d.indicadores, noticias: d.noticias || { itens: [] } };
      avisouFalha = false;
      if (arquivoCache) {
        fs.mkdirSync(path.dirname(arquivoCache), { recursive: true });
        fs.writeFileSync(arquivoCache, JSON.stringify(atual));
      }
    } catch (erro) {
      if (!avisouFalha) log.warn(`Tela de entrada: não foi possível atualizar os indicadores (${erro.message}).`);
      avisouFalha = true;
    }
  }

  return {
    async iniciar() {
      if (arquivoCache) lerCache();
      await atualizar();
      setInterval(atualizar, intervaloMs).unref();
    },
    atualizar,
    /** { indicadores, noticias, cliente } ou null enquanto não houver dados. */
    dados: () => (atual ? { ...atual, cliente } : null),
  };
}
