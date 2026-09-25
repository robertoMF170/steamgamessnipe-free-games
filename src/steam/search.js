/* Detetor de jogos pagos → 100% de graça (promoções temporárias; a licença
   fica para sempre na biblioteca). Fonte: pesquisa oficial da loja Steam,
   endpoint `specials` ordenado por preço crescente — todas as ofertas a
   0,00€ (-100%) surgem nas primeiras páginas. */

const logger = require('../logger');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SrRobsFreeGames/1.0';
const STORE = 'https://store.steampowered.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class SteamSearchError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SteamSearchError';
    this.status = status;
  }
}

async function fetchJson(url, { timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (res.status === 429) throw new SteamSearchError('Steam: demasiados pedidos (429)', 429);
    if (!res.ok) throw new SteamSearchError(`Steam HTTP ${res.status} em ${url.split('?')[0]}`, res.status);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new SteamSearchError(`Steam: timeout em ${url.split('?')[0]}`, 408);
    if (err instanceof SteamSearchError) throw err;
    const causa = err.cause?.code ?? err.cause?.message;
    throw new SteamSearchError(`Steam: falha de rede${causa ? ` (${causa})` : ''}`, 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Extrai uma linha de resultado da pesquisa (HTML embutido em JSON). */
function parseLinha(bloco) {
  const appidM = bloco.match(/data-ds-appid="(\d+)"/);
 if (!appidM) return null;
  const pctM = bloco.match(/class="discount_pct">-?(\d+)%</);
  const nomeM = bloco.match(/class="title">([^<]+)</);
  const origM = bloco.match(/class="discount_original_price">([^<]+)</);
  const finalM = bloco.match(/class="discount_final_price">([^<]+)</);
  return {
    appid: Number(appidM[1]),
    nome: nomeM ? nomeM[1].trim() : `App ${appidM[1]}`,
    desconto_pct: pctM ? Number(pctM[1]) : 0,
    preco_original: origM ? origM[1].trim() : '',
    preco_final_texto: finalM ? finalM[1].trim() : '',
    // "0,49€" → 49 | "Grátis" → 0 | sem preço → null
    preco_final_cent: finalM ? (finalM[1].toLowerCase().includes('grátis') || finalM[1].toLowerCase().includes('free') ? 0 : parseCent(finalM[1])) : null,
  };
}

/** "0,49€" → 49 | "19,99€" → 1999 | "1.234,56€" → 123456. */
function parseCent(texto) {
  const m = String(texto).replace(/\s/g, '').match(/[\d.,]+/);
  if (!m) return null;
  let n = m[0];
  const temVirg = n.includes(',');
  const temPonto = n.includes('.');
  if (temVirg && temPonto) {
    n = n.lastIndexOf(',') > n.lastIndexOf('.') ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
  } else if (temVirg) {
    n = /^\d{1,3}(,\d{3})+$/.test(n) ? n.replace(/,/g, '') : n.replace(',', '.');
  } else if (temPonto && /^\d{1,3}(\.\d{3})+$/.test(n)) {
    n = n.replace(/\./g, '');
  }
  const cent = Math.round(parseFloat(n) * 100);
  return Number.isFinite(cent) ? cent : null;
}

/**
 * Página N da pesquisa de specials. Devolve { itens, total }.
 * count máximo fiável: 50.
 */
async function paginaSpecials(start = 0, count = 50, { cc = 'pt', lang = 'english' } = {}) {
  const url =
    `${STORE}/search/results/?query&start=${start}&count=${count}` +
    `&sort_by=Price_ASC&specials=1&infinite=1&cc=${cc}&l=${lang}`;
  const data = await fetchJson(url);
  const html = data?.results_html ?? '';
  const blocos = html.split(/(?=<a href="https:\/\/store\.steampowered\.com)/).slice(1);
  const itens = blocos.map(parseLinha).filter(Boolean);
  // total_results existe no payload; se não, usamos o que veio
  const total = Number(data?.total_results ?? itens.length);
  return { itens, total };
}

/**
 * Devolve TODOS os jogos com -100% (0,00€) visíveis na pesquisa de specials.
 * Percorre páginas a partir do início (estão sempre nas primeiras, ordenado
 * por preço crescente) e para na primeira página sem nenhum -100%.
 */
async function buscarGratuitos({ cc = 'pt', lang = 'english', maxPaginas = 4, porPagina = 50 } = {}) {
  const vistos = new Map(); // appid -> oferta
  for (let pag = 0; pag < maxPaginas; pag++) {
    const start = pag * porPagina;
    const { itens, total } = await paginaSpecials(start, porPagina, { cc, lang });
    const destaPag = itens.filter((i) => i.desconto_pct === 100);
    for (const i of destaPag) {
      if (!vistos.has(i.appid)) vistos.set(i.appid, { ...i, url: `${STORE}/app/${i.appid}` });
    }
    logger.debug(`search specials: página ${pag + 1} — ${itens.length} resultados, ${destaPag.length} a 100% (total: ${vistos.size}/${total})`);
    // Página vazia → acabou a lista. Página sem nenhum -100% → passámos o bloco de 0€.
    if (!itens.length || destaPag.length === 0) break;
    if (vistos.size >= total) break;
    await sleep(1200 + Math.floor(Math.random() * 800));
  }
  const ofertas = [...vistos.values()];
  logger.info(`Pesquisa Steam: ${ofertas.length} jogo(s) a 100% de graça agora`);
  return ofertas;
}

module.exports = { buscarGratuitos, paginaSpecials, parseLinha, parseCent, SteamSearchError, UA };
