/* Motor de ofertas: detetar → publicar → apagar quando a promoção acaba.
   Dois tipos de anúncio:
   - 'gratis': jogos pagos a -100% (0,00€) — a licença fica para sempre na biblioteca.
   - 'cartas': jogos em promoção a preço baixo (≤ CARTAS_PRECO_MAX_EUR) cujas trading
     cards, vendidas no mercado, devolvem ≥ CARTAS_LUCRO_MIN_PCT do preço do jogo. */

const logger = require('./logger');
const db = require('./db');
const { config } = require('./config');
const discord = require('./discord/notifier');
const { buscarGratuitos } = require('./steam/search');
const { estimarRetorno } = require('./steam/mercado');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Um ciclo: ver o que está barato/grátis agora → publicar novidades → apagar
 * mensagens de jogos que já não cumprem os critérios.
 * @returns {Promise<{gratuitos:number, publicados:number, apagadas:number, cartasPublicadas:number, cartasAnalisados:number}>}
 */
async function cicloOfertas({ canalId = null } = {}) {
  const gratuitos = await buscarGratuitos();

  // ── 1. Apagar anúncios 'gratis' que já não estão a -100% ──
  let apagadas = 0;
  for (const a of db.anunciosAtivosPorTipo('gratis')) {
    if (gratuitos.some((g) => g.appid === a.appid)) continue; // ainda grátis
    await discord.apagarMensagem(a.canal_id, a.mensagem_id);
    db.anuncioMarcarExpirado(a.appid);
    apagadas++;
    logger.info(`Oferta grátis acabou: ${a.nome} (app ${a.appid}) — mensagem apagada`);
  }

  // ── 2. Publicar os -100% nunca anunciados ──
  let publicados = 0;
  for (const g of gratuitos) {
    if (db.anuncioConhecido(g.appid)) continue;
    const enviada = await discord.publicarOferta(g, { canalId });
    if (enviada) {
      db.anuncioGuardar(g.appid, g.nome, enviada.canalId, enviada.mensagemId, g.preco_original, 'gratis');
      publicados++;
      await sleep(1200);
    }
  }

  // ── 3. Arbitragem de cartas: promos baratas cujas cartas valem mais que o jogo ──
  const cartasRes = await cicloCartas({ canalId });
  publicados += cartasRes.publicados;
  apagadas += cartasRes.apagadas;

  const cartasResumo =
    cartasRes.elegiveis > 0
      ? `cartas: ${cartasRes.elegiveis} elegíveis ≤${(config.cartas.precoMaxCent / 100).toFixed(2).replace('.', ',')}€ | ${cartasRes.jaEnviados} já enviados | ${cartasRes.novosTotal} novos (${cartasRes.analisados} avaliados neste ciclo)`
      : `cartas: 0 elegíveis`;
  logger.info(
    `Ciclo de ofertas: ${gratuitos.length} grátis agora | +${publicados} publicadas (${cartasRes.publicados} de cartas) | ${apagadas} apagadas | ${cartasResumo}`,
  );
  return {
    gratuitos: gratuitos.length,
    publicados,
    apagadas,
    cartasPublicadas: cartasRes.publicados,
    cartasAnalisados: cartasRes.analisados,
    cartasElegiveis: cartasRes.elegiveis,
    cartasJaEnviados: cartasRes.jaEnviados,
  };
}

/**
 * Scan de arbitragem de cartas.
 * Fonte: 1ª página de specials ordenada por preço (0,49€, 0,99€, 1,99€…).
 * Filtros: preço ≤ CARTAS_PRECO_MAX_EUR e retorno estimado ≥ CARTAS_LUCRO_MIN_PCT.
 */
async function cicloCartas({ canalId = null } = {}) {
  if (config.cartas.precoMaxCent <= 0) return { publicados: 0, apagadas: 0, analisados: 0, elegiveis: 0, jaEnviados: 0, novosTotal: 0 };
  const { paginaSpecials } = require('./steam/search');

  const { itens } = await paginaSpecials(0, 50);
  // Elegíveis = página 1 de specials com preço no intervalo (sem cortes — a limpeza usa a lista completa)
  const elegiveis = itens.filter(
    (i) => i.preco_final_cent !== null && i.preco_final_cent > 0 && i.preco_final_cent <= config.cartas.precoMaxCent,
  );
  // Contagem honesta: quantos já foram anunciados vs quantos são novos
  const jaEnviados = elegiveis.filter((c) => db.anuncioConhecido(c.appid)).length;
  const novosTotal = elegiveis.length - jaEnviados;

  // Apagar anúncios 'cartas' cujo jogo já não está nas promos baratas.
  // Proteção: só apaga após 2 faltas seguidas (a Steam pode ter falhas pontuais).
  let apagadas = 0;
  const idsElegiveis = new Set(elegiveis.map((c) => c.appid));
  for (const a of db.anunciosAtivosPorTipo('cartas')) {
    if (idsElegiveis.has(a.appid)) {
      db.metaDel(`cartas_falta_${a.appid}`);
      continue;
    }
    const faltas = Number(db.metaGet(`cartas_falta_${a.appid}`, '0')) + 1;
    if (faltas >= 2) {
      await discord.apagarMensagem(a.canal_id, a.mensagem_id);
      db.anuncioMarcarExpirado(a.appid);
      db.metaDel(`cartas_falta_${a.appid}`);
      apagadas++;
      logger.info(`Promo de cartas acabou/saiu dos critérios: ${a.nome} (app ${a.appid}) — apagada`);
    } else {
      db.metaSet(`cartas_falta_${a.appid}`, String(faltas));
      logger.info(`Promo de cartas ausente (${faltas}ª vez): ${a.nome} — aguardo próximo ciclo antes de apagar`);
    }
  }

  // Avaliar só os nunca anunciados, limitados por ciclo para proteger a API do mercado
  // Rotação: cada ciclo pega nos próximos 15 novos, não sempre os mesmos 15 do início
  const novos = elegiveis.filter((c) => !db.anuncioConhecido(c.appid));
  let offset = Number(db.metaGet('cartas_offset', '0')) || 0;
  if (novos.length) offset = offset % novos.length;
  else offset = 0;
  const ordenados = offset ? [...novos.slice(offset), ...novos.slice(0, offset)] : novos;
  const paraAvaliar = ordenados.slice(0, config.cartas.porCiclo);
  const proximoOffset = novos.length ? (offset + paraAvaliar.length) % novos.length : 0;
  db.metaSet('cartas_offset', String(proximoOffset));

  logger.info(
    `Cartas: ${elegiveis.length} elegíveis ≤${(config.cartas.precoMaxCent / 100).toFixed(2).replace('.', ',')}€ na 1ª página | ${jaEnviados} já enviados | ${novosTotal} novos no total → ${paraAvaliar.length} avaliados neste ciclo (limite ${config.cartas.porCiclo}, offset ${offset}→${proximoOffset}) | ${Math.max(0, novosTotal - paraAvaliar.length)} ainda não avaliados neste "varrimento"`,
  );
  if (!paraAvaliar.length) return { publicados: 0, apagadas, analisados: 0, elegiveis: elegiveis.length, jaEnviados, novosTotal };

  // Avaliar candidatos ainda não anunciados — com classificação BAIXO/MÉDIO/ALTO por custo p/ cartas
  // BAIXO = barato p/ cartas (≥75% volta), MÉDIO = ela por ela (45–75%), ALTO = caro (<45%).
  // Mesmo sem lucro, dá retorno e faz crescer biblioteca/nível Steam (ciclo infinito ♻️).
  function nivelDe(ratio) {
    if (ratio >= 0.75) return 'BAIXO';
    if (ratio >= 0.45) return 'MEDIO';
    return 'ALTO';
  }
  const badgeNivel = { BAIXO: '🟢 BAIXO', MEDIO: '🟡 MÉDIO', ALTO: '🔴 ALTO' };
  let publicados = 0;
  let rejeitadosSemCartas = 0;
  let rejeitadosPrejuizo = 0;
  for (const c of paraAvaliar) {
    const est = await estimarRetorno(c.nome, c.appid);
    if (!est) {
      rejeitadosSemCartas++;
      logger.debug(`Cartas: ${c.nome} (${c.preco_final_texto}) — sem trading cards`);
      continue;
    } // sem cartas ou mercado vazio

    const lucroPct = ((est.retornoCent - c.preco_final_cent) / c.preco_final_cent) * 100;
    const ratio = est.retornoCent / c.preco_final_cent;
    const nivel = nivelDe(ratio);
    if (lucroPct < config.cartas.lucroMinPct) {
      rejeitadosPrejuizo++;
      logger.info(
        `Cartas: ${badgeNivel[nivel]} ${c.nome} a ${c.preco_final_texto} → retorno ~${(est.retornoCent / 100).toFixed(2).replace('.', ',')}€ (${est.nCartas}c × ~${(est.mediaCent / 100).toFixed(2).replace('.', ',')}€, ${est.drops} drops) = ${lucroPct.toFixed(0)}% (${Math.round(ratio * 100)}% volta) — abaixo do mínimo ${config.cartas.lucroMinPct}% — usa /cartas para ver forçado`,
      );
      await sleep(400);
      continue;
    }

    const detalhe = {
      preco_final_texto: c.preco_final_texto,
      preco_final_cent: c.preco_final_cent,
      nCartas: est.nCartas,
      mediaCent: est.mediaCent,
      drops: est.drops,
      retornoCent: est.retornoCent,
      vendaSeguraCent: est.vendaSeguraCent,
      lucroPct: Math.round(lucroPct),
      nivel,
      ratio: Math.round(ratio * 100) / 100,
    };

    const enviada = await discord.publicarPromoCartas({ ...c, url: `https://store.steampowered.com/app/${c.appid}` }, detalhe, { canalId });
    if (enviada) {
      db.anuncioGuardar(c.appid, c.nome, enviada.canalId, enviada.mensagemId, c.preco_original, 'cartas', JSON.stringify(detalhe));
      publicados++;
      logger.info(`Cartas: ${badgeNivel[detalhe.nivel]} ${c.nome} a ${c.preco_final_texto} → retorno est. ${est.retornoCent}c (${Math.round(lucroPct)}%, ${Math.round(ratio * 100)}% volta) — publicado`);
      await sleep(1200);
    }
    await sleep(800); // ritmo para a API do mercado
  }

  if (rejeitadosSemCartas || rejeitadosPrejuizo) {
    logger.info(`Cartas: ${paraAvaliar.length} analisados → ${publicados} publicados, ${rejeitadosPrejuizo} com prejuízo, ${rejeitadosSemCartas} sem cartas`);
  } else if (publicados) {
    logger.info(`Cartas: ${paraAvaliar.length} analisados → ${publicados} publicados`);
  }
  return { publicados, apagadas, analisados: paraAvaliar.length, elegiveis: elegiveis.length, jaEnviados, novosTotal };
}

/** Listas para /ofertas. */
function ofertasAtivas() {
  return {
    gratis: db.anunciosAtivosPorTipo('gratis'),
    cartas: db.anunciosAtivosPorTipo('cartas'),
  };
}

module.exports = { cicloOfertas, ofertasAtivas };
