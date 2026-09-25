/* Mercado da Steam (steamcommunity.com/market): preços das trading cards
   de um jogo para estimar o retorno de vendê-las (arbitragem compra-barato/vende-cartas).

   Endpoint validado ao vivo: /market/search/render/?appid=753&norender=1
   + query=<nome do jogo>&category_753_item_class[]=tag_item_class_2 (trading cards).
   Os hash_name vêm como "<appid>-<nome da carta>", por isso filtramos pelo prefixo.
   Notas económicas:
   - Conta nova: nº de drops de cartas = ceil(nº cartas do set / 2)
   - Venda líquida = preço × (1/1.15) — a Steam fica com 15% da transação. */

const logger = require('../logger');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const COMISSAO = 1.15; // 15% de fee na venda

class MarketApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'MarketApiError';
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, { timeout = 20000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    });
    if (res.status === 429) throw new MarketApiError('Mercado: 429 — demasiados pedidos', 429);
    if (!res.ok) throw new MarketApiError(`Mercado HTTP ${res.status}`, res.status);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new MarketApiError('Mercado: timeout', 408);
    if (err instanceof MarketApiError) throw err;
    throw new MarketApiError(`Mercado: falha de rede (${err.message})`, 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Menores preços das trading cards (normais) de um jogo. Cache em memória 12h. */
const cachePrecos = new Map(); // appid -> { data, cartas }

async function precosCartas(nomeJogo, appid, { count = 100 } = {}) {
  const c = cachePrecos.get(appid);
  if (c && Date.now() - c.data < 12 * 60 * 60 * 1000) return c.cartas;

  const q = encodeURIComponent(String(nomeJogo).slice(0, 60));
  const url =
    'https://steamcommunity.com/market/search/render/?appid=753&norender=1' +
    `&count=${count}&query=${q}&start=0&category_753_item_class%5B%5D=tag_item_class_2`;
  const j = await fetchJson(url);
  const prefixo = `${appid}-`;
  const cartas = (j.results ?? [])
    .filter((r) => typeof r.hash_name === 'string' && r.hash_name.startsWith(prefixo) && !/\(Foil\)/.test(r.hash_name))
    .map((r) => ({ nome: r.hash_name.slice(prefixo.length), precoCent: Number(r.sell_price) || 0, listings: Number(r.sell_listings) || 0 }));

  cachePrecos.set(appid, { data: Date.now(), cartas });
  return cartas;
}

/**
 * Estimativa de retorno para uma conta NOVA a farmar o set completo:
 *   drops = ceil(nº cartas / 2) × preço médio ÷ 1.15 (fee da Steam)
 * @returns {null | {nCartas, mediaCent, drops, retornoCent, vendaSeguraCent}}
 */
async function estimarRetorno(nomeJogo, appid, { precoJogoCent = 0 } = {}) {
  let cartas;
  try {
    cartas = await precosCartas(nomeJogo, appid);
  } catch (err) {
    logger.warn(`Mercado: falhou estimar cartas de ${appid}: ${err.message}`);
    return null;
  }
  if (!cartas.length) return null; // jogo sem trading cards

  const comPreco = cartas.filter((c) => c.precoCent > 0);
  if (!comPreco.length) return null;

  const media = comPreco.reduce((s, c) => s + c.precoCent, 0) / comPreco.length;
  const drops = Math.ceil(cartas.length / 2);
  const retornoCent = Math.round((drops * media) / COMISSAO);
  // Conservador: só a metade mais barata do set (podes liquidar rápido) + 20% de folga
  const metade = [...comPreco].sort((a, b) => a.precoCent - b.precoCent).slice(0, Math.ceil(comPreco.length / 2));
  const vendaSeguraCent = Math.round((metade.reduce((s, c) => s + c.precoCent, 0) / metade.length * drops) / COMISSAO * 0.8);

  return { nCartas: cartas.length, mediaCent: Math.round(media), drops, retornoCent, vendaSeguraCent };
}

module.exports = { precosCartas, estimarRetorno, COMISSAO, MarketApiError };
